import { addMonths, dayOfMonth, monthRange, projectNetWorth, savingsRate, todayISO } from '@vrygraphic/shared';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { list as listAccounts } from '../accounts/service';
import { list as listGoals } from '../goals/service';
import { list as listAlerts } from '../alerts/service';
import { categoryRows, dailyRows, flowRows, invoicesDue, monthlyRows, spendStats } from './queries';

const shiftDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const shortMonth = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;


/** Tudo que a Visão geral precisa, num pedido só (as consultas rodam em paralelo). */
export async function dashboard(userId: string, month: string, now = new Date()) {
  const today = todayISO(now);
  const todayMonth = today.slice(0, 7);
  if (month > todayMonth) throw new AppError(400, 'FUTURE_MONTH', 'Esse mês ainda não começou');

  const monthStart = `${month}-01`;
  const monthEnd = dayOfMonth(month, 31);
  const isCurrent = month === todayMonth;
  const untilDay = isCurrent ? today : monthEnd;
  // começo de mês tem poucos dias: o gráfico de saldo mostra os últimos 30 dias, com o mês anterior apagado
  const rolling = isCurrent && Number(today.slice(8)) < 10;
  const chartStart = rolling ? shiftDays(today, -29) : monthStart;
  const range = monthRange(month);
  const nextMonth = addMonths(month, 1);
  // a Visão geral mostra o que JÁ aconteceu: no mês atual, até o fim de hoje
  const upTo = isCurrent ? new Date(Date.parse(`${today}T00:00:00-03:00`) + 864e5) : range.lt;
  const soFar = { gte: range.gte, lt: upTo };

  const [days, rollingDays, rollingStats, stats, months, categories, flow, invoices, recurrences, accounts, budgetRows, goals] = await Promise.all([
    dailyRows(userId, monthStart, monthEnd),
    rolling ? dailyRows(userId, chartStart, today) : Promise.resolve(null),
    rolling ? spendStats(userId, chartStart, today) : Promise.resolve(null),
    spendStats(userId, monthStart, untilDay),
    monthlyRows(userId, addMonths(month, -11), month, upTo),
    categoryRows(userId, soFar, monthRange(addMonths(month, -3)).gte),
    flowRows(userId, isCurrent ? now : range.lt),
    invoicesDue(userId, `${nextMonth}-01`, dayOfMonth(nextMonth, 31)),
    prisma.recurrence.findMany({ where: { userId, active: true, account: { deletedAt: null, kind: { not: 'CREDIT_CARD' } } }, orderBy: { dayOfMonth: 'asc' } }),
    listAccounts(userId),
    prisma.budget.findMany({ where: { userId, month }, include: { category: { select: { id: true, name: true } } } }),
    listGoals(userId),
  ]);

  // ── saldo diário em candles ───────────────────────────────────────────────
  // abertura = fechamento − movimento do dia; o pavio vai de abertura+saídas até abertura+entradas
  const daily = days.map((d) => {
    const future = d.day > untilDay;
    const open = d.close - d.net;
    return {
      day: d.day,
      dow: d.dow,
      future,
      open: future ? null : open,
      close: future ? null : d.close,
      high: future ? null : open + d.inflow,
      low: future ? null : open + d.outflow,
      spentCents: future ? 0 : d.spent,
    };
  });
  // gráfico de candles: o mês, ou a janela de 30 dias no começo do mês
  const chartDays = rolling
    ? rollingDays!.map((d) => {
        const open = d.close - d.net;
        return { day: d.day, dow: d.dow, future: false, open, close: d.close, high: open + d.inflow, low: open + d.outflow, spentCents: d.spent };
      })
    : daily;
  const chart = {
    window: rolling ? ('rolling' as const) : ('month' as const),
    days: chartDays.map((d) => ({ ...d, inMonth: d.day >= monthStart })),
    /** percentil 80 do gasto diário NA JANELA do gráfico (no começo do mês, os 30 dias) */
    hotThresholdCents: (rollingStats ?? stats).hotThresholdCents,
  };
  const past = chartDays.filter((d) => !d.future);
  const ohlc = past.length
    ? {
        open: past[0].open!,
        close: past[past.length - 1].close!,
        high: Math.max(...past.map((d) => d.high!)),
        low: Math.min(...past.map((d) => d.low!)),
      }
    : null;

  // ── mês a mês, patrimônio e projeção ──────────────────────────────────────
  const cur = months[months.length - 1];
  const prev = months[months.length - 2];
  const yearIncome = months.reduce((s, m) => s + m.income, 0);
  const yearExpense = months.reduce((s, m) => s + m.expense, 0);
  const ahead = Math.max(3, 12 - Number(month.slice(5, 7)));
  const balances = months.map((m) => m.netWorth);
  const projection =
    balances.length >= 7
      ? projectNetWorth(balances, ahead).map((p) => ({ month: addMonths(month, p.monthsAhead), expectedCents: p.expectedCents, lowCents: p.lowCents, highCents: p.highCents }))
      : [];
  const recent = balances.slice(-7);
  const meanDeltaCents = recent.length >= 2 ? Math.round((recent[recent.length - 1] - recent[0]) / (recent.length - 1)) : 0;

  // orçamento x gasto ATÉ HOJE (o Plano mostra o comprometido no mês inteiro, com parcelas futuras)
  const spentBy = new Map(categories.map((c) => [c.id, c.spentCents]));
  const budgets = budgetRows.map((b) => {
    const limitCents = Number(b.limitCents);
    const spentCents = spentBy.get(b.categoryId) ?? 0;
    const ratio = spentCents / limitCents;
    return { category: b.category, limitCents, spentCents, ratio, status: ratio >= 1 ? 'over' : ratio >= 0.8 ? 'warn' : 'ok' };
  });

  // ── alocação do salário: para onde foi cada real que entrou ───────────────
  const overBudget = new Set(budgets.filter((b) => b.status === 'over').map((b) => b.category.id));
  const savedCents = cur.income - cur.expense;
  const top = categories.slice(0, 6);
  const rest = categories.slice(6).reduce((s, c) => s + c.spentCents, 0);
  const share = (v: number) => (cur.income > 0 ? Math.round((v / cur.income) * 1000) / 1000 : 0);
  const allocation = {
    incomeCents: cur.income,
    savedCents,
    savedShare: share(Math.max(0, savedCents)),
    items: [
      ...top.map((c) => ({ name: c.name, cents: c.spentCents, share: share(c.spentCents), overBudget: c.id ? overBudget.has(c.id) : false })),
      ...(rest > 0 ? [{ name: 'Demais', cents: rest, share: share(rest), overBudget: false }] : []),
    ],
  };

  // ── vencimentos do mês seguinte: faturas + contas fixas fora do cartão ─────
  const bills = [
    ...invoices.map((i) => ({ date: i.dueDate, name: `Fatura ${i.account}`, cents: i.totalCents, kind: 'invoice' as const, detail: `${i.items} lançamentos · ${shortMonth(i.invoiceMonth)}` })),
    ...recurrences.map((r) => ({ date: dayOfMonth(nextMonth, r.dayOfMonth), name: r.description, cents: -Number(r.amountCents), kind: 'recurrence' as const, detail: 'conta fixa' })),
  ].sort((a, b) => (a.date < b.date ? -1 : 1));
  const billsTotal = bills.reduce((s, b) => s + b.cents, 0);
  const liquidCents = accounts.filter((a) => a.kind === 'CHECKING').reduce((s, a) => s + a.balanceCents, 0);

  // ── alertas: avalia as regras (grava os novos, sem duplicar) e traz os mais recentes ──
  const recentAlerts = await listAlerts(userId, 8, today);

  return {
    month,
    today,
    isCurrent,
    kpis: {
      incomeCents: cur.income,
      expenseCents: cur.expense,
      savedCents,
      savingsRate: Math.round(savingsRate(cur.income, cur.expense) * 1000) / 1000,
      yearSavingsRate: Math.round(savingsRate(yearIncome, yearExpense) * 1000) / 1000,
      netWorthCents: cur.netWorth,
      netWorthChangeCents: prev ? cur.netWorth - prev.netWorth : 0,
      txCount: cur.txCount,
      budgetUse: budgets.length ? Math.round((budgets.reduce((s, b) => s + b.spentCents, 0) / budgets.reduce((s, b) => s + b.limitCents, 0)) * 1000) / 1000 : null,
    },
    daily,
    chart,
    ohlc,
    spend: { ...stats, weekendShare: stats.variableSpentCents ? Math.round((stats.variableWeekendCents / stats.variableSpentCents) * 1000) / 1000 : 0 },
    allocation,
    categories,
    netWorth: { series: months, projection, meanDeltaCents },
    flow,
    bills: { month: nextMonth, items: bills, totalCents: billsTotal, liquidCents, leftCents: liquidCents - billsTotal },
    alerts: recentAlerts.items.map((a) => ({ level: a.level, text: a.message, at: a.createdAt, read: a.read })),
    unreadAlerts: recentAlerts.unread,
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, kind: a.kind, balanceCents: a.balanceCents, availableCents: a.availableCents })),
    goals: goals.map((g) => ({ id: g.id, name: g.name, progress: g.progress, etaMonth: g.projection.etaMonth })),
  };
}
export type Dashboard = Awaited<ReturnType<typeof dashboard>>;
