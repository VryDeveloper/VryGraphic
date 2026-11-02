import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env';
import { asyncHandler, validateBody } from '../../lib/errors';
import { uid } from '../../lib/http';
import { agentEnabled } from './model';
import { devTerminalEnabled } from '../dev/terminal';
import { decide, reset, send } from './service';

export const agentRoutes = Router();

/** Por pessoa: 30 mensagens a cada 15 minutos. */
const perUser = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  keyGenerator: (req) => req.userId ?? 'anon',
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  handler: (_req, res) => res.status(429).json({ error: { code: 'AGENT_RATE_LIMIT', message: 'Muitas mensagens seguidas. Espere alguns minutos.' } }),
});

agentRoutes.get('/status', (req, res) => {
  const devTerminal = devTerminalEnabled();
  res.json({
    agent: { enabled: agentEnabled(), model: env.ANTHROPIC_MODEL, branding: 'Vry Agent · Powered by Claude' },
    dev: { enabled: devTerminal, reason: devTerminal ? null : env.NODE_ENV === 'production' ? 'desligado em produção' : 'ligue DEV_TERMINAL=true no apps/api/.env' },
  });
});

agentRoutes.post('/messages', perUser, validateBody(z.object({ text: z.string().trim().min(1).max(1000), sessionId: z.string().uuid().optional() })), asyncHandler(async (req, res) => {
  if (!agentEnabled()) {
    res.status(503).json({ error: { code: 'AGENT_DISABLED', message: 'Configure ANTHROPIC_API_KEY no apps/api/.env para usar o agente.' } });
    return;
  }
  res.json(await send(uid(req), req.body.text, req.body.sessionId));
}));

agentRoutes.post('/sessions/:id/decision', validateBody(z.object({ approve: z.boolean() })), asyncHandler(async (req, res) => {
  res.json(await decide(uid(req), req.params.id, req.body.approve));
}));

agentRoutes.delete('/sessions/:id', (req, res) => {
  reset(uid(req), req.params.id);
  res.status(204).end();
});
