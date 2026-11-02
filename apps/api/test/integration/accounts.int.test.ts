import { beforeAll, describe, expect, it } from 'vitest';
import { hasDb, newUser, resetDb, type TestUser } from './helpers';

describe.skipIf(!hasDb)('contas e categorias', () => {
  let ana: TestUser;
  let bia: TestUser;
  beforeAll(async () => {
    await resetDb();
    ana = await newUser('Ana');
    bia = await newUser('Bia');
  });

  it('cartão sem fechamento e vencimento é recusado com o campo certo', async () => {
    const r = await ana.api.post('/accounts', { name: 'Outro cartão', kind: 'CREDIT_CARD' });
    expect(r.status).toBe(400);
    expect(r.body.error.fields).toMatchObject({ closingDay: expect.any(String), dueDay: expect.any(String) });
  });

  it('cria conta e o saldo começa no saldo inicial', async () => {
    const r = await ana.api.post('/accounts', { name: 'Reserva', kind: 'SAVINGS', aliases: ['reserva'], openingBalanceCents: 640000 });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ name: 'Reserva', balanceCents: 640000, openingBalanceCents: 640000 });
  });

  it('apelido não pode repetir entre contas', async () => {
    const r = await ana.api.post('/accounts', { name: 'Poupança', kind: 'SAVINGS', aliases: ['reserva'] });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('ALIAS_TAKEN');
  });

  it('edita nome e limite do cartão', async () => {
    const r = await ana.api.patch(`/accounts/${ana.cartao}`, { name: 'Nubank', creditLimitCents: 500000 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ name: 'Nubank', creditLimitCents: 500000, availableCents: 500000 });
  });

  it('outra pessoa não vê, não edita e não exclui a conta (404, sem revelar que existe)', async () => {
    expect((await bia.api.patch(`/accounts/${ana.conta}`, { name: 'hack' })).status).toBe(404);
    expect((await bia.api.delete(`/accounts/${ana.conta}`)).status).toBe(404);
    const list = (await bia.api.get('/accounts')).body.items as { id: string }[];
    expect(list.some((a) => a.id === ana.conta)).toBe(false);
  });

  it('id malformado responde 404', async () => {
    expect((await ana.api.patch('/accounts/nao-e-uuid', { name: 'x' })).status).toBe(404);
  });

  it('excluir conta é lógico: some da lista, mas o histórico continua', async () => {
    const acc = (await ana.api.post('/accounts', { name: 'Carteira', kind: 'CASH' })).body;
    const tx = (await ana.api.post('/transactions', { kind: 'EXPENSE', description: 'Café', amountCents: 800, accountId: acc.id, date: '2026-10-20' })).body.items[0];
    expect((await ana.api.delete(`/accounts/${acc.id}`)).status).toBe(204);
    const list = (await ana.api.get('/accounts')).body.items as { id: string }[];
    expect(list.some((a) => a.id === acc.id)).toBe(false);
    const still = await ana.api.get(`/transactions/${tx.id}`);
    expect(still.status).toBe(200);
    expect(still.body.account.name).toBe('Carteira');
    // e não dá para lançar numa conta excluída
    const r = await ana.api.post('/transactions', { kind: 'EXPENSE', description: 'Pão', amountCents: 500, accountId: acc.id, date: '2026-10-21' });
    expect(r.status).toBe(422);
  });

  it('categoria: nome único, renomeia, e recriar uma excluída traz ela de volta', async () => {
    expect((await ana.api.post('/categories', { name: 'Alimentação', kind: 'EXPENSE' })).status).toBe(409);
    const pets = (await ana.api.post('/categories', { name: 'Pets', kind: 'EXPENSE' })).body;
    expect((await ana.api.patch(`/categories/${pets.id}`, { name: 'Gatos' })).body.name).toBe('Gatos');
    expect((await ana.api.patch(`/categories/${pets.id}`, { name: 'Lazer' })).status).toBe(409);
    expect((await ana.api.delete(`/categories/${pets.id}`)).status).toBe(204);
    const back = (await ana.api.post('/categories', { name: 'Gatos', kind: 'EXPENSE' })).body;
    expect(back.id).toBe(pets.id);
  });
});
