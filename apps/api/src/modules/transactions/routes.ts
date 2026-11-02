import { Router } from 'express';
import { commandSchema, transactionCreateSchema, transactionListSchema, transactionUpdateSchema, transferCreateSchema } from '@vrygraphic/shared';
import { asyncHandler, validateBody } from '../../lib/errors';
import { parseQuery, uid, uuidParam } from '../../lib/http';
import * as tx from './service';

export const transactionRoutes = Router();
transactionRoutes.param('id', uuidParam);

transactionRoutes.get('/', asyncHandler(async (req, res) => {
  res.json(await tx.list(uid(req), parseQuery(transactionListSchema, req)));
}));
transactionRoutes.post('/', validateBody(transactionCreateSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ items: await tx.create(uid(req), req.body) });
}));
transactionRoutes.post('/command', validateBody(commandSchema), asyncHandler(async (req, res) => {
  res.status(201).json(await tx.createFromCommand(uid(req), req.body.text));
}));
transactionRoutes.get('/:id', asyncHandler(async (req, res) => {
  res.json(await tx.get(uid(req), req.params.id));
}));
transactionRoutes.patch('/:id', validateBody(transactionUpdateSchema), asyncHandler(async (req, res) => {
  res.json(await tx.update(uid(req), req.params.id, req.body));
}));
transactionRoutes.delete('/:id', asyncHandler(async (req, res) => {
  res.json(await tx.remove(uid(req), req.params.id));
}));
transactionRoutes.post('/:id/restore', asyncHandler(async (req, res) => {
  res.json(await tx.restore(uid(req), req.params.id));
}));

export const transferRoutes = Router();
transferRoutes.post('/', validateBody(transferCreateSchema), asyncHandler(async (req, res) => {
  res.status(201).json(await tx.transfer(uid(req), req.body));
}));
