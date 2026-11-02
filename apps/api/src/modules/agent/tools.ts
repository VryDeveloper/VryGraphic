import {
  addMonths,
  buildCommandContext,
  formatPlain,
  installmentSchedule,
  invoiceMonthFor,
  ISO_DATE,
  ISO_MONTH,
  ISSUE_MESSAGES,
  normalize,
  parseBRL,
  parseCommand,
  simulateGoal,
  todayISO,
} from '@vrygraphic/shared';
import { z, type ZodTypeAny } from 'zod';
import { prisma } from '../../lib/prisma';
import { list as listAccounts } from '../accounts/service';
import { apply as applyBudgets, plan as budgetPlan } from '../budgets/service';
import { dashboard } from '../dashboard/service';
import { list as listGoals, update as updateGoal } from '../goals/service';
import * as tx from '../transactions/service';

/** Erro de entrada que volta para o modelo corrigir (sem pedir confirmação a ninguém). */
export class ToolInputError extends Error {}

export interface AgentTool<S extends ZodTypeAny = ZodTypeAny> {
  name: string;
  description: string;
  /** read = roda sozinha; write = mostra a prévia e espera o [s/n] da pessoa */
  kind: 'read' | 'write';
  schema: S;
  input_schema: Record<string, unknown>;
  /** escrita: texto mostrado no terminal antes do [s/n] */
  preview?: (userId: string, input: z.output<S>) => Promise<string>;
  run: (userId: string, input: z.output<S>) => Promise<unknown>;
  /** uma linha para o terminal depois que a ferramenta roda */
  summarize: (result: unknown) => string;
}

const money = (c: number) => formatPlain(c);
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const mmm = (m: string | null) => (m ? `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}` : 'sem previsão');
const brDate = (d: string) => d.split('-').reverse().join('/');

const month = z.string().regex(ISO_MONTH, 'use AAAA-MM').optional();
const brl = z.string().min(1).max(20);

function cents(text: string, field: string): number {
  const v = parseBRL(text);
  if (v === null || v <= 0) throw new ToolInputError(`${field}: valor inválido "${text}". Use o formato 1.234,56.`);
  return v;
}

/** Acha por nome, apelido ou começo do nome, sem acento. Ambíguo ou inexistente vira erro para o modelo. */
function pick<T extends { name: string; aliases?: string[] }>(items: T[], query: string, what: string): T {
  const q = normalize(query.trim());
  const exact = items.filter((i) => normalize(i.name) === q || i.aliases?.map(normalize).includes(q));
  if (exact.length === 1) return exact[0];
  const prefix = items.filter((i) => normalize(i.name).startsWith(q) || normalize(i.name).includes(q));
  if (prefix.length === 1) return prefix[0];
  const options = items.map((i) => i.name).join(', ');
  throw new ToolInputError(prefix.length > 1 ? `"${query}" é ambíguo entre: ${prefix.map((i) => i.name).join(', ')}` : `${what} "${query}" não existe. Opções: ${options}`);
}

async function commandFor(userId: string, text: string) {
  const [accounts, categories] = await Promise.all([
    prisma.account.findMany({ where: { userId, deletedAt: null }, orderBy: { createdAt: 'asc' } }),
    prisma.category.findMany({ where: { userId, deletedAt: null } }),
  ]);
  const p = parseCommand(text, buildCommandContext({ accounts, categories, today: todayISO() }));
  if (!p.ok) throw new ToolInputError(`comando incompleto: ${p.issues.map((i) => ISSUE_MESSAGES[i]).join(', ')}`);
  return { p, account: accounts.find((a) => a.id === p.accountId)! };
}

/** Tipagem forte dentro de cada ferramenta; na lista elas viram AgentTool genérico (a entrada é validada pelo schema antes de rodar). */
const tool = <S extends ZodTypeAny>(t: AgentTool<S>): AgentTool => t as unknown as AgentTool;

