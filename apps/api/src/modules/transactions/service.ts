import { randomUUID } from 'node:crypto';
import type { Account, Prisma, TxSource } from '@prisma/client';
import {
  addMonths,
  addMonthsToDate,
  buildCommandContext,
  dateToInstant,
  dayOfMonth,
  installmentSchedule,
  instantToDate,
  invoiceMonthFor,
  ISSUE_MESSAGES,
  monthRange,
  parseCommand,
  todayISO,
  type TransactionCreate,
  type TransactionListQuery,
  type TransactionUpdate,
  type TransferCreate,
} from '@vrygraphic/shared';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { cents, notFound } from '../../lib/http';
import { ownedAccount } from '../accounts/service';
import { ownedCategory } from '../categories/service';

type Db = Prisma.TransactionClient;

const include = {
  account: { select: { id: true, name: true, kind: true } },
  category: { select: { id: true, name: true } },
  installmentPlan: { select: { id: true, count: true, totalCents: true } },
  invoice: { select: { month: true } },
} satisfies Prisma.TransactionInclude;
type Row = Prisma.TransactionGetPayload<{ include: typeof include }>;

export function toDto(t: Row) {
  return {
    id: t.id,
    kind: t.kind,
    description: t.description,
    amountCents: cents(t.amountCents),
    date: instantToDate(t.occurredAt),
    account: t.account,
    category: t.category,
    installment: t.installmentPlan
      ? { planId: t.installmentPlan.id, number: t.installmentNo, count: t.installmentPlan.count, totalCents: cents(t.installmentPlan.totalCents) }
      : null,
    invoiceMonth: t.invoice?.month ?? null,
    transferGroupId: t.transferGroupId,
    /** ligada a uma conta fixa (lançada pelo job ou pelo demo) */
    recurring: t.recurrenceId !== null,
    source: t.source,
  };
}
export type TransactionDto = ReturnType<typeof toDto>;

/**
 * Fatura do cartão para o mês "AAAA-MM", criada na primeira compra que cai nela.
 * Fecha no dia de fechamento do mês; vence no mesmo mês se o vencimento for depois do fechamento, senão no seguinte.
 */
async function invoiceFor(db: Db, card: Account, month: string) {
  const closingDay = card.closingDay ?? 1;
  const dueDay = card.dueDay ?? closingDay;
  const closing = dayOfMonth(month, closingDay);
  const due = dayOfMonth(dueDay > closingDay ? month : addMonths(month, 1), dueDay);
  return db.cardInvoice.upsert({
    where: { accountId_month: { accountId: card.id, month } },
    create: { accountId: card.id, month, closingDate: new Date(`${closing}T00:00:00Z`), dueDate: new Date(`${due}T00:00:00Z`) },
    update: {},
  });
}

const signed = (kind: 'INCOME' | 'EXPENSE', amount: number) => BigInt(kind === 'EXPENSE' ? -amount : amount);

/**
 * Cria um lançamento ou, com `installments > 1`, as N parcelas numa única transação do banco:
 * ou grava tudo, ou nada. No cartão, cada parcela cai na fatura de um mês; o resto da divisão vai na 1ª.
 */
export async function create(
  userId: string,
  input: TransactionCreate,
  source: TxSource = 'MANUAL',
  extra: { recurrenceId?: string } = {},
): Promise<TransactionDto[]> {
  const account = await ownedAccount(userId, input.accountId);
  if (input.categoryId) await ownedCategory(userId, input.categoryId, input.kind);

  const card = account.kind === 'CREDIT_CARD';
  const firstMonth = card ? invoiceMonthFor(input.date, account.closingDay ?? 1) : input.date.slice(0, 7);
  const schedule = installmentSchedule(input.amountCents, input.installments, firstMonth);

  return prisma.$transaction(async (db) => {
    const plan =
      input.installments > 1
        ? await db.installmentPlan.create({
            data: { userId, description: input.description, totalCents: signed(input.kind, input.amountCents), count: input.installments },
          })
        : null;
    const rows: Row[] = [];
    for (const p of schedule) {
      const invoice = card ? await invoiceFor(db, account, p.invoiceMonth) : null;
      rows.push(
        await db.transaction.create({
          data: {
            userId,
            accountId: account.id,
            categoryId: input.categoryId,
            kind: input.kind,
            amountCents: signed(input.kind, p.amountCents),
            description: input.description,
            occurredAt: dateToInstant(addMonthsToDate(input.date, p.number - 1)),
            invoiceId: invoice?.id ?? null,
            installmentPlanId: plan?.id ?? null,
            installmentNo: plan ? p.number : null,
            recurrenceId: extra.recurrenceId ?? null,
            source,
          },
          include,
        }),
      );
    }
    return rows.map(toDto);
  });
}

