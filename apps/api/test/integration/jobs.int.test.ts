import { beforeAll, describe, expect, it } from 'vitest';
import { runRecurrences } from '../../src/jobs/recurrences';
import { runAllJobs } from '../../src/jobs/scheduler';
import { evaluateAlerts } from '../../src/modules/alerts/evaluate';
import { hasDb, newUser, prisma, resetDb, type TestUser } from './helpers';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe.skipIf(!hasDb)('job de contas fixas', () => {
  let u: TestUser;
  let recId: string;
  beforeAll(async () => {
    await resetDb();
    u = await newUser('Fixas');
    const r = await prisma.recurrence.create({
      data: { userId: u.id, accountId: u.conta, categoryId: u.cat('Moradia'), description: 'Aluguel', amountCents: -185000n, dayOfMonth: 31, nextRunOn: d('2026-08-31') },
    });
    recId = r.id;
  });

  it('lança os meses atrasados de uma vez, com o dia preso ao fim do mês, e agenda o próximo', async () => {
    const r = await runRecurrences('2026-11-01', u.id);
    expect(r).toEqual({ created: 3, failed: [] });
    const txs = await prisma.transaction.findMany({ where: { recurrenceId: recId }, orderBy: { occurredAt: 'asc' } });
    expect(txs.map((t) => [t.source, Number(t.amountCents)])).toEqual([['RECURRING', -185000], ['RECURRING', -185000], ['RECURRING', -185000]]);
    const dates = (await u.api.get('/transactions?q=Aluguel')).body.items.map((t: { date: string }) => t.date);
    expect(dates).toEqual(['2026-10-31', '2026-09-30', '2026-08-31']); // setembro não tem dia 31
    expect((await prisma.recurrence.findUnique({ where: { id: recId } }))!.nextRunOn.toISOString().slice(0, 10)).toBe('2026-11-30');
  });

  it('rodar de novo, ou duas vezes ao mesmo tempo, não duplica', async () => {
    expect((await runRecurrences('2026-11-01', u.id)).created).toBe(0);
    const [a, b] = await Promise.all([runRecurrences('2026-12-01', u.id), runRecurrences('2026-12-01', u.id)]);
    expect(a.created + b.created).toBe(1);
    expect(await prisma.transaction.count({ where: { recurrenceId: recId } })).toBe(4);
  });

  it('se o lançamento falha, a reserva é desfeita e nada é perdido', async () => {
    await u.api.delete(`/categories/${u.cat('Moradia')}`);
    const r = await runRecurrences('2027-01-15', u.id);
    expect(r.created).toBe(0);
    expect(r.failed).toHaveLength(1);
    expect((await prisma.recurrence.findUnique({ where: { id: recId } }))!.nextRunOn.toISOString().slice(0, 10)).toBe('2026-12-31');
  });
});

