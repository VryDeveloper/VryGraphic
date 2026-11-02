import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { dashboard } from '../../src/modules/dashboard/service';
import { DEMO_EMAIL, DEMO_PASSWORD, resetDemo } from '../../src/modules/demo/write';
import { app, hasDb, newUser, prisma, resetDb, type TestUser } from './helpers';

/**
 * Cenário pequeno com números conferidos à mão:
 *   conta corrente abre com 1.000,00; +500,00 em agosto (antes do mês analisado)
 *   setembro: salário 5.000 (05), aluguel 1.500 (dom 06), mercado 300 no cartão (sáb 12),
 *             cinema 100 no cartão (dom 13), feira 200 na conta (qua 16), paga 300 do cartão (20)
 *   outubro:  salário 5.000 (05), notebook 1.000 em 2x no cartão (10/10 → 2ª parcela em novembro), farmácia 70 (20)
 */
describe.skipIf(!hasDb)('painéis da visão geral', () => {
  let u: TestUser;
  beforeAll(async () => {
    await resetDb();
    u = await newUser('Painel');
    await u.api.patch(`/accounts/${u.conta}`, { openingBalanceCents: 100000 });
    const t = (kind: string, amountCents: number, accountId: string, category: string, date: string, installments = 1) =>
      u.api.post('/transactions', { kind, description: category, amountCents, accountId, categoryId: u.cat(category), date, installments });
    await t('INCOME', 50000, u.conta, 'Trabalho', '2026-08-20');
    await t('INCOME', 500000, u.conta, 'Trabalho', '2026-09-05');
    await t('EXPENSE', 150000, u.conta, 'Moradia', '2026-09-06');
    await t('EXPENSE', 30000, u.cartao, 'Alimentação', '2026-09-12');
    await t('EXPENSE', 10000, u.cartao, 'Lazer', '2026-09-13');
    await t('EXPENSE', 20000, u.conta, 'Alimentação', '2026-09-16');
    await u.api.post('/transfers', { fromAccountId: u.conta, toAccountId: u.cartao, amountCents: 30000, date: '2026-09-20' });
    await t('INCOME', 500000, u.conta, 'Trabalho', '2026-10-05');
    await t('EXPENSE', 100000, u.cartao, 'Tecnologia', '2026-10-10', 2);
    await t('EXPENSE', 7000, u.conta, 'Saúde', '2026-10-20');
  });

  it('saldo diário: candles com abertura, fechamento e pavio, a partir do saldo antes do mês', async () => {
    const r = await u.api.get('/dashboard?month=2026-09');
    expect(r.status).toBe(200);
    const d = r.body.daily as { day: string; open: number; close: number; high: number; low: number; spentCents: number }[];
    expect(d).toHaveLength(30);
    expect(d[0]).toMatchObject({ day: '2026-09-01', open: 150000, close: 150000 });
    expect(d[4]).toMatchObject({ day: '2026-09-05', open: 150000, close: 650000, high: 650000, low: 150000 });
    expect(d[5]).toMatchObject({ open: 650000, close: 500000, low: 500000 });
    expect(d[19]).toMatchObject({ day: '2026-09-20', close: 450000 });
    expect(r.body.ohlc).toEqual({ open: 150000, close: 450000, high: 650000, low: 150000 });
  });

  it('gasto por dia: volume, percentil 80 e fim de semana (PERCENTILE_CONT e FILTER)', async () => {
    const r = await u.api.get('/dashboard?month=2026-09');
    const spent = Object.fromEntries((r.body.daily as { day: string; spentCents: number }[]).filter((x) => x.spentCents).map((x) => [x.day, x.spentCents]));
    expect(spent).toEqual({ '2026-09-06': 150000, '2026-09-12': 30000, '2026-09-13': 10000, '2026-09-16': 20000 });
    // [100, 200, 300, 1500] → p80 = 300 + 0,4 × 1200 = 780,00
    // fim de semana: dom 06 (1.500) + sáb 12 (300) + dom 13 (100) = 1.900 de 2.100
    expect(r.body.spend).toMatchObject({ hotThresholdCents: 78000, totalSpentCents: 210000, weekendSpentCents: 190000, weekendShare: 0.905 });
  });

  it('mês a mês: patrimônio acumulado (SUM OVER), variação com LAG e taxa de poupança', async () => {
    const r = await u.api.get('/dashboard?month=2026-09');
    const s = r.body.netWorth.series as { month: string; income: number; expense: number; netWorth: number; expenseChange: number | null; txCount: number }[];
    expect(s).toHaveLength(12);
    expect(s[0]).toMatchObject({ month: '2025-10', netWorth: 100000, expenseChange: null });
    expect(s[10]).toMatchObject({ month: '2026-08', income: 50000, netWorth: 150000 });
    expect(s[11]).toMatchObject({ month: '2026-09', income: 500000, expense: 210000, netWorth: 440000, expenseChange: 210000, txCount: 5 });
    expect(r.body.kpis).toMatchObject({ incomeCents: 500000, expenseCents: 210000, savedCents: 290000, savingsRate: 0.58, netWorthChangeCents: 290000 });
  });

  it('projeção: média das variações dos últimos 6 meses, até dezembro', async () => {
    const r = await u.api.get('/dashboard?month=2026-09');
    const p = r.body.netWorth.projection as { month: string; expectedCents: number; lowCents: number; highCents: number }[];
    expect(p.map((x) => x.month)).toEqual(['2026-10', '2026-11', '2026-12']);
    // variações [0, 0, 0, 0, 500, 2900] → média 566,67 por mês
    expect(p[0].expectedCents).toBe(496667);
    expect(p[0].lowCents).toBeLessThan(p[0].expectedCents);
    expect(p[2].highCents - p[2].expectedCents).toBeGreaterThan(p[0].highCents - p[0].expectedCents);
  });

  it('categorias: participação (SUM OVER ()) e posição (RANK), e a alocação do salário', async () => {
    const r = await u.api.get('/dashboard?month=2026-09');
    expect(r.body.categories.map((c: { name: string; spentCents: number; share: number; rank: number }) => [c.name, c.spentCents, c.share, c.rank])).toEqual([
      ['Moradia', 150000, 71.4, 1],
      ['Alimentação', 50000, 23.8, 2],
      ['Lazer', 10000, 4.8, 3],
    ]);
    expect(r.body.allocation).toMatchObject({ incomeCents: 500000, savedCents: 290000, savedShare: 0.58 });
    expect(r.body.allocation.items[0]).toMatchObject({ name: 'Moradia', share: 0.3 });
  });

  it('fluxo: saldo de cada conta depois de cada lançamento (SUM OVER PARTITION BY conta)', async () => {
    const r = await u.api.get('/dashboard?month=2026-09');
    const f = r.body.flow as { date: string; account: string; amountCents: number; balanceAfterCents: number }[];
    expect(f[0]).toMatchObject({ date: '2026-09-20', account: 'Cartão de crédito', amountCents: 30000, balanceAfterCents: -10000 });
    expect(f[1]).toMatchObject({ date: '2026-09-20', account: 'Conta corrente', amountCents: -30000, balanceAfterCents: 450000 });
    expect(f[2]).toMatchObject({ date: '2026-09-16', balanceAfterCents: 480000 });
    expect(f.every((x) => x.date < '2026-10-01')).toBe(true);
  });

  it('vencimentos do mês seguinte: fatura com o total dos lançamentos dela', async () => {
    const r = await u.api.get('/dashboard?month=2026-09');
    expect(r.body.bills.month).toBe('2026-10');
    expect(r.body.bills.items).toEqual([{ date: '2026-10-12', name: 'Fatura Cartão de crédito', cents: 40000, kind: 'invoice', detail: '2 lançamentos · out/26' }]);
    expect(r.body.bills.totalCents).toBe(40000);
  });

  it('patrimônio do mês ignora parcelas futuras; o saldo das contas já as reserva', async () => {
    const r = await u.api.get('/dashboard?month=2026-10');
    const accounts = (await u.api.get('/accounts')).body.items as { balanceCents: number }[];
    const sum = accounts.reduce((s, a) => s + a.balanceCents, 0);
    expect(sum).toBe(833000);
    expect(r.body.kpis.netWorthCents).toBe(883000); // 833000 + a parcela de novembro (−500,00) que ainda não aconteceu
    expect(r.body.categories[0]).toMatchObject({ name: 'Tecnologia', spentCents: 50000 });
  });

  it('no mês atual, a visão geral só conta o que já aconteceu até hoje', async () => {
    // "hoje" = 15/10: a farmácia do dia 20 ainda não aconteceu
    const d = await dashboard(u.id, '2026-10', new Date('2026-10-15T15:00:00Z'));
    expect(d.isCurrent).toBe(true);
    expect(d.kpis.expenseCents).toBe(50000);
    expect(d.categories.map((c) => c.name)).toEqual(['Tecnologia']);
    expect(d.daily.filter((x) => !x.future).map((x) => x.day).at(-1)).toBe('2026-10-15');
    expect(d.daily.find((x) => x.day === '2026-10-20')).toMatchObject({ future: true, close: null, spentCents: 0 });
    // já o mês fechado conta tudo
    const full = await dashboard(u.id, '2026-10', new Date('2026-11-02T15:00:00Z'));
    expect(full.kpis.expenseCents).toBe(57000);
  });

  it('começo do mês: o gráfico de saldo mostra os últimos 30 dias; os outros painéis seguem no mês', async () => {
    const d = await dashboard(u.id, '2026-10', new Date('2026-10-05T15:00:00Z'));
    expect(d.chart.window).toBe('rolling');
    expect(d.chart.days).toHaveLength(30);
    expect(d.chart.days[0]).toMatchObject({ day: '2026-09-06', inMonth: false });
    expect(d.chart.days.at(-1)).toMatchObject({ day: '2026-10-05', inMonth: true, close: 950000 });
    // 06/09 fecha depois do aluguel: 650000 − 150000
    expect(d.chart.days[0].close).toBe(500000);
    expect(d.daily).toHaveLength(31); // mapa de calor continua no mês
    // dia 10 em diante volta ao mês normal
    expect((await dashboard(u.id, '2026-10', new Date('2026-10-10T15:00:00Z'))).chart.window).toBe('month');
  });

  it('mês futuro e mês malformado são recusados; outra pessoa vê só zeros', async () => {
    expect((await u.api.get('/dashboard?month=2999-01')).status).toBe(400);
    expect((await u.api.get('/dashboard?month=setembro')).status).toBe(400);
    const other = await newUser('Outra');
    const r = await other.api.get('/dashboard?month=2026-09');
    expect(r.body.kpis).toMatchObject({ incomeCents: 0, expenseCents: 0 });
    expect(r.body.flow).toEqual([]);
  });
});

