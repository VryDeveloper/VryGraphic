import { parseBRL, type Cents } from './money';

/**
 * Parser da barra de comando do VryGraphic.
 *
 *   comando   = ["+"] token { token }
 *   token     = valor | parcelas | categoria | conta | data | palavra
 *   valor     = 1.234,56 | 1234,56 | 1234.56 | 120     (o primeiro número encontrado)
 *   parcelas  = N "x"                                   (1 a 24)
 *   categoria = prefixo de 3+ letras de UMA categoria do usuário, sem acento
 *   conta     = apelido de conta do usuário
 *   data      = "hoje" | "ontem" | dd/mm
 *   palavra   = o que sobrar vira a descrição
 *
 * Função pura: roda igual no front (prévia ao digitar) e na API (validação).
 */

export type CommandKind = 'INCOME' | 'EXPENSE';

export interface CommandContext {
  categories: { id: string; name: string; kind: CommandKind }[];
  /** `aliases` em minúsculas, sem acento: ["nubank", "nu", "cartao"]. */
  accounts: { id: string; name: string; aliases: string[]; defaultFor?: CommandKind | 'ANY' }[];
  /** Data de referência para "hoje" no fuso do usuário, "AAAA-MM-DD". */
  today: string;
}

export type CommandIssue = 'MISSING_AMOUNT' | 'MISSING_DESCRIPTION' | 'TOO_MANY_INSTALLMENTS' | 'INVALID_DATE' | 'MISSING_ACCOUNT';

export interface ParsedCommand {
  kind: CommandKind;
  description: string;
  amountCents: Cents | null;
  installments: number;
  categoryId: string | null;
  categoryName: string | null;
  /** true quando nenhuma categoria foi reconhecida e usamos a padrão. */
  categoryGuessed: boolean;
  accountId: string | null;
  accountName: string | null;
  date: string;
  issues: CommandIssue[];
  ok: boolean;
}

export function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function parseDayMonth(tok: string, today: string): string | 'INVALID' | null {
  const m = tok.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(today.slice(0, 4));
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const d = new Date(`${iso}T12:00:00Z`);
  if (month < 1 || month > 12 || d.getUTCDate() !== day) return 'INVALID';
  // uma data no futuro deste ano provavelmente é do ano passado (ex.: 28/12 digitado em janeiro)
  return iso > today ? `${year - 1}${iso.slice(4)}` : iso;
}

export function parseCommand(text: string, ctx: CommandContext): ParsedCommand {
  let t = text.trim();
  let kind: CommandKind = 'EXPENSE';
  if (t.startsWith('+')) {
    kind = 'INCOME';
    t = t.slice(1).trim();
  }

  const issues: CommandIssue[] = [];
  const desc: string[] = [];
  let amountCents: Cents | null = null;
  let installments = 1;
  let category: CommandContext['categories'][number] | null = null;
  let account: CommandContext['accounts'][number] | null = null;
  let date = ctx.today;

  for (const tok of t.split(/\s+/).filter(Boolean)) {
    const n = normalize(tok);

    const parc = n.match(/^(\d+)x$/);
    if (parc) {
      const q = Number(parc[1]);
      if (q > 24 || q < 1) issues.push('TOO_MANY_INSTALLMENTS');
      else installments = q;
      continue;
    }

    if (amountCents === null) {
      const v = parseBRL(tok);
      if (v !== null && /\d/.test(tok) && !tok.includes('/')) {
        amountCents = v;
        continue;
      }
    }

    if (n === 'hoje') { date = ctx.today; continue; }
    if (n === 'ontem') { date = shiftDate(ctx.today, -1); continue; }
    const dm = parseDayMonth(n, ctx.today);
    if (dm === 'INVALID') { issues.push('INVALID_DATE'); continue; }
    if (dm) { date = dm; continue; }

    if (!category && n.length >= 3) {
      const matches = ctx.categories.filter((c) => normalize(c.name).startsWith(n));
      if (matches.length === 1) { category = matches[0]; continue; }
    }

    if (!account) {
      const acc = ctx.accounts.find((a) => a.aliases.includes(n));
      if (acc) { account = acc; continue; }
    }

    desc.push(tok);
  }

  const fallbackCategory = ctx.categories.find((c) => c.kind === kind && normalize(c.name) === (kind === 'INCOME' ? 'outras receitas' : 'outros')) ?? null;
  const categoryGuessed = !category;
  if (!category) category = fallbackCategory;
  if (category && category.kind !== kind) {
    // "+freela 640 alimentacao": a categoria manda no tipo só se o usuário não marcou "+"
    if (!text.trim().startsWith('+')) kind = category.kind;
  }
  if (!account) account = ctx.accounts.find((a) => a.defaultFor === kind || a.defaultFor === 'ANY') ?? null;

  if (amountCents === null || amountCents === 0) issues.push('MISSING_AMOUNT');
  if (desc.length === 0) issues.push('MISSING_DESCRIPTION');
  if (!account) issues.push('MISSING_ACCOUNT');

  const description = desc.join(' ');
  return {
    kind,
    description: description ? description.charAt(0).toUpperCase() + description.slice(1) : '',
    amountCents,
    installments,
    categoryId: category?.id ?? null,
    categoryName: category?.name ?? null,
    categoryGuessed,
    accountId: account?.id ?? null,
    accountName: account?.name ?? null,
    date,
    issues,
    ok: issues.length === 0,
  };
}

/** Mensagens em português para cada problema, usadas na prévia e no erro 422. */
export const ISSUE_MESSAGES: Record<CommandIssue, string> = {
  MISSING_AMOUNT: 'falta o valor',
  MISSING_DESCRIPTION: 'falta a descrição',
  TOO_MANY_INSTALLMENTS: 'parcelas vão de 1x a 24x',
  INVALID_DATE: 'data inválida',
  MISSING_ACCOUNT: 'cadastre uma conta primeiro',
};
