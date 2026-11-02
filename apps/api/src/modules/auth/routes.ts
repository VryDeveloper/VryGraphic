import { Router, type CookieOptions, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { loginSchema, registerSchema } from '@vrygraphic/shared';
import { env } from '../../config/env';
import { asyncHandler, validateBody } from '../../lib/errors';
import * as auth from './service';

const COOKIE = 'vry_refresh';
const cookieOptions: CookieOptions = {
  httpOnly: true, // JavaScript do navegador não lê: protege contra XSS
  secure: env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/api/v1/auth',
  maxAge: env.REFRESH_TOKEN_DAYS * 864e5,
};

function sendSession(res: Response, s: auth.Session, status = 200) {
  res.cookie(COOKIE, s.refreshToken, cookieOptions);
  res.status(status).json({ accessToken: s.accessToken, user: s.user });
}

/** 10 tentativas por minuto por IP em cadastro e login. */
const limiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false, skip: () => env.NODE_ENV === 'test' });

export const authRoutes = Router();

authRoutes.post('/register', limiter, validateBody(registerSchema), asyncHandler(async (req, res) => {
  sendSession(res, await auth.register(req.body), 201);
}));

authRoutes.post('/login', limiter, validateBody(loginSchema), asyncHandler(async (req, res) => {
  sendSession(res, await auth.login(req.body));
}));

authRoutes.post('/refresh', asyncHandler(async (req, res) => {
  sendSession(res, await auth.refresh(req.cookies?.[COOKIE]));
}));

authRoutes.post('/logout', asyncHandler(async (req, res) => {
  await auth.logout(req.cookies?.[COOKIE]);
  res.clearCookie(COOKIE, { ...cookieOptions, maxAge: undefined });
  res.status(204).end();
}));
