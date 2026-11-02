import { Router } from 'express';
import { prisma } from '../../lib/prisma';

export const healthRoutes = Router();

/** Diz se a API está no ar e se o banco responde. O front mostra isso no rodapé. */
healthRoutes.get('/', async (_req, res) => {
  let db: 'up' | 'down' = 'down';
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = 'up';
  } catch {
    db = 'down';
  }
  res.json({ status: 'ok', db, time: new Date().toISOString() });
});
