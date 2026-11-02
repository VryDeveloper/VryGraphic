import { Router } from 'express';
import { recurrenceCreateSchema, recurrenceUpdateSchema } from '@vrygraphic/shared';
import { asyncHandler, validateBody } from '../../lib/errors';
import { uid, uuidParam } from '../../lib/http';
import * as recurrences from './service';

export const recurrenceRoutes = Router();
recurrenceRoutes.param('id', uuidParam);

recurrenceRoutes.get('/', asyncHandler(async (req, res) => {
  res.json({ items: await recurrences.list(uid(req)) });
}));
recurrenceRoutes.post('/', validateBody(recurrenceCreateSchema), asyncHandler(async (req, res) => {
  res.status(201).json(await recurrences.create(uid(req), req.body));
}));
recurrenceRoutes.patch('/:id', validateBody(recurrenceUpdateSchema), asyncHandler(async (req, res) => {
  res.json(await recurrences.update(uid(req), req.params.id, req.body));
}));
recurrenceRoutes.delete('/:id', asyncHandler(async (req, res) => {
  await recurrences.remove(uid(req), req.params.id);
  res.status(204).end();
}));