describe.skipIf(!hasDb)('demo de 12 meses', () => {
  it('o seed gera um ano coerente: faturas pagas, saldo do candle bate com as contas, alertas', async () => {
    await resetDb();
    const { userId, transactions } = await resetDemo('2026-10-31', { bcryptCost: 4 });
    expect(transactions).toBeGreaterThan(400);

    const login = await request(app).post('/api/v1/auth/login').send({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.user.isDemo).toBe(true);

    const d = await dashboard(userId, '2026-10', new Date('2026-10-31T15:00:00Z'));
    expect(d.netWorth.series).toHaveLength(12);
    expect(d.netWorth.projection.map((p) => p.month)).toEqual(['2026-11', '2026-12', '2027-01']);
    expect(d.kpis.savingsRate).toBeGreaterThan(0.05);
    expect(d.kpis.yearSavingsRate).toBeGreaterThan(0.1);
    expect(d.daily).toHaveLength(31);

    const checking = d.accounts.filter((a) => a.kind === 'CHECKING').reduce((s, a) => s + a.balanceCents, 0);
    expect(d.ohlc!.close).toBe(checking);
    expect(checking).toBeGreaterThan(0);

    const invoices = await prisma.cardInvoice.findMany({ where: { account: { userId } } });
    expect(invoices.filter((i) => i.status === 'PAID').every((i) => i.dueDate.toISOString().slice(0, 10) <= '2026-10-31')).toBe(true);
    expect(invoices.some((i) => i.status !== 'PAID')).toBe(true);
    expect(d.bills.items.some((b) => b.kind === 'invoice')).toBe(true);
    expect(d.bills.items.some((b) => b.name === 'Aluguel')).toBe(true);
    expect(d.alerts.length).toBeGreaterThan(0);
  });
});
