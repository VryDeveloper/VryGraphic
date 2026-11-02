import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

// Sem banco nestes testes: o Prisma é trocado por um dublê que falha como um banco fora do ar.
vi.mock('../src/lib/prisma', () => ({ prisma: { $queryRaw: () => Promise.reject(new Error('sem banco')) } }));
import { createApp } from '../src/app';

/**
 * Testes que não precisam de banco. Os de integração com Postgres
 * (cadastro, login, rotação de refresh token) entram na fase 3.
 */
const app = createApp();

describe('API', () => {
  it('health responde mesmo sem banco', async () => {
    const r = await request(app).get('/api/v1/health');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ok');
    expect(['up', 'down']).toContain(r.body.db);
  });

  it('prévia do comando usa o parser compartilhado', async () => {
    const r = await request(app).post('/api/v1/command/preview').send({ text: 'notebook 2.400 tecnologia 7x' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, amountCents: 240000, installments: 7, categoryName: 'Tecnologia' });
  });

  it('comando incompleto responde 422 com o que falta', async () => {
    const r = await request(app).post('/api/v1/command/preview').send({ text: '12x' });
    expect(r.status).toBe(422);
    expect(r.body.messages).toEqual(['falta o valor', 'falta a descrição']);
  });

  it('corpo inválido responde 400 no formato padrão', async () => {
    const r = await request(app).post('/api/v1/command/preview').send({});
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION');
  });

  it('rota protegida sem token responde 401', async () => {
    const r = await request(app).get('/api/v1/me');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('NO_TOKEN');
  });

  it('rota inexistente responde 404', async () => {
    const r = await request(app).get('/api/v1/nada');
    expect(r.status).toBe(404);
  });
});
