import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, hasDb, prisma, resetDb } from './helpers';

const cookieOf = (r: request.Response) => (r.headers['set-cookie'] as unknown as string[] | undefined)?.find((c) => c.startsWith('vry_refresh='))?.split(';')[0];

describe.skipIf(!hasDb)('autenticação', () => {
  const email = 'ana@teste.dev';
  const password = 'senha-forte-123';
  beforeAll(resetDb);

  it('cadastro cria a pessoa com contas e categorias iniciais e abre a sessão', async () => {
    const r = await request(app).post('/api/v1/auth/register').send({ name: 'Ana', email, password });
    expect(r.status).toBe(201);
    expect(r.body.accessToken).toBeTypeOf('string');
    expect(r.body.user).toMatchObject({ name: 'Ana', email });
    expect(r.body.user.passwordHash).toBeUndefined();
    const cookie = r.headers['set-cookie'] as unknown as string[];
    expect(cookie.join()).toMatch(/vry_refresh=.*HttpOnly.*SameSite=Strict/i);

    const auth = { Authorization: `Bearer ${r.body.accessToken}` };
    const accounts = await request(app).get('/api/v1/accounts').set(auth);
    const categories = await request(app).get('/api/v1/categories').set(auth);
    expect(accounts.body.items.map((a: { name: string }) => a.name)).toEqual(['Conta corrente', 'Cartão de crédito']);
    expect(categories.body.items).toHaveLength(9);
  });

  it('e-mail repetido responde 409', async () => {
    const r = await request(app).post('/api/v1/auth/register').send({ name: 'Ana 2', email: 'ANA@teste.dev', password });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('senha errada e e-mail inexistente dão a mesma resposta', async () => {
    const a = await request(app).post('/api/v1/auth/login').send({ email, password: 'errada-123' });
    const b = await request(app).post('/api/v1/auth/login').send({ email: 'ninguem@teste.dev', password: 'errada-123' });
    expect([a.status, b.status]).toEqual([401, 401]);
    expect(a.body).toEqual(b.body);
  });

  it('refresh token gira a cada uso, e reusar um antigo derruba a família toda', async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ email, password });
    const c1 = cookieOf(login)!;

    const r2 = await request(app).post('/api/v1/auth/refresh').set('Cookie', c1);
    expect(r2.status).toBe(200);
    const c2 = cookieOf(r2)!;
    expect(c2).not.toBe(c1);

    // reusar c1 logo em seguida é corrida entre abas: recusa, mas a sessão continua
    const race = await request(app).post('/api/v1/auth/refresh').set('Cookie', c1);
    expect(race.status).toBe(401);
    expect(race.body.error.code).toBe('TOKEN_RACE');

    // alguém roubou c1 e tenta usar bem depois (fora da janela de 30 s)
    await prisma.refreshToken.updateMany({ where: { revokedAt: { not: null } }, data: { revokedAt: new Date(Date.now() - 60_000) } });
    const stolen = await request(app).post('/api/v1/auth/refresh').set('Cookie', c1);
    expect(stolen.status).toBe(401);
    expect(stolen.body.error.code).toBe('TOKEN_REUSED');

    // por segurança o token novo do dono também foi revogado
    const owner = await request(app).post('/api/v1/auth/refresh').set('Cookie', c2);
    expect(owner.status).toBe(401);
  });

  it('duas renovações ao mesmo tempo (duas abas) não derrubam a sessão', async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ email, password });
    const c = cookieOf(login)!;
    const [a, b] = await Promise.all([
      request(app).post('/api/v1/auth/refresh').set('Cookie', c),
      request(app).post('/api/v1/auth/refresh').set('Cookie', c),
    ]);
    const winner = [a, b].find((r) => r.status === 200)!;
    expect([a.status, b.status].sort()).toEqual([200, 401]);
    expect([a, b].find((r) => r.status === 401)!.body.error.code).toBe('TOKEN_RACE');
    // o token novo de quem ganhou continua valendo
    expect((await request(app).post('/api/v1/auth/refresh').set('Cookie', cookieOf(winner)!)).status).toBe(200);
  });

  it('logout encerra a sessão', async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ email, password });
    const c = cookieOf(login)!;
    expect((await request(app).post('/api/v1/auth/logout').set('Cookie', c)).status).toBe(204);
    expect((await request(app).post('/api/v1/auth/refresh').set('Cookie', c)).status).toBe(401);
  });

  it('access token inválido não passa', async () => {
    const r = await request(app).get('/api/v1/accounts').set('Authorization', 'Bearer abc.def.ghi');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('INVALID_TOKEN');
  });

  it('guia de primeiro uso: conta nova vê o guia; concluir vale nas próximas sessões; dá para rever', async () => {
    const reg = await request(app).post('/api/v1/auth/register').send({ name: 'Nova', email: 'nova@teste.dev', password });
    expect(reg.body.user.onboarded).toBe(false);
    const auth = { Authorization: `Bearer ${reg.body.accessToken}` };

    expect((await request(app).put('/api/v1/me/onboarding').set(auth).send({ done: true })).body).toEqual({ onboarded: true, stored: 'account' });
    const again = await request(app).post('/api/v1/auth/login').send({ email: 'nova@teste.dev', password });
    expect(again.body.user.onboarded).toBe(true);
    expect((await request(app).get('/api/v1/me').set(auth)).body.user.onboarded).toBe(true);

    await request(app).put('/api/v1/me/onboarding').set(auth).send({ done: false });
    expect((await request(app).get('/api/v1/me').set(auth)).body.user.onboarded).toBe(false);
    expect((await request(app).put('/api/v1/me/onboarding').set(auth).send({ done: 'sim' })).status).toBe(400);
  });
});
