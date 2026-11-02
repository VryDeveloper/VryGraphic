import { DEFAULT_CATEGORIES, DEMO_ACCOUNTS, addMonths, dayOfMonth, todayISO } from '@vrygraphic/shared';
import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma';
import * as tx from '../transactions/service';
import { evaluateAlerts } from '../alerts/evaluate';
import { DEMO_BUDGETS, DEMO_GOALS, DEMO_OPENING, DEMO_RECURRENCES, generateDemo, type DemoAccountKey } from './generate';

export const DEMO_EMAIL = 'demo@vrygraphic.dev';
export const DEMO_PASSWORD = 'demo12345';

/**
 * Recria o usuário demo do zero com 12 meses de histórico.
 * Usa os MESMOS serviços da API (parcelas, faturas, transferências), então o demo
 * exercita o caminho de verdade em vez de inserir linhas "por fora".
 */
export async function resetDemo(today = todayISO(), opts: { bcryptCost?: number } = {}) {
  await prisma.user.deleteMany({ where: { email: DEMO_EMAIL } });

  const user = await prisma.user.create({
    data: {
      name: 'Victor (demo)',
      email: DEMO_EMAIL,
      passwordHash: await bcrypt.hash(DEMO_PASSWORD, opts.bcryptCost ?? 12),
      isDemo: true,
      categories: { create: DEFAULT_CATEGORIES.map((c) => ({ name: c.name, kind: c.kind })) },
      accounts: {
        create: DEMO_ACCOUNTS.map((a) => ({
          name: a.name,
          kind: a.kind,
          aliases: [...a.aliases],
          openingBalanceCents: BigInt(DEMO_OPENING[a.key]),
          ...(a.kind === 'CREDIT_CARD' ? { creditLimitCents: 800000n, closingDay: 5, dueDay: 10 } : {}),
        })),
      },
    },
    include: { accounts: true, categories: true },
  });

  const account = (k: DemoAccountKey) => user.accounts.find((a) => a.name === DEMO_ACCOUNTS.find((d) => d.key === k)!.name)!.id;
  const category = (name: string) => user.categories.find((c) => c.name === name)!.id;

  // recorrências: o gerador já lançou as ocorrências até hoje; a próxima é a primeira DEPOIS de hoje,
  // que o job de contas fixas vai lançar sozinho quando chegar o dia
  const thisMonth = today.slice(0, 7);
  const firstAfterToday = (day: number) => (dayOfMonth(thisMonth, day) > today ? dayOfMonth(thisMonth, day) : dayOfMonth(addMonths(thisMonth, 1), day));
  const recurrence = new Map<string, string>();
  for (const r of DEMO_RECURRENCES) {
    const row = await prisma.recurrence.create({
      data: {
        userId: user.id,
        accountId: account(r.account),
        categoryId: category(r.category),
        description: r.description,
        amountCents: BigInt(-r.amountCents),
        dayOfMonth: r.day,
        nextRunOn: new Date(`${firstAfterToday(r.day)}T00:00:00Z`),
      },
    });
    recurrence.set(r.key, row.id);
  }

  for (const op of generateDemo(today)) {
    if (op.type === 'tx') {
      await tx.create(
        user.id,
        {
          kind: op.kind,
          description: op.description,
          amountCents: op.amountCents,
          accountId: account(op.account),
          categoryId: category(op.category),
          date: op.date,
          installments: op.installments ?? 1,
        },
        'DEMO',
        { recurrenceId: op.recurrence ? recurrence.get(op.recurrence) : undefined },
      );
    } else {
      await tx.transfer(user.id, { fromAccountId: account(op.from), toAccountId: account(op.to), amountCents: op.amountCents, date: op.date, description: op.description }, 'DEMO');
    }
  }

  // faturas já vencidas: paga com transferência da conta corrente e marca como PAGA; fechadas e não vencidas ficam FECHADAS
  const card = account('cartao');
  const invoices = await prisma.cardInvoice.findMany({ where: { accountId: card }, orderBy: { month: 'asc' } });
  for (const inv of invoices) {
    const due = inv.dueDate.toISOString().slice(0, 10);
    const closing = inv.closingDate.toISOString().slice(0, 10);
    if (due <= today) {
      const sum = await prisma.transaction.aggregate({ where: { invoiceId: inv.id, deletedAt: null }, _sum: { amountCents: true } });
      const total = -Number(sum._sum.amountCents ?? 0n);
      if (total > 0) {
        await tx.transfer(user.id, { fromAccountId: account('nubank'), toAccountId: card, amountCents: total, date: due, description: `Pagamento da fatura ${inv.month}` }, 'DEMO');
      }
      await prisma.cardInvoice.update({ where: { id: inv.id }, data: { status: 'PAID' } });
    } else if (closing < today) {
      await prisma.cardInvoice.update({ where: { id: inv.id }, data: { status: 'CLOSED' } });
    }
  }

  for (const month of [addMonths(today.slice(0, 7), -1), today.slice(0, 7)]) {
    await prisma.budget.createMany({
      data: DEMO_BUDGETS.map((b) => ({ userId: user.id, categoryId: category(b.category), month, limitCents: BigInt(b.limitCents) })),
    });
  }
  for (const g of DEMO_GOALS) {
    await prisma.goal.create({
      data: { userId: user.id, accountId: account(g.account), name: g.name, targetCents: BigInt(g.targetCents), monthlyContributionCents: BigInt(g.monthlyContributionCents), monthlyRateBps: g.monthlyRateBps },
    });
  }

  await evaluateAlerts(user.id, today);
  const count = await prisma.transaction.count({ where: { userId: user.id } });
  return { userId: user.id, transactions: count };
}
