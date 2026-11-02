import { instantToDate, todayISO, TZ } from '@vrygraphic/shared';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { evaluateAlerts } from '../modules/alerts/evaluate';
import { DEMO_EMAIL, resetDemo } from '../modules/demo/write';
import { runRecurrences } from './recurrences';

/** Uma rodada completa: contas fixas, alertas de todo mundo e, se for hora, o reset do demo. */
export async function runAllJobs(now = new Date()) {
  const today = todayISO(now);
  const started = Date.now();
  const demo = await maybeResetDemo(now);
  const recurrences = await runRecurrences(today);
  const users = await prisma.user.findMany({ select: { id: true } });
  let alerts = 0;
  for (const u of users) alerts += await evaluateAlerts(u.id, today);
  return { today, demoReset: demo, recurrences: recurrences.created, failed: recurrences.failed, alerts, ms: Date.now() - started };
}

/** Reseta o demo uma vez por dia, a partir de DEMO_RESET_HOUR (horário de São Paulo). Usa a data de criação do usuário demo como marcador. */
async function maybeResetDemo(now: Date) {
  if (!env.DEMO_RESET) return false;
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(now));
  const today = todayISO(now);
  const demo = await prisma.user.findUnique({ where: { email: DEMO_EMAIL }, select: { createdAt: true } });
  if (demo && (hour < env.DEMO_RESET_HOUR || instantToDate(demo.createdAt) === today)) return false;
  await resetDemo(today);
  return true;
}

/**
 * Agendador dentro do próprio processo: roda 10 s depois de subir e depois a cada hora.
 * Para um servidor só é o suficiente e não exige outro serviço. Com várias instâncias,
 * o UPDATE condicional das recorrências e o ON CONFLICT dos alertas já evitam duplicar.
 */
export function startScheduler() {
  if (!env.JOBS_ENABLED) return;
  const tick = async () => {
    try {
      const r = await runAllJobs();
      if (r.recurrences || r.alerts || r.demoReset || r.failed.length) console.log('[jobs]', JSON.stringify(r));
    } catch (e) {
      console.error('[jobs] falhou:', e);
    }
  };
  setTimeout(tick, 10_000).unref();
  setInterval(tick, 60 * 60 * 1000).unref();
}
