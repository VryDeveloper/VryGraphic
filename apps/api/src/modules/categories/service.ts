import type { TxKind } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { badReference, notFound } from '../../lib/http';

export async function list(userId: string) {
  const [cats, usage] = await Promise.all([
    prisma.category.findMany({ where: { userId, deletedAt: null }, orderBy: [{ kind: 'asc' }, { name: 'asc' }] }),
    prisma.transaction.groupBy({ by: ['categoryId'], where: { userId, deletedAt: null }, _count: { _all: true } }),
  ]);
  const count = new Map(usage.map((u) => [u.categoryId, u._count._all]));
  return cats.map((c) => ({ id: c.id, name: c.name, kind: c.kind, transactionCount: count.get(c.id) ?? 0 }));
}

/** Categoria do usuário, ativa e do tipo certo (não dá para lançar despesa em "Trabalho"). */
export async function ownedCategory(userId: string, id: string, kind?: TxKind) {
  const c = await prisma.category.findFirst({ where: { id, userId, deletedAt: null } });
  if (!c) throw badReference('categoryId', 'categoria não encontrada');
  if (kind && c.kind !== kind) throw badReference('categoryId', kind === 'EXPENSE' ? 'essa categoria é de receita' : 'essa categoria é de despesa');
  return c;
}

const taken = () => new AppError(409, 'NAME_TAKEN', 'Já existe uma categoria com esse nome', { name: 'nome já usado' });

export async function create(userId: string, input: { name: string; kind: TxKind }) {
  const existing = await prisma.category.findUnique({ where: { userId_name: { userId, name: input.name } } });
  if (existing && !existing.deletedAt) throw taken();
  // recriar uma categoria excluída com o mesmo nome a traz de volta, com o histórico dela
  const c = existing
    ? await prisma.category.update({ where: { id: existing.id }, data: { deletedAt: null, kind: input.kind } })
    : await prisma.category.create({ data: { userId, name: input.name, kind: input.kind } });
  return { id: c.id, name: c.name, kind: c.kind, transactionCount: 0 };
}

export async function rename(userId: string, id: string, name: string) {
  const c = await prisma.category.findFirst({ where: { id, userId, deletedAt: null } });
  if (!c) throw notFound('Categoria');
  const clash = await prisma.category.findUnique({ where: { userId_name: { userId, name } } });
  if (clash && clash.id !== id) throw taken();
  const saved = await prisma.category.update({ where: { id }, data: { name } });
  return { id: saved.id, name: saved.name, kind: saved.kind };
}

export async function remove(userId: string, id: string) {
  const c = await prisma.category.findFirst({ where: { id, userId, deletedAt: null } });
  if (!c) throw notFound('Categoria');
  await prisma.$transaction([
    prisma.budget.deleteMany({ where: { userId, categoryId: id } }),
    prisma.category.update({ where: { id }, data: { deletedAt: new Date() } }),
  ]);
}
