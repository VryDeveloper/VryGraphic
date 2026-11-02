import { addMonths, todayISO } from '@vrygraphic/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { hasDb, newUser, resetDb, type TestUser } from './helpers';

describe.skipIf(!hasDb)('orçamentos e metas', () => {
  let ana: TestUser;
  beforeAll(async () => {
    await resetDb();
    ana = await newUser('Ana');
  });

  it('orçamento soma o gasto do mês no banco e marca o status', async () => {
    const food = ana.cat('Alimentação');
    const put = await ana.api.put('/budgets', { categoryId: food, month: '2026-10', limitCents: 50000 });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ limitCents: 50000, spentCents: 0, status: 'ok' });

    const spend = (amountCents: number, date: string) =>
      ana.api.post('/transactions', { kind: 'EXPENSE', description: 'Comida', amountCents, accountId: ana.conta, categoryId: food, date });
    await spend(42000, '2026-10-03');
    await spend(9999, '2026-11-01'); // outro mês, não conta
    let b = (await ana.api.get('/budgets?month=2026-10')).body.items[0];
    expect(b).toMatchObject({ spentCents: 42000, remainingCents: 8000, ratio: 0.84, status: 'warn' });

    await spend(10000, '2026-10-31');
    b = (await ana.api.get('/budgets?month=2026-10')).body.items[0];
    expect(b).toMatchObject({ spentCents: 52000, status: 'over' });

    // PUT de novo atualiza, não duplica
    await ana.api.put('/budgets', { categoryId: food, month: '2026-10', limitCents: 60000 });
    const items = (await ana.api.get('/budgets?month=2026-10')).body.items;
    expect(items).toHaveLength(1);
    expect(items[0].limitCents).toBe(60000);

    expect((await ana.api.put('/budgets', { categoryId: ana.cat('Trabalho'), month: '2026-10', limitCents: 1 })).status).toBe(422);
    expect((await ana.api.delete(`/budgets/${items[0].id}`)).status).toBe(204);
    expect((await ana.api.delete(`/budgets/${items[0].id}`)).status).toBe(404);
  });

  it('meta usa o saldo real da conta e projeta o mês em que chega', async () => {
    const reserva = (await ana.api.post('/accounts', { name: 'Reserva', kind: 'SAVINGS', openingBalanceCents: 640000 })).body.id;
    const sem = await ana.api.post('/goals', { name: 'Reserva de emergência', accountId: reserva, targetCents: 1000000, monthlyContributionCents: 80000, monthlyRateBps: 0 });
    expect(sem.status).toBe(201);
    // faltam 3.600,00 a 800,00/mês → 5 meses (4,5 arredondado para cima)
    expect(sem.body).toMatchObject({ currentCents: 640000, progress: 0.64, projection: { reached: true, months: 5 } });
    expect(sem.body.projection.etaMonth).toBe(addMonths(todayISO().slice(0, 7), 5));

    const com = await ana.api.patch(`/goals/${sem.body.id}`, { monthlyRateBps: 85 });
    expect(com.body.projection.months).toBeLessThanOrEqual(5);
    expect(com.body.projection.interestCents).toBeGreaterThan(0);

    // um depósito na reserva muda a meta na hora (saldo é calculado, não guardado)
    await ana.api.post('/transfers', { fromAccountId: ana.conta, toAccountId: reserva, amountCents: 360000, date: '2026-10-20' });
    const goal = (await ana.api.get('/goals')).body.items[0];
    expect(goal).toMatchObject({ currentCents: 1000000, progress: 1, projection: { months: 0, reached: true } });

    expect((await ana.api.delete(`/accounts/${reserva}`)).body.error.code).toBe('ACCOUNT_IN_USE');
    expect((await ana.api.delete(`/goals/${goal.id}`)).status).toBe(204);
    expect((await ana.api.delete(`/accounts/${reserva}`)).status).toBe(204);
  });

  it('planejamento: 3 meses por categoria, sugestão arredondada em R$ 50 e aplicar no mês seguinte', async () => {
    const p = await newUser('Plano');
    const spend = (category: string, amountCents: number, date: string) =>
      p.api.post('/transactions', { kind: 'EXPENSE', description: category, amountCents, accountId: p.conta, categoryId: p.cat(category), date });
    await spend('Transporte', 30000, '2026-08-10');
    await spend('Transporte', 45000, '2026-09-10');
    await spend('Transporte', 40000, '2026-10-10');
    await spend('Transporte', 99999, '2026-07-31'); // fora da janela de 3 meses
    await spend('Alimentação', 12345, '2026-10-02');
    await p.api.put('/budgets', { categoryId: p.cat('Transporte'), month: '2026-10', limitCents: 35000 });

    const r = await p.api.get('/budgets/plan?month=2026-10');
    expect(r.status).toBe(200);
    expect(r.body.nextMonth).toBe('2026-11');
    const row = (name: string) => r.body.items.find((i: { name: string }) => i.name === name);
    // [300, 450, 400] → média 383,33 → sugestão 400,00
    expect(row('Transporte')).toMatchObject({ limitCents: 35000, spentCents: 40000, history: [30000, 45000, 40000], avg3Cents: 38333, suggestionCents: 40000, ratio: 1.143, status: 'over', deltaCents: 5000 });
    expect(row('Alimentação')).toMatchObject({ limitCents: null, spentCents: 12345, suggestionCents: 5000, status: null });
    expect(row('Lazer')).toMatchObject({ spentCents: 0, suggestionCents: 0 });
    expect(r.body.items[0].name).toBe('Transporte'); // com orçamento vem primeiro
    expect(r.body.totals).toMatchObject({ limitCents: 35000, spentBudgetedCents: 40000, used: 1.143, leftCents: -5000 });

    const ap = await p.api.post('/budgets/apply', { month: '2026-11', items: [{ categoryId: p.cat('Transporte'), limitCents: 40000 }, { categoryId: p.cat('Alimentação'), limitCents: 5000 }] });
    expect(ap.body).toEqual({ applied: 2 });
    const after = await p.api.get('/budgets/plan?month=2026-10');
    expect(after.body.items.find((i: { name: string }) => i.name === 'Transporte').nextLimitCents).toBe(40000);

    // categoria de receita no meio: nada é gravado
    const bad = await p.api.post('/budgets/apply', { month: '2026-12', items: [{ categoryId: p.cat('Lazer'), limitCents: 1000 }, { categoryId: p.cat('Trabalho'), limitCents: 1000 }] });
    expect(bad.status).toBe(422);
    expect((await p.api.get('/budgets?month=2026-12')).body.items).toHaveLength(0);
  });
});
