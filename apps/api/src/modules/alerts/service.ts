import { todayISO } from '@vrygraphic/shared';
import { prisma } from '../../lib/prisma';
import { evaluateAlerts, type AlertLevel } from './evaluate';

/** Avalia as regras (barato e idempotente) e devolve os alertas mais recentes. */
export async function list(userId: string, limit = 20, today = todayISO()) {
  await evaluateAlerts(userId, today);
  const [items, unread] = await Promise.all([
    prisma.alert.findMany({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit }),
    prisma.alert.count({ where: { userId, readAt: null } }),
  ]);
  return {
    unread,
    items: items.map((a) => ({
      id: a.id,
      kind: a.kind,
      level: ((a.payload as { level?: AlertLevel })?.level ?? 'info') as AlertLevel,
      message: a.message,
      createdAt: a.createdAt.toISOString(),
      read: a.readAt !== null,
    })),
  };
}

export async function markAllRead(userId: string) {
  const r = await prisma.alert.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
  return { read: r.count };
}
