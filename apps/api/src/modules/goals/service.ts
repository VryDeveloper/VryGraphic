import type { Goal } from '@prisma/client';
import { addMonths, simulateGoal, todayISO, type GoalCreate, type GoalUpdate } from '@vrygraphic/shared';
import { prisma } from '../../lib/prisma';
import { cents, notFound } from '../../lib/http';
import { list as listAccounts, ownedAccount } from '../accounts/service';

/** Meta = saldo atual da conta vinculada + aportes mensais com juros compostos (simulação do shared). */
function toDto(g: Goal, account: { id: string; name: string; balanceCents: number } | undefined) {
  const currentCents = Math.max(0, account?.balanceCents ?? 0);
  const targetCents = cents(g.targetCents);
  const sim = simulateGoal({
    currentCents,
    targetCents,
    monthlyContributionCents: cents(g.monthlyContributionCents),
    monthlyRateBps: g.monthlyRateBps,
    maxMonths: 600,
  });
  return {
    id: g.id,
    name: g.name,
    account: account ? { id: account.id, name: account.name } : null,
    targetCents,
    currentCents,
    progress: Math.min(1, Math.round((currentCents / targetCents) * 1000) / 1000),
    monthlyContributionCents: cents(g.monthlyContributionCents),
    monthlyRateBps: g.monthlyRateBps,
    projection: {
      reached: sim.reached,
      months: sim.months,
      /** Mês em que a meta é atingida, ou null se não chega em 50 anos. */
      etaMonth: sim.reached ? addMonths(todayISO().slice(0, 7), sim.months) : null,
      depositedCents: sim.depositedCents,
      interestCents: sim.interestCents,
      path: sim.path.slice(0, 120),
    },
  };
}

export async function list(userId: string) {
  const [goals, accounts] = await Promise.all([prisma.goal.findMany({ where: { userId }, orderBy: { name: 'asc' } }), listAccounts(userId)]);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  return goals.map((g) => toDto(g, byId.get(g.accountId)));
}

async function one(userId: string, id: string) {
  return (await list(userId)).find((g) => g.id === id)!;
}

export async function create(userId: string, input: GoalCreate) {
  await ownedAccount(userId, input.accountId);
  const g = await prisma.goal.create({
    data: {
      userId,
      name: input.name,
      accountId: input.accountId,
      targetCents: BigInt(input.targetCents),
      monthlyContributionCents: BigInt(input.monthlyContributionCents),
      monthlyRateBps: input.monthlyRateBps,
    },
  });
  return one(userId, g.id);
}

export async function update(userId: string, id: string, input: GoalUpdate) {
  const g = await prisma.goal.findFirst({ where: { id, userId } });
  if (!g) throw notFound('Meta');
  if (input.accountId) await ownedAccount(userId, input.accountId);
  await prisma.goal.update({
    where: { id },
    data: {
      name: input.name,
      accountId: input.accountId,
      targetCents: input.targetCents === undefined ? undefined : BigInt(input.targetCents),
      monthlyContributionCents: input.monthlyContributionCents === undefined ? undefined : BigInt(input.monthlyContributionCents),
      monthlyRateBps: input.monthlyRateBps,
    },
  });
  return one(userId, id);
}

export async function remove(userId: string, id: string) {
  const r = await prisma.goal.deleteMany({ where: { id, userId } });
  if (r.count === 0) throw notFound('Meta');
}
