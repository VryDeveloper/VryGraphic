import type { Recurrence } from '@prisma/client';
import { addMonths, dayOfMonth, todayISO, type RecurrenceCreate, type RecurrenceUpdate } from '@vrygraphic/shared';
import { prisma } from '../../lib/prisma';
import { cents, notFound } from '../../lib/http';
import { ownedAccount } from '../accounts/service';
import { ownedCategory } from '../categories/service';

/** Próxima ocorrência a partir de hoje: este mês se o dia ainda não passou, senão o mês que vem (dia preso ao fim do mês). */
export function nextOccurrence(day: number, today = todayISO()): string {
  const thisMonth = dayOfMonth(today.slice(0, 7), day);
  return thisMonth >= today ? thisMonth : dayOfMonth(addMonths(today.slice(0, 7), 1), day);
}
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);

type Row = Recurrence & { account: { name: string; kind: string }; category: { name: string }; _count: { transactions: number } };

function toDto(r: Row) {
  const amount = cents(r.amountCents);
  return {
    id: r.id,
    kind: amount < 0 ? ('EXPENSE' as const) : ('INCOME' as const),
    description: r.description,
    amountCents: Math.abs(amount),
    dayOfMonth: r.dayOfMonth,
    nextRunOn: r.nextRunOn.toISOString().slice(0, 10),
    active: r.active,
    account: { id: r.accountId, name: r.account.name, kind: r.account.kind },
    category: { id: r.categoryId, name: r.category.name },
    /** quantas vezes já foi lançada */
    launched: r._count.transactions,
  };
}

const include = {
  account: { select: { name: true, kind: true } },
  category: { select: { name: true } },
  _count: { select: { transactions: { where: { deletedAt: null } } } },
} as const;

export async function list(userId: string) {
  const rows = await prisma.recurrence.findMany({ where: { userId, account: { deletedAt: null } }, include, orderBy: [{ active: 'desc' }, { dayOfMonth: 'asc' }, { description: 'asc' }] });
  return rows.map(toDto);
}

export async function create(userId: string, input: RecurrenceCreate) {
  await ownedAccount(userId, input.accountId);
  await ownedCategory(userId, input.categoryId, input.kind);
  const r = await prisma.recurrence.create({
    data: {
      userId,
      accountId: input.accountId,
      categoryId: input.categoryId,
      description: input.description,
      amountCents: BigInt(input.kind === 'EXPENSE' ? -input.amountCents : input.amountCents),
      dayOfMonth: input.dayOfMonth,
      nextRunOn: asDate(nextOccurrence(input.dayOfMonth)),
    },
    include,
  });
  return toDto(r);
}

export async function update(userId: string, id: string, input: RecurrenceUpdate) {
  const r = await prisma.recurrence.findFirst({ where: { id, userId } });
  if (!r) throw notFound('Conta fixa');
  const kind = r.amountCents < 0n ? 'EXPENSE' : 'INCOME';
  if (input.accountId) await ownedAccount(userId, input.accountId);
  if (input.categoryId) await ownedCategory(userId, input.categoryId, kind);
  // mudar o dia ou reativar recalcula a próxima execução a partir de hoje (não lança meses passados de uma vez)
  const recompute = (input.dayOfMonth !== undefined && input.dayOfMonth !== r.dayOfMonth) || (input.active === true && !r.active);
  const saved = await prisma.recurrence.update({
    where: { id },
    data: {
      description: input.description,
      accountId: input.accountId,
      categoryId: input.categoryId,
      dayOfMonth: input.dayOfMonth,
      active: input.active,
      amountCents: input.amountCents === undefined ? undefined : BigInt(kind === 'EXPENSE' ? -input.amountCents : input.amountCents),
      ...(recompute ? { nextRunOn: asDate(nextOccurrence(input.dayOfMonth ?? r.dayOfMonth)) } : {}),
    },
    include,
  });
  return toDto(saved);
}

/** Excluir a conta fixa não apaga o que já foi lançado: os lançamentos só perdem o vínculo (ON DELETE SET NULL). */
export async function remove(userId: string, id: string) {
  const r = await prisma.recurrence.deleteMany({ where: { id, userId } });
  if (r.count === 0) throw notFound('Conta fixa');
}