/** A barra de comando: interpreta com as contas e categorias do próprio usuário e grava. */
export async function createFromCommand(userId: string, text: string, source: TxSource = 'COMMAND') {
  const [accounts, categories] = await Promise.all([
    prisma.account.findMany({ where: { userId, deletedAt: null }, orderBy: { createdAt: 'asc' } }),
    prisma.category.findMany({ where: { userId, deletedAt: null } }),
  ]);
  const parsed = parseCommand(text, buildCommandContext({ accounts, categories, today: todayISO() }));
  if (!parsed.ok || !parsed.amountCents || !parsed.accountId) {
    const msg = parsed.issues.map((i) => ISSUE_MESSAGES[i]).join(', ');
    throw new AppError(422, 'COMMAND_INCOMPLETE', msg, { text: msg });
  }
  const items = await create(
    userId,
    {
      kind: parsed.kind,
      description: parsed.description,
      amountCents: Math.abs(parsed.amountCents),
      accountId: parsed.accountId,
      categoryId: parsed.categoryId,
      date: parsed.date,
      installments: parsed.installments,
    },
    source,
  );
  return { parsed, items };
}

// ── listagem com paginação por cursor ──────────────────────────────────────────
// Ordem: data desc, depois o lançado por último primeiro, e o id para desempatar de vez.
// O cursor guarda esse trio do último item, então a página seguinte é "tudo depois dele na ordem":
// estável mesmo com lançamentos novos chegando no meio da navegação (OFFSET pularia ou repetiria).

type CursorKey = { occurredAt: Date; createdAt: Date; id: string };

function encodeCursor(t: CursorKey) {
  return Buffer.from(`${t.occurredAt.toISOString()}|${t.createdAt.toISOString()}|${t.id}`).toString('base64url');
}
function decodeCursor(c: string): CursorKey {
  const [at, created, id] = Buffer.from(c, 'base64url').toString().split('|');
  const occurredAt = new Date(at);
  const createdAt = new Date(created);
  if (!id || Number.isNaN(occurredAt.getTime()) || Number.isNaN(createdAt.getTime())) {
    throw new AppError(400, 'BAD_CURSOR', 'Cursor de paginação inválido');
  }
  return { occurredAt, createdAt, id };
}

/** "Vem depois de c" na ordem (occurredAt desc, createdAt desc, id desc). */
function after(c: CursorKey): Prisma.TransactionWhereInput {
  return {
    OR: [
      { occurredAt: { lt: c.occurredAt } },
      { occurredAt: c.occurredAt, createdAt: { lt: c.createdAt } },
      { occurredAt: c.occurredAt, createdAt: c.createdAt, id: { lt: c.id } },
    ],
  };
}

export async function list(userId: string, q: TransactionListQuery) {
  const where: Prisma.TransactionWhereInput = {
    userId,
    deletedAt: null,
    accountId: q.accountId,
    categoryId: q.categoryId,
    kind: q.kind,
    ...(q.month ? { occurredAt: monthRange(q.month) } : {}),
    ...(q.q ? { description: { contains: q.q, mode: 'insensitive' } } : {}),
  };
  const pageWhere: Prisma.TransactionWhereInput = q.cursor ? { AND: [where, after(decodeCursor(q.cursor))] } : where;

  const [page, sums] = await Promise.all([
    prisma.transaction.findMany({ where: pageWhere, orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }], take: q.limit + 1, include }),
    prisma.transaction.groupBy({ by: ['kind'], where, _sum: { amountCents: true }, _count: { _all: true } }),
  ]);

  const items = page.slice(0, q.limit);
  const sum = (k: string) => sums.find((s) => s.kind === k)?._sum.amountCents ?? 0n;
  const incomeCents = cents(sum('INCOME'));
  const expenseCents = -cents(sum('EXPENSE'));
  return {
    items: items.map(toDto),
    nextCursor: page.length > q.limit ? encodeCursor(items[items.length - 1]) : null,
    totals: {
      count: sums.reduce((n, s) => n + s._count._all, 0),
      incomeCents,
      expenseCents,
      netCents: incomeCents - expenseCents,
    },
  };
}

export async function get(userId: string, id: string) {
  const t = await prisma.transaction.findFirst({ where: { id, userId, deletedAt: null }, include });
  if (!t) throw notFound('Lançamento');
  return toDto(t);
}

/**
 * Edição. Regras:
 * - transferência não se edita (são duas pernas): exclua e faça de novo;
 * - parcela: só descrição e categoria, aplicadas ao parcelamento inteiro;
 *   valor, data e conta mudariam a divisão e as faturas, então pedem um lançamento novo;
 * - no cartão, mudar a data ou a conta recalcula a fatura.
 */
