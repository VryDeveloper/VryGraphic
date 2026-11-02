import { Router } from 'express';
import { budgetApplySchema, budgetListSchema, budgetUpsertSchema } from '@vrygraphic/shared';
import { asyncHandler, validateBody } from '../../lib/errors';
import { parseQuery, uid, uuidParam } from '../../lib/http';
import * as budgets from './service';

export const budgetRoutes = Router();
budgetRoutes.param('id', uuidParam);

budgetRoutes.get('/', asyncHandler(async (req, res) => {
  res.json({ items: await budgets.list(uid(req), parseQuery(budgetListSchema, req).month) });
}));
budgetRoutes.get('/plan', asyncHandler(async (req, res) => {
  res.json(await budgets.plan(uid(req), parseQuery(budgetListSchema, req).month));
}));
budgetRoutes.post('/apply', validateBody(budgetApplySchema), asyncHandler(async (req, res) => {
  res.json(await budgets.apply(uid(req), req.body));
}));
budgetRoutes.put('/', validateBody(budgetUpsertSchema), asyncHandler(async (req, res) => {
  res.json(await budgets.upsert(uid(req), req.body));
}));
budgetRoutes.delete('/:id', asyncHandler(async (req, res) => {
  await budgets.remove(uid(req), req.params.id);
  res.status(204).end();
}));
