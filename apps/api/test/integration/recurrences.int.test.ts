import { addMonths, dayOfMonth, todayISO } from '@vrygraphic/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { runRecurrences } from '../../src/jobs/recurrences';
import { nextOccurrence } from '../../src/modules/recurrences/service';
import { hasDb, newUser, prisma, resetDb, type TestUser } from './helpers';

describe('próxima ocorrência', () => {
  it('este mês se o dia ainda não passou, senão o próximo, com o dia preso ao fim do mês', () => {
    expect(nextOccurrence(10, '2026-11-01')).toBe('2026-11-10');
    expect(nextOccurrence(1, '2026-11-01')).toBe('2026-11-01');
    expect(nextOccurrence(5, '2026-11-20')).toBe('2026-12-05');
    expect(nextOccurrence(31, '2027-02-01')).toBe('2027-02-28');
    expect(nextOccurrence(31, '2026-12-31')).toBe('2026-12-31');
  });
});

describe.skipIf(!hasDb)('contas fixas', () => {
  let u: TestUser;
  let other: TestUser;
  beforeAll(async () => {
    await resetDb();
    u = await newUser('Fixas');
    other = await newUser('Outra');
  });

  const body = (over: object = {}) => ({ kind: 'EXPENSE', description: 'Academia', amountCents: 11990, accountId: u.cartao, categoryId: u.cat('Saúde'), dayOfMonth: 2, ...over });

  it('cria com a próxima data calculada e lista com conta e categoria', async () => {
    const r = await u.api.post('/recurrences', body());
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ kind: 'EXPENSE', description: 'Academia', amountCents: 11990, dayOfMonth: 2, active: true, nextRunOn: nextOccurrence(2), account: { name: 'Cartão de crédito' }, category: { name: 'Saúde' }, launched: 0 });
    expect(Number((await prisma.recurrence.findUnique({ where: { id: r.body.id } }))!.amountCents)).toBe(-11990);
    const list = (await u.api.get('/recurrences')).body.items;
    expect(list).toHaveLength(1);
  });

  it('valida: categoria do tipo errado, dia fora do mês, conta de outra pessoa', async () => {
    expect((await u.api.post('/recurrences', body({ categoryId: u.cat('Trabalho') }))).status).toBe(422);
    const d = await u.api.post('/recurrences', body({ dayOfMonth: 32 }));
    expect(d.status).toBe(400);
    expect(d.body.error.fields.dayOfMonth).toBeDefined();
    expect((await u.api.post('/recurrences', body({ accountId: other.conta }))).status).toBe(422);
  });

  it('receita também: salário cai na conta todo dia 5', async () => {
    const r = await u.api.post('/recurrences', body({ kind: 'INCOME', description: 'Salário', amountCents: 500000, accountId: u.conta, categoryId: u.cat('Trabalho'), dayOfMonth: 5 }));
    expect(r.body).toMatchObject({ kind: 'INCOME', amountCents: 500000 });
    expect(Number((await prisma.recurrence.findUnique({ where: { id: r.body.id } }))!.amountCents)).toBe(500000);
  });

  it('editar o valor mantém o sinal; mudar o dia recalcula a próxima data', async () => {
    const id = (await u.api.get('/recurrences')).body.items.find((i: { description: string }) => i.description === 'Academia').id;
    const r = await u.api.patch(`/recurrences/${id}`, { amountCents: 12990, dayOfMonth: 20 });
    expect(r.body).toMatchObject({ amountCents: 12990, kind: 'EXPENSE', dayOfMonth: 20, nextRunOn: nextOccurrence(20) });
    expect(Number((await prisma.recurrence.findUnique({ where: { id } }))!.amountCents)).toBe(-12990);
  });

  it('pausada o job não lança; reativar recomeça de hoje em diante', async () => {
    const id = (await u.api.get('/recurrences')).body.items.find((i: { description: string }) => i.description === 'Academia').id;
    await u.api.patch(`/recurrences/${id}`, { active: false });
    const far = dayOfMonth(addMonths(todayISO().slice(0, 7), 3), 28);
    const r = await runRecurrences(far, u.id);
    expect(r.created).toBeGreaterThan(0); // o salário (ativo) lança os meses até lá
    expect(await prisma.transaction.count({ where: { userId: u.id, description: 'Academia' } })).toBe(0); // a pausada, nada
    await prisma.transaction.deleteMany({ where: { userId: u.id } });
    const back = await u.api.patch(`/recurrences/${id}`, { active: true });
    expect(back.body).toMatchObject({ active: true, nextRunOn: nextOccurrence(20) });
  });

  it('mostra quantas vezes já lançou; excluir mantém os lançamentos, só tira o vínculo', async () => {
    const r = (await u.api.post('/recurrences', body({ description: 'Streaming', amountCents: 5590, dayOfMonth: 15 }))).body;
    await prisma.recurrence.update({ where: { id: r.id }, data: { nextRunOn: new Date('2026-08-15T00:00:00Z') } });
    await runRecurrences('2026-10-20', u.id);
    const listed = (await u.api.get('/recurrences')).body.items.find((i: { id: string }) => i.id === r.id);
    expect(listed.launched).toBe(3);
    expect((await u.api.delete(`/recurrences/${r.id}`)).status).toBe(204);
    const kept = await prisma.transaction.findMany({ where: { userId: u.id, description: 'Streaming' } });
    expect(kept).toHaveLength(3);
    expect(kept.every((t) => t.recurrenceId === null)).toBe(true);
  });

  it('outra pessoa não vê, não edita, não exclui', async () => {
    const id = (await u.api.get('/recurrences')).body.items[0].id;
    expect((await other.api.get('/recurrences')).body.items).toHaveLength(0);
    expect((await other.api.patch(`/recurrences/${id}`, { active: false })).status).toBe(404);
    expect((await other.api.delete(`/recurrences/${id}`)).status).toBe(404);
  });
});
