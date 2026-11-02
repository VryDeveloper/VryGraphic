import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { AppError, asyncHandler, validateBody } from '../../lib/errors';
import { uid } from '../../lib/http';

export const meRoutes = Router();

/** Quem está logado. */
meRoutes.get('/', asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: uid(req) }, select: { id: true, name: true, email: true, isDemo: true, timezone: true, onboardedAt: true } });
  if (!user) throw new AppError(404, 'NOT_FOUND', 'Usuário não encontrado');
  const { onboardedAt, ...rest } = user;
  res.json({ user: { ...rest, onboarded: onboardedAt !== null } });
}));

/**
 * Guia de primeiro uso: `done: true` ao terminar ou pular, `false` para ver de novo no próximo acesso.
 * O usuário demo é compartilhado por todos os visitantes, então para ele o front guarda no navegador
 * e esta rota não grava nada (senão só o primeiro visitante veria o guia).
 */
meRoutes.put('/onboarding', validateBody(z.object({ done: z.boolean() })), asyncHandler(async (req, res) => {
  if (req.isDemo) {
    res.json({ onboarded: req.body.done, stored: 'browser' });
    return;
  }
  const u = await prisma.user.update({ where: { id: uid(req) }, data: { onboardedAt: req.body.done ? new Date() : null }, select: { onboardedAt: true } });
  res.json({ onboarded: u.onboardedAt !== null, stored: 'account' });
}));
