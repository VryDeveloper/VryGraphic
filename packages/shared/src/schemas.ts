import { z } from 'zod';
import { ISO_DATE, ISO_MONTH } from './dates';

/** Schemas Zod compartilhados entre a API (validação) e o front (formulários). */

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'nome muito curto').max(80),
  email: z.string().trim().toLowerCase().email('e-mail inválido'),
  password: z.string().min(8, 'pelo menos 8 caracteres').max(128),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('e-mail inválido'),
  password: z.string().min(1, 'informe a senha'),
});

export const commandSchema = z.object({
  text: z.string().trim().min(1, 'digite um comando').max(200),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CommandInput = z.infer<typeof commandSchema>;

// ───────────────────────── CRUD (fase 3) ─────────────────────────

const id = z.string().uuid('id inválido');
const isoDate = z.string().regex(ISO_DATE, 'data no formato AAAA-MM-DD');
const isoMonth = z.string().regex(ISO_MONTH, 'mês no formato AAAA-MM');
/** Centavos: inteiro, positivo, até R$ 10 milhões por lançamento. */
const positiveCents = z.number({ invalid_type_error: 'valor em centavos' }).int('centavos inteiros').positive('valor maior que zero').max(1_000_000_000, 'valor alto demais');
const cents = z.number().int('centavos inteiros').min(-1_000_000_000).max(1_000_000_000);
const name = z.string().trim().min(1, 'informe o nome').max(60, 'até 60 caracteres');
const day = z.number().int().min(1, 'dia de 1 a 31').max(31, 'dia de 1 a 31');

export const accountKinds = ['CHECKING', 'SAVINGS', 'CREDIT_CARD', 'INVESTMENT', 'CASH'] as const;

const accountBase = z.object({
  name,
  kind: z.enum(accountKinds),
  aliases: z.array(z.string().trim().toLowerCase().min(2).max(20).regex(/^[a-z0-9-]+$/, 'apelido sem espaço nem acento')).max(5).default([]),
  openingBalanceCents: cents.default(0),
  creditLimitCents: positiveCents.nullable().optional(),
  closingDay: day.nullable().optional(),
  dueDay: day.nullable().optional(),
});

export const accountCreateSchema = accountBase.superRefine((a, ctx) => {
  if (a.kind === 'CREDIT_CARD') {
    if (!a.closingDay) ctx.addIssue({ code: 'custom', path: ['closingDay'], message: 'cartão precisa do dia de fechamento' });
    if (!a.dueDay) ctx.addIssue({ code: 'custom', path: ['dueDay'], message: 'cartão precisa do dia de vencimento' });
  }
});
export const accountUpdateSchema = accountBase.omit({ kind: true }).partial().refine((o) => Object.keys(o).length > 0, 'nada para alterar');

export const categoryCreateSchema = z.object({ name: z.string().trim().min(2, 'nome muito curto').max(40), kind: z.enum(['INCOME', 'EXPENSE']) });
export const categoryUpdateSchema = categoryCreateSchema.pick({ name: true });

export const transactionCreateSchema = z.object({
  kind: z.enum(['INCOME', 'EXPENSE']),
  description: z.string().trim().min(1, 'informe a descrição').max(120),
  /** Sempre positivo: o sinal vem do tipo (despesa grava negativo). */
  amountCents: positiveCents,
  accountId: id,
  categoryId: id.nullable().default(null),
  date: isoDate,
  installments: z.number().int().min(1).max(24, 'parcelas vão de 1x a 24x').default(1),
});

export const transactionUpdateSchema = z
  .object({
    description: z.string().trim().min(1).max(120),
    amountCents: positiveCents,
    accountId: id,
    categoryId: id.nullable(),
    date: isoDate,
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'nada para alterar');

export const transferCreateSchema = z
  .object({
    fromAccountId: id,
    toAccountId: id,
    amountCents: positiveCents,
    date: isoDate,
    description: z.string().trim().max(120).default('Transferência'),
  })
  .refine((t) => t.fromAccountId !== t.toAccountId, { path: ['toAccountId'], message: 'escolha outra conta de destino' });

export const transactionListSchema = z.object({
  month: isoMonth.optional(),
  accountId: id.optional(),
  categoryId: id.optional(),
  kind: z.enum(['INCOME', 'EXPENSE', 'TRANSFER']).optional(),
  q: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().max(200).optional(),
});

export const budgetUpsertSchema = z.object({ categoryId: id, month: isoMonth, limitCents: positiveCents });
export const budgetListSchema = z.object({ month: isoMonth });

const goalBase = z.object({
  name,
  accountId: id,
  targetCents: positiveCents,
  monthlyContributionCents: z.number().int().min(0).max(1_000_000_000),
  /** pontos-base ao mês: 85 = 0,85% a.m. */
  monthlyRateBps: z.number().int().min(0).max(1000).default(85),
});
export const goalCreateSchema = goalBase;
export const goalUpdateSchema = goalBase.partial().refine((o) => Object.keys(o).length > 0, 'nada para alterar');

export type AccountCreate = z.infer<typeof accountCreateSchema>;
export type AccountUpdate = z.infer<typeof accountUpdateSchema>;
export type TransactionCreate = z.infer<typeof transactionCreateSchema>;
export type TransactionUpdate = z.infer<typeof transactionUpdateSchema>;
export type TransferCreate = z.infer<typeof transferCreateSchema>;
export type TransactionListQuery = z.infer<typeof transactionListSchema>;
export type GoalCreate = z.infer<typeof goalCreateSchema>;
export type GoalUpdate = z.infer<typeof goalUpdateSchema>;

/** Aplicar vários limites de uma vez (ex.: as sugestões para o mês seguinte). */
export const budgetApplySchema = z.object({
  month: isoMonth,
  items: z.array(z.object({ categoryId: id, limitCents: positiveCents })).min(1, 'nada para aplicar').max(50),
});
export type BudgetApply = z.infer<typeof budgetApplySchema>;

// ───────────────────────── alertas (fase 6) ─────────────────────────
export const ALERT_KINDS = ['BUDGET_THRESHOLD', 'INVOICE_CLOSING', 'GOAL_ETA_CHANGED', 'RECURRENCE_MISSED'] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];
export const alertRuleUpdateSchema = z.object({
  enabled: z.boolean(),
  threshold: z.number().int().min(1, 'mínimo 1').max(100, 'máximo 100').nullable().optional(),
});
export type AlertRuleUpdate = z.infer<typeof alertRuleUpdateSchema>;

// ───────────────────────── contas fixas ─────────────────────────
const recurrenceBase = z.object({
  kind: z.enum(['INCOME', 'EXPENSE']),
  description: z.string().trim().min(1, 'informe a descrição').max(80),
  amountCents: positiveCents,
  accountId: id,
  categoryId: id,
  dayOfMonth: day,
});
export const recurrenceCreateSchema = recurrenceBase;
export const recurrenceUpdateSchema = recurrenceBase
  .omit({ kind: true })
  .extend({ active: z.boolean() })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'nada para alterar');
export type RecurrenceCreate = z.infer<typeof recurrenceCreateSchema>;
export type RecurrenceUpdate = z.infer<typeof recurrenceUpdateSchema>;
