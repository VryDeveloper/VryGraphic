import { Router } from 'express';
import { alertRuleUpdateSchema } from '@vrygraphic/shared';
import { asyncHandler, validateBody } from '../../lib/errors';
import { uid } from '../../lib/http';
import { listRules, setRule } from './rules';
import { list, markAllRead } from './service';

export const alertRoutes = Router();

alertRoutes.get('/', asyncHandler(async (req, res) => {
  res.json(await list(uid(req)));
}));
alertRoutes.post('/read', asyncHandler(async (req, res) => {
  res.json(await markAllRead(uid(req)));
}));
alertRoutes.get('/rules', asyncHandler(async (req, res) => {
  res.json({ items: await listRules(uid(req)) });
}));
alertRoutes.put('/rules/:kind', validateBody(alertRuleUpdateSchema), asyncHandler(async (req, res) => {
  res.json(await setRule(uid(req), req.params.kind, req.body));
}));
