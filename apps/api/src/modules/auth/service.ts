import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { LoginInput, RegisterInput } from '@vrygraphic/shared';
import { DEFAULT_CATEGORIES } from '@vrygraphic/shared';
import { env } from '../../config/env';
import { AppError } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { hashToken, newRefreshToken, signAccessToken } from './tokens';

/**
 * Janela em que reusar um refresh token recém-girado conta como corrida entre abas, e não como roubo.
 * Fora dela, reuso derruba a família inteira de tokens.
 */
const REUSE_GRACE_MS = 30_000;
/** Custo 12 em produção; nos testes, 4 para a suíte não levar minutos. */
const BCRYPT_COST = env.NODE_ENV === 'test' ? 4 : 12;
/** Hash de verdade para comparar quando o e-mail não existe: o tempo de resposta não revela nada. */
const DUMMY_HASH = bcrypt.hashSync('senha-que-nao-existe', BCRYPT_COST);

type PublicUser = { id: string; name: string; email: string; isDemo: boolean; onboarded: boolean };

/** O que o front recebe sobre a pessoa. `onboarded` decide se o guia de primeiro uso aparece. */
function toPublic(u: { id: string; name: string; email: string; isDemo: boolean; onboardedAt: Date | null }): PublicUser {
  return { id: u.id, name: u.name, email: u.email, isDemo: u.isDemo, onboarded: u.onboardedAt !== null };
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
}

/** Cria a sessão: access token + refresh token novo numa família nova (login) ou existente (rotação). */
async function issueSession(user: PublicUser, familyId: string = randomUUID()): Promise<Session> {
  const { token, hash } = newRefreshToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 864e5);
  await prisma.refreshToken.create({ data: { userId: user.id, tokenHash: hash, familyId, expiresAt } });
  return {
    accessToken: signAccessToken({ sub: user.id, email: user.email, demo: user.isDemo }),
    refreshToken: token,
    user,
  };
}

export async function register(input: RegisterInput): Promise<Session> {
  const exists = await prisma.user.findUnique({ where: { email: input.email } });
  if (exists) throw new AppError(409, 'EMAIL_TAKEN', 'Este e-mail já tem conta', { email: 'já cadastrado' });

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);
  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      passwordHash,
      categories: { create: DEFAULT_CATEGORIES.map((c) => ({ name: c.name, kind: c.kind })) },
      // contas iniciais para o comando funcionar logo no primeiro uso; o usuário edita depois
      accounts: {
        create: [
          { name: 'Conta corrente', kind: 'CHECKING', aliases: ['conta'] },
          { name: 'Cartão de crédito', kind: 'CREDIT_CARD', aliases: ['cartao'], creditLimitCents: 300000n, closingDay: 5, dueDay: 12 },
        ],
      },
    },
    select: { id: true, name: true, email: true, isDemo: true, onboardedAt: true },
  });
  return issueSession(toPublic(user));
}

export async function login(input: LoginInput): Promise<Session> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  // mesma mensagem para e-mail inexistente e senha errada: não revela quais e-mails têm conta
  const ok = user ? await bcrypt.compare(input.password, user.passwordHash) : await bcrypt.compare(input.password, DUMMY_HASH);
  if (!user || !ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'E-mail ou senha incorretos');
  return issueSession(toPublic(user));
}

/**
 * Rotação: cada refresh token só serve UMA vez. Se um token já revogado for usado de novo,
 * alguém copiou o token: a família inteira é revogada e a pessoa precisa entrar de novo.
 */
export async function refresh(token: string | undefined): Promise<Session> {
  if (!token) throw new AppError(401, 'NO_SESSION', 'Sessão expirada');
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!stored) throw new AppError(401, 'NO_SESSION', 'Sessão expirada');

  if (stored.revokedAt) {
    // Girado há poucos segundos: são duas abas (ou dois pedidos) renovando ao mesmo tempo, não um roubo.
    // Recusa este pedido, mas mantém a sessão; o front tenta de novo com o cookie novo.
    if (Date.now() - stored.revokedAt.getTime() < REUSE_GRACE_MS) {
      throw new AppError(401, 'TOKEN_RACE', 'Sessão sendo renovada, tente de novo');
    }
    await prisma.refreshToken.updateMany({ where: { familyId: stored.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    throw new AppError(401, 'TOKEN_REUSED', 'Sessão encerrada por segurança. Entre novamente.');
  }
  if (stored.expiresAt < new Date()) throw new AppError(401, 'NO_SESSION', 'Sessão expirada');

  // Rotação atômica: só um pedido consegue marcar este token como usado (UPDATE ... WHERE revoked_at IS NULL).
  // Se outro pedido ganhou a corrida, este cai na mesma regra de token recém-girado.
  const claimed = await prisma.refreshToken.updateMany({ where: { id: stored.id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (claimed.count === 0) throw new AppError(401, 'TOKEN_RACE', 'Sessão sendo renovada, tente de novo');
  const u = stored.user;
  return issueSession(toPublic(u), stored.familyId);
}

export async function logout(token: string | undefined): Promise<void> {
  if (!token) return;
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (stored) await prisma.refreshToken.updateMany({ where: { familyId: stored.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
}
