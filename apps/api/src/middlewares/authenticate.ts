import type { RequestHandler } from 'express';
import { AppError } from '../lib/errors';
import { verifyAccessToken } from '../modules/auth/tokens';

declare global {
  namespace Express {
    interface Request {
      /** Preenchido pelo authenticate: todo serviço filtra os dados por este id. */
      userId?: string;
      isDemo?: boolean;
    }
  }
}

/** Exige `Authorization: Bearer <accessToken>` válido. */
export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(new AppError(401, 'NO_TOKEN', 'Entre para continuar'));
  try {
    const payload = verifyAccessToken(header.slice(7));
    req.userId = payload.sub;
    req.isDemo = payload.demo;
    next();
  } catch {
    next(new AppError(401, 'INVALID_TOKEN', 'Sessão expirada'));
  }
};
