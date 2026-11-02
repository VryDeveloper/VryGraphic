import { addMonths, monthRange, suggestBudget } from '@vrygraphic/shared';
import { prisma } from '../../lib/prisma';
import { cents, notFound } from '../../lib/http';
import { ownedCategory } from '../categories/service';

/** Orçamento do mês com o gasto real, somado no banco por categoria. */
export async function list(userId: string, month: string) {
  const [budgets, spent] = await Promise.all([
    prisma.budget.findMany({ where: { userId, month }, include: { category: { select: { id: true, name: true } } }, orderBy: { category: { name: 'asc' } } }),
    prisma.transaction.groupBy({
      by: ['categoryId'],
      where: { userId, deletedAt: null, kind: 'EXPENSE', occurredAt: monthRange(month) },
      _sum: { amountCents: true },
    }),
  ]);
  const spentBy = new Map(spent.map((s) => [s.categoryId, -(s._sum.amountCents ?? 0n)]));
  return budgets.map((b) => {
    const limitCents = cents(b.limitCents);
    const spentCents = cents(spentBy.get(b.categoryId) ?? 0n);
    const ratio = spentCents / limitCents;
    return {
      id: b.id,
      month: b.month,
      category: b.category,
      limitCents,
      spentCents,
      remainingCents: limitCents - spentCents,
      ratio: Math.round(ratio * 1000) / 1000,
      status: ratio >= 1 ? 'over' : ratio >= 0.8 ? 'warn' : 'ok',
    };
  });
}

/** Um orçamento por categoria por mês: PUT cria ou atualiza. */
export async function upsert(userId: string, input: { categoryId: string; month: string; limitCents: number }) {
  await ownedCategory(userId, input.categoryId, 'EXPENSE');
  const limitCents = BigInt(input.limitCents);
  await prisma.budget.upsert({
    where: { userId_categoryId_month: { userId, categoryId: input.categoryId, month: input.month } },
    create: { userId, categoryId: input.categoryId, month: input.month, limitCents },
    update: { limitCents },
  });
  return (await list(userId, input.month)).find((b) => b.category.id === input.categoryId)!;
}

export async function remove(userId: string, id: string) {
  const r = await prisma.budget.deleteMany({ where: { id, userId } });
  if (r.count === 0) throw notFound('Orçamento');
}

/**
 * Planejamento do mês: TODAS as categorias de despesa, com o limite do mês, o gasto,
 * o gasto dos 2 meses anteriores (FILTER por mês numa varredura só) e a sugestão para o mês seguinte:
 * média dos 3 meses arredondada para cima em R$ 50 (suggestBudget, do shared).
 */
export async function plan(userId: string, month: string) {
  const r0 = monthRange(month);
  const r1 = monthRange(addMonths(month, -1));
  const r2 = monthRange(addMonths(month, -2));
  const nextMonth = addMonths(month, 1);

  const [rows, budgets] = await Promise.all([
    prisma.$queryRaw<{ id: string; name: string; m0: bigint; m1: bigint; m2: bigint }[]>`
      SELECT c.id, c.name,
             COALESCE(-SUM(t.amount_cents) FILTER (WHERE t.occurred_at >= ${r0.gte} AND t.occurred_at < ${r0.lt}), 0)::bigint AS m0,
             COALESCE(-SUM(t.amount_cents) FILTER (WHERE t.occurred_at >= ${r1.gte} AND t.occurred_at < ${r1.lt}), 0)::bigint AS m1,
             COALESCE(-SUM(t.amount_cents) FILTER (WHERE t.occurred_at >= ${r2.gte} AND t.occurred_at < ${r2.lt}), 0)::bigint AS m2
      FROM categories c
      LEFT JOIN transactions t
        ON t.category_id = c.id AND t.deleted_at IS NULL AND t.kind = 'EXPENSE'
       AND t.occurred_at >= ${r2.gte} AND t.occurred_at < ${r0.lt}
      WHERE c.user_id = ${userId}::uuid AND c.kind = 'EXPENSE' AND c.deleted_at IS NULL
      GROUP BY c.id, c.name`,
    prisma.budget.findMany({ where: { userId, month: { in: [month, nextMonth] } } }),
  ]);

  const limitOf = (m: string, categoryId: string) => budgets.find((b) => b.month === m && b.categoryId === categoryId);
  const items = rows
    .map((r) => {
      const spentCents = cents(r.m0);
      const history = [cents(r.m2), cents(r.m1), spentCents];
      const avg3Cents = Math.round(history.reduce((s, v) => s + v, 0) / 3);
      const suggestionCents = suggestBudget(history);
      const b = limitOf(month, r.id);
      const next = limitOf(nextMonth, r.id);
      const limitCents = b ? cents(b.limitCents) : null;
      const ratio = limitCents ? Math.round((spentCents / limitCents) * 1000) / 1000 : null;
      return {
        categoryId: r.id,
        name: r.name,
        budgetId: b?.id ?? null,
        limitCents,
        spentCents,
        ratio,
        status: ratio === null ? null : ratio >= 1 ? 'over' : ratio >= 0.8 ? 'warn' : 'ok',
        history,
        avg3Cents,
        suggestionCents,
        /** sugestão − limite atual: positivo pede mais folga, negativo dá para apertar */
        deltaCents: limitCents === null ? null : suggestionCents - limitCents,
        nextBudgetId: next?.id ?? null,
        nextLimitCents: next ? cents(next.limitCents) : null,
      };
    })
    .sort((a, b) => Number(b.limitCents !== null) - Number(a.limitCents !== null) || b.spentCents - a.spentCents || a.name.localeCompare(b.name));

  const budgeted = items.filter((i) => i.limitCents !== null);
  const sum = (xs: number[]) => xs.reduce((s, v) => s + v, 0);
  const limitTotal = sum(budgeted.map((i) => i.limitCents!));
  const spentBudgeted = sum(budgeted.map((i) => i.spentCents));
  return {
    month,
    nextMonth,
    items,
    totals: {
      limitCents: limitTotal,
      spentCents: sum(items.map((i) => i.spentCents)),
      spentBudgetedCents: spentBudgeted,
      used: limitTotal ? Math.round((spentBudgeted / limitTotal) * 1000) / 1000 : null,
      leftCents: limitTotal - spentBudgeted,
      avg3Cents: sum(items.map((i) => i.avg3Cents)),
      suggestionCents: sum(items.map((i) => i.suggestionCents)),
    },
  };
}

/** Aplica vários limites num mês de uma vez, numa transação só (ou todos, ou nenhum). */
export async function apply(userId: string, input: { month: string; items: { categoryId: string; limitCents: number }[] }) {
  for (const it of input.items) await ownedCategory(userId, it.categoryId, 'EXPENSE');
  await prisma.$transaction(
    input.items.map((it) =>
      prisma.budget.upsert({
        where: { userId_categoryId_month: { userId, categoryId: it.categoryId, month: input.month } },
        create: { userId, categoryId: it.categoryId, month: input.month, limitCents: BigInt(it.limitCents) },
        update: { limitCents: BigInt(it.limitCents) },
      }),
    ),
  );
  return { applied: input.items.length };
}