export const TOOLS: AgentTool[] = [
  tool({
    name: 'resumo_do_mes',
    kind: 'read',
    description: 'Resumo de um mês: receitas, despesas, taxa de poupança, patrimônio, gasto por categoria, contas, vencimentos do mês seguinte e alertas. Sem mês = mês atual.',
    schema: z.object({ mes: month }),
    input_schema: { type: 'object', properties: { mes: { type: 'string', description: 'AAAA-MM (opcional)' } } },
    async run(userId, { mes }) {
      const d = await dashboard(userId, mes ?? todayISO().slice(0, 7));
      return {
        mes: d.month,
        ate_hoje: d.isCurrent ? d.today : null,
        receitas: money(d.kpis.incomeCents),
        despesas: money(d.kpis.expenseCents),
        guardado: money(d.kpis.savedCents),
        taxa_poupanca: `${(d.kpis.savingsRate * 100).toFixed(1)}%`,
        patrimonio: money(d.kpis.netWorthCents),
        variacao_patrimonio_no_mes: money(d.kpis.netWorthChangeCents),
        categorias: d.categories.slice(0, 8).map((c) => ({ nome: c.name, gasto: money(c.spentCents), participacao: `${c.share}%`, media_3_meses_antes: money(c.avg3Cents) })),
        contas: d.accounts.map((a) => ({ nome: a.name, saldo: money(a.balanceCents), ...(a.availableCents !== null ? { limite_livre: money(a.availableCents) } : {}) })),
        vencimentos_mes_seguinte: { total: money(d.bills.totalCents), itens: d.bills.items.map((b) => `${brDate(b.date)} ${b.name} ${money(b.cents)}`) },
        projecao: d.netWorth.projection.map((p) => `${mmm(p.month)}: ${money(p.expectedCents)} (±${money(p.highCents - p.expectedCents)})`),
        alertas: d.alerts.slice(0, 6).map((a) => a.text),
      };
    },
    summarize: (r) => `resumo de ${mmm((r as { mes: string }).mes)}`,
  }),

  tool({
    name: 'listar_lancamentos',
    kind: 'read',
    description: 'Lista lançamentos (mais recentes primeiro) com filtros opcionais: mês, texto na descrição, tipo e categoria. Devolve id, data, descrição, categoria, conta, valor e os totais do filtro.',
    schema: z.object({
      mes: month,
      busca: z.string().max(60).optional(),
      tipo: z.enum(['receita', 'despesa', 'transferencia']).optional(),
      categoria: z.string().max(40).optional(),
      limite: z.number().int().min(1).max(50).default(20),
    }),
    input_schema: {
      type: 'object',
      properties: {
        mes: { type: 'string', description: 'AAAA-MM' },
        busca: { type: 'string', description: 'texto na descrição' },
        tipo: { type: 'string', enum: ['receita', 'despesa', 'transferencia'] },
        categoria: { type: 'string', description: 'nome da categoria' },
        limite: { type: 'integer', minimum: 1, maximum: 50 },
      },
    },
    async run(userId, i) {
      let categoryId: string | undefined;
      if (i.categoria) {
        const cats = await prisma.category.findMany({ where: { userId, deletedAt: null } });
        categoryId = pick(cats, i.categoria, 'categoria').id;
      }
      const kind = i.tipo === 'receita' ? 'INCOME' : i.tipo === 'despesa' ? 'EXPENSE' : i.tipo === 'transferencia' ? 'TRANSFER' : undefined;
      const r = await tx.list(userId, { month: i.mes, q: i.busca, kind, categoryId, limit: i.limite });
      return {
        total_no_filtro: r.totals.count,
        entradas: money(r.totals.incomeCents),
        saidas: money(r.totals.expenseCents),
        itens: r.items.map((t) => ({
          id: t.id,
          data: brDate(t.date),
          descricao: t.description + (t.installment ? ` (${t.installment.number}/${t.installment.count})` : ''),
          categoria: t.category?.name ?? null,
          conta: t.account.name,
          valor: money(t.amountCents),
        })),
      };
    },
    summarize: (r) => `${(r as { itens: unknown[] }).itens.length} de ${(r as { total_no_filtro: number }).total_no_filtro} lançamentos`,
  }),

  tool({
    name: 'listar_contas',
    kind: 'read',
    description: 'Contas com saldo atual, apelidos e, no cartão, limite livre, fechamento e vencimento.',
    schema: z.object({}),
    input_schema: { type: 'object', properties: {} },
    async run(userId) {
      return (await listAccounts(userId)).map((a) => ({
        nome: a.name,
        tipo: a.kind,
        apelidos: a.aliases,
        saldo: money(a.balanceCents),
        ...(a.kind === 'CREDIT_CARD' ? { limite_livre: money(a.availableCents ?? 0), fecha_dia: a.closingDay, vence_dia: a.dueDay } : {}),
      }));
    },
    summarize: (r) => `${(r as unknown[]).length} contas`,
  }),

  tool({
    name: 'orcamento_do_mes',
    kind: 'read',
    description: 'Orçamento por categoria no mês: limite, gasto (inclui parcelas já marcadas no mês), uso e a sugestão para o mês seguinte (média de 3 meses).',
    schema: z.object({ mes: month }),
    input_schema: { type: 'object', properties: { mes: { type: 'string', description: 'AAAA-MM (opcional)' } } },
    async run(userId, { mes }) {
      const p = await budgetPlan(userId, mes ?? todayISO().slice(0, 7));
      return {
        mes: p.month,
        categorias: p.items.map((i) => ({
          categoria: i.name,
          limite: i.limitCents === null ? null : money(i.limitCents),
          gasto: money(i.spentCents),
          uso: i.ratio === null ? null : `${Math.round(i.ratio * 100)}%`,
          sugestao_proximo_mes: money(i.suggestionCents),
        })),
      };
    },
    summarize: (r) => `orçamento de ${mmm((r as { mes: string }).mes)}`,
  }),

  tool({
    name: 'listar_metas',
    kind: 'read',
    description: 'Metas com saldo atual, alvo, progresso, aporte mensal, rendimento e previsão de conclusão.',
    schema: z.object({}),
    input_schema: { type: 'object', properties: {} },
    async run(userId) {
      return (await listGoals(userId)).map((g) => ({
        nome: g.name,
        conta: g.account?.name,
        atual: money(g.currentCents),
        alvo: money(g.targetCents),
        progresso: `${Math.round(g.progress * 100)}%`,
        aporte_mensal: money(g.monthlyContributionCents),
        rendimento_ao_mes: `${(g.monthlyRateBps / 100).toFixed(2)}%`,
        previsao: mmm(g.projection.etaMonth),
      }));
    },
    summarize: (r) => `${(r as unknown[]).length} metas`,
  }),

  tool({
    name: 'simular_meta',
    kind: 'read',
    description: 'Simula uma meta com outro aporte mensal e/ou rendimento, sem salvar nada. Devolve em quantos meses chega, quando, quanto é depositado e quanto rende.',
    schema: z.object({ meta: z.string().min(1), aporte_mensal: brl.optional(), rendimento_ao_mes: z.number().min(0).max(10).optional() }),
    input_schema: {
      type: 'object',
      properties: {
        meta: { type: 'string', description: 'nome da meta' },
        aporte_mensal: { type: 'string', description: 'ex.: 1.000,00' },
        rendimento_ao_mes: { type: 'number', description: 'em %, ex.: 0.85' },
      },
      required: ['meta'],
    },
    async run(userId, i) {
      const g = pick(await listGoals(userId), i.meta, 'meta');
      const monthly = i.aporte_mensal ? cents(i.aporte_mensal, 'aporte_mensal') : g.monthlyContributionCents;
      const bps = i.rendimento_ao_mes === undefined ? g.monthlyRateBps : Math.round(i.rendimento_ao_mes * 100);
      const s = simulateGoal({ currentCents: g.currentCents, targetCents: g.targetCents, monthlyContributionCents: monthly, monthlyRateBps: bps, maxMonths: 600 });
      return {
        meta: g.name,
        aporte_mensal: money(monthly),
        rendimento_ao_mes: `${(bps / 100).toFixed(2)}%`,
        chega: s.reached,
        meses: s.months,
        previsao: s.reached ? mmm(addMonths(todayISO().slice(0, 7), s.months)) : 'não chega em 50 anos',
        depositado: money(s.depositedCents),
        rendimento_total: money(s.interestCents),
        previsao_atual_sem_mudar_nada: mmm(g.projection.etaMonth),
      };
    },
    summarize: (r) => `simulação: ${(r as { previsao: string }).previsao}`,
  }),

  // ───────────────────────── escrita: pedem [s/n] ─────────────────────────

  tool({
    name: 'lancar',
    kind: 'write',
    description:
      'Grava um lançamento usando a linguagem da barra de comando: "descrição valor categoria [conta] [Nx] [hoje|ontem|dd/mm]". Receita começa com "+". Ex.: "mercado 120,50 alimentação", "+freela 800 trabalho inter", "notebook 2.400 tecnologia cartao 10x". O app mostra a prévia e pede confirmação.',
    schema: z.object({ comando: z.string().min(2).max(200) }),
    input_schema: { type: 'object', properties: { comando: { type: 'string' } }, required: ['comando'] },
    async preview(userId, { comando }) {
      const { p, account } = await commandFor(userId, comando);
      const tipo = p.kind === 'INCOME' ? 'receita' : 'despesa';
      let parcelas = '';
      if (p.installments > 1) {
        const first = account.kind === 'CREDIT_CARD' ? invoiceMonthFor(p.date, account.closingDay ?? 1) : p.date.slice(0, 7);
        const s = installmentSchedule(p.amountCents!, p.installments, first);
        parcelas = ` · ${p.installments}x de ${money(s[1].amountCents)}`;
      }
      return `lançar ${tipo}: ${p.description} · ${money(p.amountCents!)}${parcelas} · ${p.categoryName ?? 'sem categoria'} · ${p.accountName} · ${brDate(p.date)}`;
    },
    async run(userId, { comando }) {
      await commandFor(userId, comando); // valida de novo: os dados podem ter mudado desde a prévia
      const { items } = await tx.createFromCommand(userId, comando, 'AGENT');
      return { gravados: items.length, primeiro: { id: items[0].id, descricao: items[0].description, valor: money(items[0].amountCents), data: brDate(items[0].date) } };
    },
    summarize: (r) => `${(r as { gravados: number }).gravados} lançamento(s) gravado(s)`,
  }),

  tool({
    name: 'excluir_lancamento',
    kind: 'write',
    description: 'Exclui um lançamento pelo id (pegue o id com listar_lancamentos). Parcela exclui o parcelamento todo; transferência exclui as duas pernas. Dá para desfazer na tela de Transações.',
    schema: z.object({ id: z.string().uuid('id inválido') }),
    input_schema: { type: 'object', properties: { id: { type: 'string', description: 'uuid do lançamento' } }, required: ['id'] },
    async preview(userId, { id }) {
      const t = await tx.get(userId, id).catch(() => {
        throw new ToolInputError('lançamento não encontrado');
      });
      const extra = t.installment ? ` (parcelamento inteiro, ${t.installment.count} parcelas)` : t.transferGroupId ? ' (as duas pernas da transferência)' : '';
      return `excluir: ${t.description} · ${money(t.amountCents)} · ${brDate(t.date)} · ${t.account.name}${extra}`;
    },
    run: (userId, { id }) => tx.remove(userId, id),
    summarize: (r) => `${(r as { deleted: number }).deleted} excluído(s)`,
  }),

  tool({
    name: 'transferir',
    kind: 'write',
    description: 'Transfere dinheiro entre duas contas da pessoa (ex.: guardar na reserva, pagar a fatura).',
    schema: z.object({ de: z.string().min(1), para: z.string().min(1), valor: brl, data: z.string().regex(ISO_DATE, 'use AAAA-MM-DD').optional() }),
    input_schema: {
      type: 'object',
      properties: { de: { type: 'string' }, para: { type: 'string' }, valor: { type: 'string', description: 'ex.: 500,00' }, data: { type: 'string', description: 'AAAA-MM-DD (padrão hoje)' } },
      required: ['de', 'para', 'valor'],
    },
    async preview(userId, i) {
      const accounts = await listAccounts(userId);
      const from = pick(accounts, i.de, 'conta');
      const to = pick(accounts, i.para, 'conta');
      if (from.id === to.id) throw new ToolInputError('origem e destino são a mesma conta');
      return `transferir ${money(cents(i.valor, 'valor'))} de ${from.name} para ${to.name} em ${brDate(i.data ?? todayISO())}`;
    },
    async run(userId, i) {
      const accounts = await listAccounts(userId);
      const r = await tx.transfer(
        userId,
        { fromAccountId: pick(accounts, i.de, 'conta').id, toAccountId: pick(accounts, i.para, 'conta').id, amountCents: cents(i.valor, 'valor'), date: i.data ?? todayISO(), description: 'Transferência' },
        'AGENT',
      );
      return { feito: true, grupo: r.transferGroupId };
    },
    summarize: () => 'transferência feita',
  }),

  tool({
    name: 'definir_orcamento',
    kind: 'write',
    description: 'Define (ou troca) o limite de gasto de uma categoria de despesa num mês.',
    schema: z.object({ categoria: z.string().min(1), limite: brl, mes: month }),
    input_schema: {
      type: 'object',
      properties: { categoria: { type: 'string' }, limite: { type: 'string', description: 'ex.: 1.500,00' }, mes: { type: 'string', description: 'AAAA-MM (padrão mês atual)' } },
      required: ['categoria', 'limite'],
    },
    async preview(userId, i) {
      const cats = await prisma.category.findMany({ where: { userId, deletedAt: null, kind: 'EXPENSE' } });
      const c = pick(cats, i.categoria, 'categoria de despesa');
      const m = i.mes ?? todayISO().slice(0, 7);
      const current = await prisma.budget.findUnique({ where: { userId_categoryId_month: { userId, categoryId: c.id, month: m } } });
      const before = current ? ` (hoje: ${money(Number(current.limitCents))})` : '';
      return `orçamento de ${c.name} em ${mmm(m)}: ${money(cents(i.limite, 'limite'))}${before}`;
    },
    async run(userId, i) {
      const cats = await prisma.category.findMany({ where: { userId, deletedAt: null, kind: 'EXPENSE' } });
      const c = pick(cats, i.categoria, 'categoria de despesa');
      await applyBudgets(userId, { month: i.mes ?? todayISO().slice(0, 7), items: [{ categoryId: c.id, limitCents: cents(i.limite, 'limite') }] });
      return { feito: true, categoria: c.name };
    },
    summarize: (r) => `orçamento de ${(r as { categoria: string }).categoria} salvo`,
  }),

  tool({
    name: 'ajustar_meta',
    kind: 'write',
    description: 'Muda o aporte mensal e/ou o rendimento ao mês de uma meta.',
    schema: z.object({ meta: z.string().min(1), aporte_mensal: brl.optional(), rendimento_ao_mes: z.number().min(0).max(10).optional() }),
    input_schema: {
      type: 'object',
      properties: { meta: { type: 'string' }, aporte_mensal: { type: 'string', description: 'ex.: 1.000,00' }, rendimento_ao_mes: { type: 'number', description: 'em %, ex.: 0.85' } },
      required: ['meta'],
    },
    async preview(userId, i) {
      const g = pick(await listGoals(userId), i.meta, 'meta');
      if (!i.aporte_mensal && i.rendimento_ao_mes === undefined) throw new ToolInputError('informe aporte_mensal ou rendimento_ao_mes');
      const parts = [];
      if (i.aporte_mensal) parts.push(`aporte ${money(g.monthlyContributionCents)} → ${money(cents(i.aporte_mensal, 'aporte_mensal'))}`);
      if (i.rendimento_ao_mes !== undefined) parts.push(`rendimento ${(g.monthlyRateBps / 100).toFixed(2)}% → ${i.rendimento_ao_mes.toFixed(2)}%`);
      return `meta ${g.name}: ${parts.join(' · ')}`;
    },
    async run(userId, i) {
      const g = pick(await listGoals(userId), i.meta, 'meta');
      const saved = await updateGoal(userId, g.id, {
        ...(i.aporte_mensal ? { monthlyContributionCents: cents(i.aporte_mensal, 'aporte_mensal') } : {}),
        ...(i.rendimento_ao_mes !== undefined ? { monthlyRateBps: Math.round(i.rendimento_ao_mes * 100) } : {}),
      });
      return { feito: true, nova_previsao: mmm(saved.projection.etaMonth) };
    },
    summarize: (r) => `meta salva · previsão ${(r as { nova_previsao: string }).nova_previsao}`,
  }),
];

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
