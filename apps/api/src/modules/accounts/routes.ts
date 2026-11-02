import { Router } from 'express';
import { accountCreateSchema, accountUpdateSchema } from '@vrygraphic/shared';
import { asyncHandler, validateBody } from '../../lib/errors';
import { uid, uuidParam } from '../../lib/http';
import * as accounts from './service';

export const accountRoutes = Router();
accountRoutes.param('id', uuidParam);

accountRoutes.get('/', asyncHandler(async (req, res) => {
  res.json({ items: await accounts.list(uid(req)) });
}));
accountRoutes.post('/', validateBody(accountCreateSchema), asyncHandler(async (req, res) => {
  res.status(201).json(await accounts.create(uid(req), req.body));
}));
accountRoutes.patch('/:id', validateBody(accountUpdateSchema), asyncHandler(async (req, res) => {
  res.json(await accounts.update(uid(req), req.params.id, req.body));
}));
accountRoutes.delete('/:id', asyncHandler(async (req, res) => {
  await accounts.remove(uid(req), req.params.id);
  res.status(204).end();
}));
