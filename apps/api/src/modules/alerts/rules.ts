import { ALERT_KINDS, type AlertKind, type AlertRuleUpdate } from '@vrygraphic/shared';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';

/** Padrões de cada regra. Sem linha no banco, vale o padrão; salvar cria a linha (upsert). */
export const RULE_DEFAULTS: Record<AlertKind, { enabled: boolean; threshold: number | null; label: string; unit: string | null }> = {
  BUDGET_THRESHOLD: { enabled: true, threshold: 90, label: 'Categoria passa de {n}% do limite', unit: '%' },
  INVOICE_CLOSING: { enabled: true, threshold: 5, label: 'Fatura fecha em {n} dias', unit: 'dias' },
  GOAL_ETA_CHANGED: { enabled: true, threshold: null, label: 'Meta muda de previsão', unit: null },
  RECURRENCE_MISSED: { enabled: false, threshold: null, label: 'Conta fixa não lançada no dia', unit: null },
};

export type Rules = Record<AlertKind, { enabled: boolean; threshold: number | null }>;

export async function getRules(userId: string): Promise<Rules> {
  const rows = await prisma.alertRule.findMany({ where: { userId } });
  return Object.fromEntries(
    ALERT_KINDS.map((k) => {
      const row = rows.find((r) => r.kind === k);
      const d = RULE_DEFAULTS[k];
      return [k, { enabled: row?.enabled ?? d.enabled, threshold: d.threshold === null ? null : row?.threshold ?? d.threshold }];
    }),
  ) as Rules;
}

export async function listRules(userId: string) {
  const rules = await getRules(userId);
  return ALERT_KINDS.map((k) => ({ kind: k, ...rules[k], label: RULE_DEFAULTS[k].label, unit: RULE_DEFAULTS[k].unit }));
}

export async function setRule(userId: string, kind: string, input: AlertRuleUpdate) {
  if (!(ALERT_KINDS as readonly string[]).includes(kind)) throw new AppError(404, 'NOT_FOUND', 'Regra não encontrada');
  const k = kind as AlertKind;
  // regra sem número (ex.: "meta muda de previsão") ignora threshold
  const threshold = RULE_DEFAULTS[k].threshold === null ? null : input.threshold ?? undefined;
  await prisma.alertRule.upsert({
    where: { userId_kind: { userId, kind: k } },
    create: { userId, kind: k, enabled: input.enabled, threshold: threshold ?? RULE_DEFAULTS[k].threshold },
    update: { enabled: input.enabled, ...(threshold !== undefined ? { threshold } : {}) },
  });
  return (await listRules(userId)).find((r) => r.kind === k)!;
}
