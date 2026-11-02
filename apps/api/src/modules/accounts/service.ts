import type { Account, Prisma } from '@prisma/client';
import type { AccountCreate, AccountUpdate } from '@vrygraphic/shared';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { badReference, cents, notFound, num } from '../../lib/http';

/** Saldo nunca é guardado: saldo = saldo inicial + soma dos lançamentos não excluídos. */
async function balances(userId: string): Promise<Map<string, bigint>> {
  const rows = await prisma.transaction.groupBy({ by: ['accountId'], where: { userId, deletedAt: null }, _sum: { amountCents: true } });
  return new Map(rows.map((r) => [r.accountId, r._sum.amountCents ?? 0n]));
}

export function toAccountDto(a: Account, movedCents: bigint) {
  const balance = a.openingBalanceCents + movedCents;
  return {
    id: a.id,
    name: a.name,
    kind: a.kind,
    aliases: a.aliases,
    openingBalanceCents: cents(a.openingBalanceCents),
    balanceCents: cents(balance),
    creditLimitCents: num(a.creditLimitCents),
    /** Cartão: limite − o que está em aberto (saldo negativo). */
    availableCents: a.kind === 'CREDIT_CARD' && a.creditLimitCents !== null ? cents(a.creditLimitCents + balance) : null,
    closingDay: a.closingDay,
    dueDay: a.dueDay,
  };
}

export async function list(userId: string) {
  const [accounts, moved] = await Promise.all([
    prisma.account.findMany({ where: { userId, deletedAt: null }, orderBy: { createdAt: 'asc' } }),
    balances(userId),
  ]);
  return accounts.map((a) => toAccountDto(a, moved.get(a.id) ?? 0n));
}

/** Conta do usuário, ativa. Usada por outros módulos para validar referências. */
export async function ownedAccount(userId: string, id: string, field = 'accountId') {
  const a = await prisma.account.findFirst({ where: { id, userId, deletedAt: null } });
  if (!a) throw badReference(field, 'conta não encontrada');
  return a;
}

async function assertAliasesFree(userId: string, aliases: string[] | undefined, exceptId?: string) {
  if (!aliases?.length) return;
  const clash = await prisma.account.findFirst({
    where: { userId, deletedAt: null, aliases: { hasSome: aliases }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
  });
  if (clash) throw new AppError(409, 'ALIAS_TAKEN', `Apelido já usado em "${clash.name}"`, { aliases: 'apelido já usado em outra conta' });
}

export async function create(userId: string, input: AccountCreate) {
  await assertAliasesFree(userId, input.aliases);
  const card = input.kind === 'CREDIT_CARD';
  const a = await prisma.account.create({
    data: {
      userId,
      name: input.name,
      kind: input.kind,
      aliases: input.aliases,
      openingBalanceCents: BigInt(input.openingBalanceCents),
      creditLimitCents: card && input.creditLimitCents ? BigInt(input.creditLimitCents) : null,
      closingDay: card ? input.closingDay : null,
      dueDay: card ? input.dueDay : null,
    },
  });
  return toAccountDto(a, 0n);
}

export async function update(userId: string, id: string, input: AccountUpdate) {
  const a = await prisma.account.findFirst({ where: { id, userId, deletedAt: null } });
  if (!a) throw notFound('Conta');
  await assertAliasesFree(userId, input.aliases, id);
  const card = a.kind === 'CREDIT_CARD';
  const data: Prisma.AccountUpdateInput = {
    name: input.name,
    aliases: input.aliases,
    openingBalanceCents: input.openingBalanceCents === undefined ? undefined : BigInt(input.openingBalanceCents),
  };
  if (card) {
    if (input.creditLimitCents !== undefined) data.creditLimitCents = input.creditLimitCents === null ? null : BigInt(input.creditLimitCents);
    if (input.closingDay) data.closingDay = input.closingDay;
    if (input.dueDay) data.dueDay = input.dueDay;
  }
  const saved = await prisma.account.update({ where: { id }, data });
  return toAccountDto(saved, (await balances(userId)).get(id) ?? 0n);
}

/** Exclusão lógica: os lançamentos antigos continuam apontando para a conta. */
export async function remove(userId: string, id: string) {
  const a = await prisma.account.findFirst({ where: { id, userId, deletedAt: null } });
  if (!a) throw notFound('Conta');
  const goal = await prisma.goal.findFirst({ where: { userId, accountId: id } });
  if (goal) throw new AppError(409, 'ACCOUNT_IN_USE', `A meta "${goal.name}" usa esta conta. Mude a meta antes de excluir.`);
  await prisma.account.update({ where: { id }, data: { deletedAt: new Date() } });
}
