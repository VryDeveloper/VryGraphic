import { Router } from 'express';
import { categoryCreateSchema, categoryUpdateSchema } from '@vrygraphic/shared';
import { asyncHandler, validateBody } from '../../lib/errors';
import { uid, uuidParam } from '../../lib/http';
import * as categories from './service';

export const categoryRoutes = Router();
categoryRoutes.param('id', uuidParam);

categoryRoutes.get('/', asyncHandler(async (req, res) => {
  res.json({ items: await categories.list(uid(req)) });
}));
categoryRoutes.post('/', validateBody(categoryCreateSchema), asyncHandler(async (req, res) => {
  res.status(201).json(await categories.create(uid(req), req.body));
}));
categoryRoutes.patch('/:id', validateBody(categoryUpdateSchema), asyncHandler(async (req, res) => {
  res.json(await categories.rename(uid(req), req.params.id, req.body.name));
}));
categoryRoutes.delete('/:id', asyncHandler(async (req, res) => {
  await categories.remove(uid(req), req.params.id);
  res.status(204).end();
}));
