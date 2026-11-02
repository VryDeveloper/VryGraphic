import { beforeAll, describe, expect, it } from 'vitest';
import { hasDb, newUser, prisma, resetDb, type TestUser } from './helpers';

type Item = { id: string; amountCents: number; date: string; description: string; invoiceMonth: string | null; installment: { number: number; count: number } | null; kind: string; source: string; account: { id: string }; category: { name: string } | null };

describe.skipIf(!hasDb)('lançamentos', () => {
  let ana: TestUser;
  let bia: TestUser;
  beforeAll(async () => {
    await resetDb();
    ana = await newUser('Ana');
    bia = await newUser('Bia');
  });

  it('despesa grava negativo e move o saldo da conta', async () => {
    const r = await ana.api.post('/transactions', { kind: 'EXPENSE', description: 'Mercado', amountCents: 12050, accountId: ana.conta, categoryId: ana.cat('Alimentação'), date: '2026-10-05' });
    expect(r.status).toBe(201);
    expect(r.body.items[0]).toMatchObject({ amountCents: -12050, date: '2026-10-05', kind: 'EXPENSE', category: { name: 'Alimentação' }, installment: null, invoiceMonth: null });
    expect(await ana.balance(ana.conta)).toBe(-12050);
  });

  it('valor quebrado em centavos e categoria do tipo errado são recusados', async () => {
    const frac = await ana.api.post('/transactions', { kind: 'EXPENSE', description: 'x', amountCents: 12.5, accountId: ana.conta, date: '2026-10-05' });
    expect(frac.status).toBe(400);
    expect(frac.body.error.fields.amountCents).toBeDefined();
    const wrong = await ana.api.post('/transactions', { kind: 'EXPENSE', description: 'x', amountCents: 100, accountId: ana.conta, categoryId: ana.cat('Trabalho'), date: '2026-10-05' });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.fields.categoryId).toMatch(/receita/);
  });

  it('não dá para lançar na conta de outra pessoa', async () => {
    const r = await bia.api.post('/transactions', { kind: 'EXPENSE', description: 'x', amountCents: 100, accountId: ana.conta, date: '2026-10-05' });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('INVALID_REFERENCE');
  });

  it('o próprio banco recusa despesa positiva (CHECK constraint), mesmo burlando a API', async () => {
    await expect(
      prisma.transaction.create({
        data: { userId: ana.id, accountId: ana.conta, kind: 'EXPENSE', amountCents: 500n, description: 'burla', occurredAt: new Date() },
      }),
    ).rejects.toThrow(/transactions_amount_sign_check|check constraint/i);
  });

  it('7x no cartão: soma bate ao centavo, resto na 1ª, uma fatura por mês', async () => {
    // fecha dia 5: compra dia 10/11 cai na fatura que fecha em dezembro
    const r = await ana.api.post('/transactions', { kind: 'EXPENSE', description: 'Notebook', amountCents: 240000, accountId: ana.cartao, categoryId: ana.cat('Tecnologia'), date: '2026-11-10', installments: 7 });
    expect(r.status).toBe(201);
    const items: Item[] = r.body.items;
    expect(items).toHaveLength(7);
    expect(items.map((i) => i.amountCents)).toEqual([-34290, -34285, -34285, -34285, -34285, -34285, -34285]);
    expect(items.reduce((s, i) => s + i.amountCents, 0)).toBe(-240000);
    expect(items.map((i) => i.invoiceMonth)).toEqual(['2026-12', '2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06']);
    expect(items.map((i) => i.date)).toEqual(['2026-11-10', '2026-12-10', '2027-01-10', '2027-02-10', '2027-03-10', '2027-04-10', '2027-05-10']);
    expect(items[6].installment).toMatchObject({ number: 7, count: 7 });

    const card = ((await ana.api.get('/accounts')).body.items as { id: string; availableCents: number }[]).find((a) => a.id === ana.cartao)!;
    expect(card.availableCents).toBe(300000 - 240000);
    const invoices = await prisma.cardInvoice.findMany({ where: { accountId: ana.cartao }, orderBy: { month: 'asc' } });
    expect(invoices).toHaveLength(7);
    expect(invoices[0].closingDate.toISOString().slice(0, 10)).toBe('2026-12-05');
    expect(invoices[0].dueDate.toISOString().slice(0, 10)).toBe('2026-12-12');
  });

  it('pela barra de comando, com as contas e categorias da própria pessoa', async () => {
    const inc = await ana.api.post('/transactions/command', { text: '+freela 640,50 trabalho' });
    expect(inc.status).toBe(201);
    expect(inc.body.items[0]).toMatchObject({ kind: 'INCOME', amountCents: 64050, description: 'Freela', source: 'COMMAND', account: { id: ana.conta } });

    const exp = await ana.api.post('/transactions/command', { text: 'tênis 300 lazer cartao 3x' });
    expect(exp.body.items.map((i: Item) => i.amountCents)).toEqual([-10000, -10000, -10000]);
    expect(exp.body.items[0].account.id).toBe(ana.cartao);

    const bad = await ana.api.post('/transactions/command', { text: '12x' });
    expect(bad.status).toBe(422);
    expect(bad.body.error).toMatchObject({ code: 'COMMAND_INCOMPLETE', message: 'falta o valor, falta a descrição' });
  });

  it('lista com filtros, totais e paginação por cursor sem repetir nem pular', async () => {
    const u = await newUser('Paginação');
    const days = ['2026-09-30', '2026-10-01', '2026-10-10', '2026-10-10', '2026-10-31', '2026-11-01'];
    for (const [i, d] of days.entries()) {
      await u.api.post('/transactions', { kind: i === 2 ? 'INCOME' : 'EXPENSE', description: `Item ${i}`, amountCents: 1000 * (i + 1), accountId: u.conta, date: d });
    }
    // outubro em São Paulo: 01 a 31, sem 30/09 nem 01/11
    const seen: Item[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const r = await u.api.get(`/transactions?month=2026-10&limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      expect(r.status).toBe(200);
      seen.push(...r.body.items);
      cursor = r.body.nextCursor;
      pages++;
      if (pages === 1) expect(r.body.totals).toEqual({ count: 4, incomeCents: 3000, expenseCents: 2000 + 4000 + 5000, netCents: 3000 - 11000 });
    } while (cursor);
    expect(pages).toBe(2);
    expect(seen.map((i) => i.description)).toEqual(['Item 4', 'Item 3', 'Item 2', 'Item 1']);
    expect(new Set(seen.map((i) => i.id)).size).toBe(4);

    const q = await u.api.get('/transactions?q=item 3');
    expect(q.body.items.map((i: Item) => i.description)).toEqual(['Item 3']);
    const inc = await u.api.get('/transactions?kind=INCOME');
    expect(inc.body.totals.count).toBe(1);
    expect((await u.api.get('/transactions?cursor=lixo')).status).toBe(400);
    expect((await u.api.get('/transactions?month=2026-13')).status).toBe(400);
  });

  it('edita lançamento comum; parcelamento só aceita descrição e categoria (no plano todo)', async () => {
    const t: Item = (await ana.api.post('/transactions', { kind: 'EXPENSE', description: 'Uber', amountCents: 2300, accountId: ana.conta, date: '2026-10-08' })).body.items[0];
    const e = await ana.api.patch(`/transactions/${t.id}`, { amountCents: 2550, date: '2026-10-09', categoryId: ana.cat('Transporte') });
    expect(e.status).toBe(200);
    expect(e.body).toMatchObject({ amountCents: -2550, date: '2026-10-09', category: { name: 'Transporte' } });

    // mudar para o cartão recalcula a fatura
    const moved = await ana.api.patch(`/transactions/${t.id}`, { accountId: ana.cartao });
    expect(moved.body.invoiceMonth).toBe('2026-11');

    const plan: Item[] = (await ana.api.post('/transactions', { kind: 'EXPENSE', description: 'Geladeira', amountCents: 300000, accountId: ana.cartao, date: '2026-10-01', installments: 10 })).body.items;
    const locked = await ana.api.patch(`/transactions/${plan[3].id}`, { amountCents: 1 });
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe('INSTALLMENT_LOCKED');
    expect((await ana.api.patch(`/transactions/${plan[3].id}`, { description: 'Geladeira Brastemp' })).status).toBe(200);
    const all = await prisma.transaction.findMany({ where: { installmentPlanId: (await ana.api.get(`/transactions/${plan[0].id}`)).body.installment.planId } });
    expect(all.every((x) => x.description === 'Geladeira Brastemp')).toBe(true);
  });

  it('excluir uma parcela exclui o parcelamento, e desfazer traz tudo de volta', async () => {
    const plan: Item[] = (await ana.api.post('/transactions', { kind: 'EXPENSE', description: 'Sofá', amountCents: 120000, accountId: ana.cartao, date: '2026-10-02', installments: 4 })).body.items;
    const before = await ana.balance(ana.cartao);
    const d = await ana.api.delete(`/transactions/${plan[2].id}`);
    expect(d.body).toEqual({ deleted: 4 });
    expect(await ana.balance(ana.cartao)).toBe(before + 120000);
    expect((await ana.api.get(`/transactions/${plan[0].id}`)).status).toBe(404);
    expect((await ana.api.post(`/transactions/${plan[0].id}/restore`)).body).toEqual({ restored: 4 });
    expect(await ana.balance(ana.cartao)).toBe(before);
  });

  it('transferência: duas pernas que somam zero, não editável, exclui junto', async () => {
    const reserva = (await ana.api.post('/accounts', { name: 'Reserva', kind: 'SAVINGS' })).body.id;
    const [c0, r0] = [await ana.balance(ana.conta), await ana.balance(reserva)];
    const t = await ana.api.post('/transfers', { fromAccountId: ana.conta, toAccountId: reserva, amountCents: 50000, date: '2026-10-15' });
    expect(t.status).toBe(201);
    expect(t.body.items.map((i: Item) => i.amountCents)).toEqual([-50000, 50000]);
    expect([await ana.balance(ana.conta), await ana.balance(reserva)]).toEqual([c0 - 50000, r0 + 50000]);
    expect((await ana.api.patch(`/transactions/${t.body.items[0].id}`, { description: 'x' })).body.error.code).toBe('TRANSFER_LOCKED');
    expect((await ana.api.delete(`/transactions/${t.body.items[1].id}`)).body).toEqual({ deleted: 2 });
    expect([await ana.balance(ana.conta), await ana.balance(reserva)]).toEqual([c0, r0]);
    expect((await ana.api.post('/transfers', { fromAccountId: reserva, toAccountId: reserva, amountCents: 1, date: '2026-10-15' })).status).toBe(400);
  });

  it('outra pessoa não lê, não edita, não exclui', async () => {
    const t: Item = (await ana.api.post('/transactions', { kind: 'EXPENSE', description: 'Segredo', amountCents: 999, accountId: ana.conta, date: '2026-10-08' })).body.items[0];
    expect((await bia.api.get(`/transactions/${t.id}`)).status).toBe(404);
    expect((await bia.api.patch(`/transactions/${t.id}`, { description: 'x' })).status).toBe(404);
    expect((await bia.api.delete(`/transactions/${t.id}`)).status).toBe(404);
    expect((await bia.api.get('/transactions')).body.totals.count).toBe(0);
  });
});
