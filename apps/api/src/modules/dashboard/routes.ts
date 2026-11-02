import { Router } from 'express';
import { z } from 'zod';
import { ISO_MONTH, todayISO } from '@vrygraphic/shared';
import { asyncHandler } from '../../lib/errors';
import { parseQuery, uid } from '../../lib/http';
import { dashboard } from './service';

const query = z.object({ month: z.string().regex(ISO_MONTH, 'mês no formato AAAA-MM').optional() });

export const dashboardRoutes = Router();

dashboardRoutes.get('/', asyncHandler(async (req, res) => {
  const { month } = parseQuery(query, req);
  res.json(await dashboard(uid(req), month ?? todayISO().slice(0, 7)));
}));
