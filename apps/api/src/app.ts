import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env';
import { AppError, errorHandler } from './lib/errors';
import { authenticate } from './middlewares/authenticate';
import { authRoutes } from './modules/auth/routes';
import { commandRoutes } from './modules/command/routes';
import { healthRoutes } from './modules/health/routes';
import { accountRoutes } from './modules/accounts/routes';
import { budgetRoutes } from './modules/budgets/routes';
import { categoryRoutes } from './modules/categories/routes';
import { goalRoutes } from './modules/goals/routes';
import { dashboardRoutes } from './modules/dashboard/routes';
import { alertRoutes } from './modules/alerts/routes';
import { meRoutes } from './modules/me/routes';
import { agentRoutes } from './modules/agent/routes';
import { recurrenceRoutes } from './modules/recurrences/routes';
import { transactionRoutes, transferRoutes } from './modules/transactions/routes';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // atrás do proxy do Render/Railway: IP real no rate limit e cookie "secure" funcionando
  if (env.NODE_ENV === 'production') app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  const api = express.Router();
  api.use('/health', healthRoutes);
  api.use('/auth', authRoutes);
  api.use('/command', commandRoutes);

  // tudo daqui para baixo exige login e filtra pelo usuário do token
  api.use('/accounts', authenticate, accountRoutes);
  api.use('/categories', authenticate, categoryRoutes);
  api.use('/transactions', authenticate, transactionRoutes);
  api.use('/transfers', authenticate, transferRoutes);
  api.use('/budgets', authenticate, budgetRoutes);
  api.use('/goals', authenticate, goalRoutes);
  api.use('/recurrences', authenticate, recurrenceRoutes);
  api.use('/dashboard', authenticate, dashboardRoutes);
  api.use('/alerts', authenticate, alertRoutes);
  api.use('/agent', authenticate, agentRoutes);

  api.use('/me', authenticate, meRoutes);

  app.use('/api/v1', api);
  app.use('/api', (_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Rota não encontrada')));

  // Produção: a própria API entrega o front já compilado (um serviço só, mesma origem, sem CORS).
  const web = fileURLToPath(new URL('../../web/dist', import.meta.url));
  if (env.NODE_ENV === 'production' && existsSync(web)) {
    app.use('/assets', express.static(`${web}/assets`, { maxAge: '1y', immutable: true }));
    app.use(express.static(web, { index: false, maxAge: '1h' }));
    // qualquer outra rota é do React: devolve o index.html
    app.get('*', (_req, res) => res.sendFile(`${web}/index.html`));
  }

  app.use((_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Rota não encontrada')));
  app.use(errorHandler);
  return app;
}
