import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';

export interface AccessPayload {
  sub: string; // id do usuário
  email: string;
  demo: boolean;
}

/** Access token de vida curta (15 min), enviado no header Authorization. */
export function signAccessToken(payload: AccessPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessPayload {
  return jwt.verify(token, env.JWT_SECRET) as AccessPayload;
}

/**
 * Refresh token: 32 bytes aleatórios. Diferente da jwt-api original, o banco guarda
 * só o SHA-256 dele, então um vazamento do banco não entrega sessões válidas.
 */
export function newRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