export async function update(userId: string, id: string, input: TransactionUpdate) {
  const t = await prisma.transaction.findFirst({ where: { id, userId, deletedAt: null } });
  if (!t) throw notFound('Lançamento');
  if (t.kind === 'TRANSFER') throw new AppError(409, 'TRANSFER_LOCKED', 'Transferências não são editadas. Exclua e faça de novo.');
  const kind = t.kind;
  if (input.categoryId) await ownedCategory(userId, input.categoryId, kind);

  if (t.installmentPlanId) {
    if (input.amountCents !== undefined || input.date !== undefined || input.accountId !== undefined) {
      throw new AppError(409, 'INSTALLMENT_LOCKED', 'Para mudar valor, data ou conta de um parcelamento, exclua e lance de novo.');
    }
    const planId = t.installmentPlanId;
    await prisma.$transaction([
      prisma.transaction.updateMany({ where: { userId, installmentPlanId: planId }, data: { description: input.description, categoryId: input.categoryId } }),
      ...(input.description ? [prisma.installmentPlan.update({ where: { id: planId }, data: { description: input.description } })] : []),
    ]);
    return get(userId, id);
  }

  const account = input.accountId ? await ownedAccount(userId, input.accountId) : await prisma.account.findUniqueOrThrow({ where: { id: t.accountId } });
  const date = input.date ?? instantToDate(t.occurredAt);
  const saved = await prisma.$transaction(async (db) => {
    const invoice = account.kind === 'CREDIT_CARD' ? await invoiceFor(db, account, invoiceMonthFor(date, account.closingDay ?? 1)) : null;
    return db.transaction.update({
      where: { id },
      data: {
        description: input.description,
        categoryId: input.categoryId,
        accountId: account.id,
        occurredAt: dateToInstant(date),
        amountCents: input.amountCents === undefined ? undefined : signed(kind, input.amountCents),
        invoiceId: invoice?.id ?? null,
      },
      include,
    });
  });
  return toDto(saved);
}

/** Excluir uma parcela exclui o parcelamento; excluir uma perna exclui a transferência. Tudo com desfazer. */
function groupOf(t: { id: string; installmentPlanId: string | null; transferGroupId: string | null }): Prisma.TransactionWhereInput {
  if (t.installmentPlanId) return { installmentPlanId: t.installmentPlanId };
  if (t.transferGroupId) return { transferGroupId: t.transferGroupId };
  return { id: t.id };
}

export async function remove(userId: string, id: string) {
  const t = await prisma.transaction.findFirst({ where: { id, userId, deletedAt: null } });
  if (!t) throw notFound('Lançamento');
  const r = await prisma.transaction.updateMany({ where: { userId, deletedAt: null, ...groupOf(t) }, data: { deletedAt: new Date() } });
  return { deleted: r.count };
}

export async function restore(userId: string, id: string) {
  const t = await prisma.transaction.findFirst({ where: { id, userId, deletedAt: { not: null } } });
  if (!t) throw notFound('Lançamento excluído');
  const r = await prisma.transaction.updateMany({ where: { userId, deletedAt: { not: null }, ...groupOf(t) }, data: { deletedAt: null } });
  return { restored: r.count };
}

/** Transferência = duas pernas com o mesmo `transferGroupId`: sai de uma conta, entra na outra. Soma zero. */
export async function transfer(userId: string, input: TransferCreate, source: TxSource = 'MANUAL') {
  const [from, to] = await Promise.all([ownedAccount(userId, input.fromAccountId, 'fromAccountId'), ownedAccount(userId, input.toAccountId, 'toAccountId')]);
  const groupId = randomUUID();
  const occurredAt = dateToInstant(input.date);
  const rows = await prisma.$transaction(async (db) => {
    // saque no cartão entra na fatura; pagar a fatura (destino = cartão) não
    const invoice = from.kind === 'CREDIT_CARD' ? await invoiceFor(db, from, invoiceMonthFor(input.date, from.closingDay ?? 1)) : null;
    const base = { userId, kind: 'TRANSFER' as const, description: input.description, occurredAt, transferGroupId: groupId, source };
    const out = await db.transaction.create({ data: { ...base, accountId: from.id, amountCents: BigInt(-input.amountCents), invoiceId: invoice?.id ?? null }, include });
    const inn = await db.transaction.create({ data: { ...base, accountId: to.id, amountCents: BigInt(input.amountCents) }, include });
    return [out, inn];
  });
  return { transferGroupId: groupId, items: rows.map(toDto) };
}
