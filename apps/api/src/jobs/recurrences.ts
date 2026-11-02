import { addMonths, dayOfMonth } from '@vrygraphic/shared';
import { prisma } from '../lib/prisma';
import { create } from '../modules/transactions/service';

const asDate = (d: string) => new Date(`${d}T00:00:00Z`);

/**
 * Lança as contas fixas vencidas até `today` e agenda a próxima.
 * - Recupera atrasos: servidor parado 3 meses lança os 3 meses.
 * - Idempotente e seguro com duas execuções ao mesmo tempo: antes de lançar, cada execução "reserva"
 *   o mês movendo next_run_on com um UPDATE condicional (WHERE next_run_on = valor lido).
 *   Só quem consegue mover lança; a outra vê 0 linhas alteradas e pula.
 * - Se o lançamento falhar (ex.: categoria excluída), a reserva é desfeita e o erro fica no log.
 */
export async function runRecurrences(today: string, userId?: string) {
  const due = await prisma.recurrence.findMany({
    where: { active: true, nextRunOn: { lte: asDate(today) }, account: { deletedAt: null }, ...(userId ? { userId } : {}) },
  });
  let created = 0;
  const failed: { id: string; error: string }[] = [];

  for (const r of due) {
    let next = r.nextRunOn.toISOString().slice(0, 10);
    while (next <= today) {
      const following = dayOfMonth(addMonths(next.slice(0, 7), 1), r.dayOfMonth);
      const claimed = await prisma.recurrence.updateMany({ where: { id: r.id, nextRunOn: asDate(next) }, data: { nextRunOn: asDate(following) } });
      if (claimed.count === 0) break; // outra execução já pegou este mês
      try {
        const amount = Number(r.amountCents);
        await create(
          r.userId,
          { kind: amount < 0 ? 'EXPENSE' : 'INCOME', description: r.description, amountCents: Math.abs(amount), accountId: r.accountId, categoryId: r.categoryId, date: next, installments: 1 },
          'RECURRING',
          { recurrenceId: r.id },
        );
        created++;
      } catch (e) {
        await prisma.recurrence.updateMany({ where: { id: r.id, nextRunOn: asDate(following) }, data: { nextRunOn: asDate(next) } });
        failed.push({ id: r.id, error: (e as Error).message });
        break;
      }
      next = following;
    }
  }
  return { created, failed };
}