describe.skipIf(!hasDb)('alertas', () => {
  let u: TestUser;
  beforeAll(async () => {
    await resetDb();
    u = await newUser('Alertas');
  });

  const spend = (amountCents: number, date: string) =>
    u.api.post('/transactions', { kind: 'EXPENSE', description: 'Mercado', amountCents, accountId: u.conta, categoryId: u.cat('Alimentação'), date });
  const alerts = async () => (await u.api.get('/alerts')).body as { unread: number; items: { kind: string; level: string; message: string }[] };

  it('orçamento: avisa ao passar do limite configurado e ao estourar, uma vez cada', async () => {
    await u.api.put('/budgets', { categoryId: u.cat('Alimentação'), month: '2026-10', limitCents: 100000 });
    await spend(85000, '2026-10-03');
    expect(await evaluateAlerts(u.id, '2026-10-10')).toBe(0); // 85% < 90%
    await spend(6000, '2026-10-11');
    expect(await evaluateAlerts(u.id, '2026-10-12')).toBe(1); // 91%
    expect(await evaluateAlerts(u.id, '2026-10-13')).toBe(0); // mesma situação, sem duplicar
    await spend(10000, '2026-10-14');
    expect(await evaluateAlerts(u.id, '2026-10-15')).toBe(1); // 101%: estourou
    const msgs = (await prisma.alert.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'asc' } })).map((a) => a.message);
    expect(msgs).toEqual(['Alimentação em 91,0% do limite', 'Alimentação passou do limite em 10,00']);
  });

  it('regras: limite configurável, desligar para de avisar, validação', async () => {
    const rules = (await u.api.get('/alerts/rules')).body.items as { kind: string; enabled: boolean; threshold: number | null }[];
    expect(rules.map((r) => [r.kind, r.enabled, r.threshold])).toEqual([
      ['BUDGET_THRESHOLD', true, 90],
      ['INVOICE_CLOSING', true, 5],
      ['GOAL_ETA_CHANGED', true, null],
      ['RECURRENCE_MISSED', false, null],
    ]);
    expect((await u.api.put('/alerts/rules/BUDGET_THRESHOLD', { enabled: true, threshold: 50 })).body).toMatchObject({ enabled: true, threshold: 50 });
    await u.api.put('/budgets', { categoryId: u.cat('Lazer'), month: '2026-10', limitCents: 10000 });
    await u.api.post('/transactions', { kind: 'EXPENSE', description: 'Cinema', amountCents: 6000, accountId: u.conta, categoryId: u.cat('Lazer'), date: '2026-10-16' });
    expect(await evaluateAlerts(u.id, '2026-10-16')).toBe(1); // 60% ≥ 50%

    await u.api.put('/alerts/rules/BUDGET_THRESHOLD', { enabled: false });
    await u.api.post('/transactions', { kind: 'EXPENSE', description: 'Show', amountCents: 9000, accountId: u.conta, categoryId: u.cat('Lazer'), date: '2026-10-17' });
    expect(await evaluateAlerts(u.id, '2026-10-17')).toBe(0);
    expect((await u.api.put('/alerts/rules/BUDGET_THRESHOLD', { enabled: true, threshold: 0 })).status).toBe(400);
    expect((await u.api.put('/alerts/rules/NAO_EXISTE', { enabled: true })).status).toBe(404);
  });

  it('fatura fechando: avisa dentro da janela, com o total parcial', async () => {
    await u.api.post('/transactions', { kind: 'EXPENSE', description: 'Uber', amountCents: 2500, accountId: u.cartao, categoryId: u.cat('Transporte'), date: '2026-10-28' });
    expect(await evaluateAlerts(u.id, '2026-10-20')).toBe(0); // fecha 05/11: 16 dias
    expect(await evaluateAlerts(u.id, '2026-11-01')).toBe(1);
    const a = await prisma.alert.findFirst({ where: { userId: u.id, kind: 'INVOICE_CLOSING' } });
    expect(a!.message).toBe('Cartão de crédito fecha em 4 dias (05/11) · 25,00 até agora');
  });

  it('meta: a primeira avaliação só registra a previsão; mudar o aporte gera o aviso', async () => {
    const reserva = (await u.api.post('/accounts', { name: 'Reserva', kind: 'SAVINGS', openingBalanceCents: 100000 })).body.id;
    const g = (await u.api.post('/goals', { name: 'Viagem', accountId: reserva, targetCents: 500000, monthlyContributionCents: 50000, monthlyRateBps: 0 })).body;
    await evaluateAlerts(u.id, '2026-11-01');
    expect(await prisma.alert.count({ where: { userId: u.id, kind: 'GOAL_ETA_CHANGED' } })).toBe(0);
    await u.api.patch(`/goals/${g.id}`, { monthlyContributionCents: 100000 });
    expect(await evaluateAlerts(u.id, '2026-11-01')).toBe(1);
    const a = await prisma.alert.findFirst({ where: { userId: u.id, kind: 'GOAL_ETA_CHANGED' } });
    expect(a!.message).toMatch(/^Viagem: previsão adiantou de .+ para .+$/);
  });

  it('lista com não lidos e marcar como lido', async () => {
    const before = await alerts();
    expect(before.unread).toBeGreaterThan(0);
    expect(before.items[0]).toHaveProperty('level');
    expect((await u.api.post('/alerts/read')).body.read).toBe(before.unread);
    expect((await alerts()).unread).toBe(0);
  });

  it('rodada completa dos jobs roda para todos e é idempotente', async () => {
    const first = await runAllJobs(new Date('2026-11-01T15:00:00Z'));
    const second = await runAllJobs(new Date('2026-11-01T15:00:00Z'));
    expect(second.alerts).toBe(0);
    expect(second.recurrences).toBe(0);
    expect(first.today).toBe('2026-11-01');
  });
});
