import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';

export const app = createApp();
export const hasDb = Boolean(process.env.TEST_DATABASE_URL);
export { prisma };

/** Zera o banco de teste. `users` em cascata leva contas, lançamentos, faturas, metas... */
export async function resetDb() {
  await prisma.$executeRawUnsafe('TRUNCATE users, installment_plans CASCADE');
}

let seq = 0;

/** Cria um usuário pelo endpoint real de cadastro e devolve um cliente HTTP já autenticado. */
export async function newUser(name = 'Pessoa Teste') {
  const email = `p${++seq}-${Date.now()}@teste.dev`;
  const r = await request(app).post('/api/v1/auth/register').send({ name, email, password: 'senha-forte-123' });
  if (r.status !== 201) throw new Error(`cadastro falhou: ${r.status} ${JSON.stringify(r.body)}`);
  const auth = `Bearer ${r.body.accessToken}`;
  const api = {
    get: (p: string) => request(app).get(`/api/v1${p}`).set('Authorization', auth),
    post: (p: string, body?: object) => request(app).post(`/api/v1${p}`).set('Authorization', auth).send(body),
    put: (p: string, body: object) => request(app).put(`/api/v1${p}`).set('Authorization', auth).send(body),
    patch: (p: string, body: object) => request(app).patch(`/api/v1${p}`).set('Authorization', auth).send(body),
    delete: (p: string) => request(app).delete(`/api/v1${p}`).set('Authorization', auth),
  };
  const accounts: { id: string; name: string; kind: string }[] = (await api.get('/accounts')).body.items;
  const categories: { id: string; name: string; kind: string }[] = (await api.get('/categories')).body.items;
  const find = <T extends { name: string }>(list: T[], n: string) => {
    const x = list.find((i) => i.name === n);
    if (!x) throw new Error(`não achei "${n}"`);
    return x;
  };
  return {
    id: r.body.user.id as string,
    email,
    api,
    conta: find(accounts, 'Conta corrente').id,
    cartao: find(accounts, 'Cartão de crédito').id,
    cat: (n: string) => find(categories, n).id,
    balance: async (accountId: string) => ((await api.get('/accounts')).body.items as { id: string; balanceCents: number }[]).find((a) => a.id === accountId)!.balanceCents,
  };
}
export type TestUser = Awaited<ReturnType<typeof newUser>>;
