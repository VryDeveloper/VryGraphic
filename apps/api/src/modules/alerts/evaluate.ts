import { addMonths, dayOfMonth, formatPct, formatPlain, invoiceMonthFor, monthRange, todayISO } from '@vrygraphic/shared';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { list as listGoals } from '../goals/service';
import { getRules } from './rules';

export type AlertLevel = 'over' | 'warn' | 'info' | 'good';
interface NewAlert { kind: string; dedupeKey: string; message: string; payload: { level: AlertLevel } & Record<string, string | number | null> }

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const mmm = (m: string | null) => (m ? `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}` : 'sem previsão');
const ddmm = (d: string) => `${d.slice(8)}/${d.slice(5, 7)}`;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);
const endOfDay = (d: string) => new Date(Date.parse(`${d}T00:00:00-03:00`) + 864e5);

/**
 * Avalia as regras ligadas e grava os alertas novos. Cada alerta tem uma `dedupe_key` única por usuário
 * (ex.: "budget-over:<categoria>:2026-10"), e o INSERT usa ON CONFLICT DO NOTHING (skipDuplicates):
 * rodar de novo, ou em paralelo, nunca duplica. Devolve quantos alertas novos entraram.
 */
export async function evaluateAlerts(userId: string, today = todayISO()): Promise<number> {
  const rules = await getRules(userId);
  const month = today.slice(0, 7);
  const out: NewAlert[] = [];

  if (rules.BUDGET_THRESHOLD.enabled) {
    const th = rules.BUDGET_THRESHOLD.threshold ?? 90;
    const [budgets, spent] = await Promise.all([
      prisma.budget.findMany({ where: { userId, month }, include: { category: { select: { name: true } } } }),
      prisma.transaction.groupBy({
        by: ['categoryId'],
        where: { userId, deletedAt: null, kind: 'EXPENSE', occurredAt: { gte: monthRange(month).gte, lt: endOfDay(today) } },
        _sum: { amountCents: true },
      }),
    ]);
    const spentBy = new Map(spent.map((s) => [s.categoryId, -Number(s._sum.amountCents ?? 0n)]));
    for (const b of budgets) {
      const s = spentBy.get(b.categoryId) ?? 0;
      const limit = Number(b.limitCents);
      const ratio = s / limit;
      if (ratio >= 1) {
        out.push({ kind: 'BUDGET_THRESHOLD', dedupeKey: `budget-over:${b.categoryId}:${month}`, message: `${b.category.name} passou do limite em ${formatPlain(s - limit)}`, payload: { level: 'over', categoryId: b.categoryId, month } });
      } else if (ratio * 100 >= th) {
        out.push({ kind: 'BUDGET_THRESHOLD', dedupeKey: `budget-${th}:${b.categoryId}:${month}`, message: `${b.category.name} em ${formatPct(ratio)} do limite`, payload: { level: 'warn', categoryId: b.categoryId, month } });
      }
    }
  }

  if (rules.INVOICE_CLOSING.enabled) {
    const days = rules.INVOICE_CLOSING.threshold ?? 5;
    const cards = await prisma.account.findMany({ where: { userId, deletedAt: null, kind: 'CREDIT_CARD', closingDay: { not: null } } });
    for (const c of cards) {
      const thisMonth = dayOfMonth(month, c.closingDay!);
      const closing = today <= thisMonth ? thisMonth : dayOfMonth(addMonths(month, 1), c.closingDay!);
      const inDays = daysBetween(today, closing);
      if (inDays > days) continue;
      const invoice = await prisma.cardInvoice.findUnique({ where: { accountId_month: { accountId: c.id, month: invoiceMonthFor(closing, c.closingDay!) } } });
      const total = invoice
        ? -Number((await prisma.transaction.aggregate({ where: { invoiceId: invoice.id, deletedAt: null, kind: 'EXPENSE' }, _sum: { amountCents: true } }))._sum.amountCents ?? 0n)
        : 0;
      out.push({
        kind: 'INVOICE_CLOSING',
        dedupeKey: `invoice:${c.id}:${closing}`,
        message: `${c.name} fecha ${inDays === 0 ? 'hoje' : `em ${inDays} dia${inDays > 1 ? 's' : ''}`} (${ddmm(closing)}) · ${formatPlain(total)} até agora`,
        payload: { level: 'info', accountId: c.id, closing },
      });
    }
  }

  if (rules.GOAL_ETA_CHANGED.enabled) {
    const [goals, rows] = await Promise.all([listGoals(userId), prisma.goal.findMany({ where: { userId }, select: { id: true, lastEtaMonth: true } })]);
    for (const g of goals) {
      const eta = g.projection.etaMonth;
      const last = rows.find((r) => r.id === g.id)?.lastEtaMonth ?? null;
      if (eta === last) continue;
      // primeira avaliação só registra a previsão; daí em diante, mudança vira alerta
      if (last !== null) {
        const better = eta !== null && eta < last;
        out.push({
          kind: 'GOAL_ETA_CHANGED',
          dedupeKey: `goal-eta:${g.id}:${last}>${eta ?? 'nunca'}`,
          message: `${g.name}: previsão ${better ? 'adiantou' : 'mudou'} de ${mmm(last)} para ${mmm(eta)}`,
          payload: { level: better ? 'good' : 'warn', goalId: g.id, from: last, to: eta },
        });
      }
      await prisma.goal.update({ where: { id: g.id }, data: { lastEtaMonth: eta } });
    }
  }

  if (rules.RECURRENCE_MISSED.enabled) {
    const late = await prisma.recurrence.findMany({ where: { userId, active: true, nextRunOn: { lt: new Date(`${today}T00:00:00Z`) } } });
    for (const r of late) {
      const due = r.nextRunOn.toISOString().slice(0, 10);
      out.push({ kind: 'RECURRENCE_MISSED', dedupeKey: `recurrence-missed:${r.id}:${due}`, message: `${r.description} não foi lançada (vencia ${ddmm(due)})`, payload: { level: 'warn', recurrenceId: r.id, due } });
    }
  }

  if (!out.length) return 0;
  const r = await prisma.alert.createMany({ data: out.map((a) => ({ userId, ...a, payload: a.payload as Prisma.InputJsonObject })), skipDuplicates: true });
  return r.count;
}
