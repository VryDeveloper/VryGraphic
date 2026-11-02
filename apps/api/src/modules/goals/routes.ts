import { Router } from 'express';
import { goalCreateSchema, goalUpdateSchema } from '@vrygraphic/shared';
import { asyncHandler, validateBody } from '../../lib/errors';
import { uid, uuidParam } from '../../lib/http';
import * as goals from './service';

export const goalRoutes = Router();
goalRoutes.param('id', uuidParam);

goalRoutes.get('/', asyncHandler(async (req, res) => {
  res.json({ items: await goals.list(uid(req)) });
}));
goalRoutes.post('/', validateBody(goalCreateSchema), asyncHandler(async (req, res) => {
  res.status(201).json(await goals.create(uid(req), req.body));
}));
goalRoutes.patch('/:id', validateBody(goalUpdateSchema), asyncHandler(async (req, res) => {
  res.json(await goals.update(uid(req), req.params.id, req.body));
}));
goalRoutes.delete('/:id', asyncHandler(async (req, res) => {
  await goals.remove(uid(req), req.params.id);
  res.status(204).end();
}));
