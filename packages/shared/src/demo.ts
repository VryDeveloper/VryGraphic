import type { CommandContext } from './command';

/**
 * Categorias e contas padrão de toda conta nova (e do usuário demo).
 * Os ids aqui são chaves estáveis; no banco cada usuário recebe UUIDs próprios.
 */
export const DEFAULT_CATEGORIES = [
  { key: 'moradia', name: 'Moradia', kind: 'EXPENSE' },
  { key: 'alimentacao', name: 'Alimentação', kind: 'EXPENSE' },
  { key: 'transporte', name: 'Transporte', kind: 'EXPENSE' },
  { key: 'lazer', name: 'Lazer', kind: 'EXPENSE' },
  { key: 'saude', name: 'Saúde', kind: 'EXPENSE' },
  { key: 'tecnologia', name: 'Tecnologia', kind: 'EXPENSE' },
  { key: 'outros', name: 'Outros', kind: 'EXPENSE' },
  { key: 'trabalho', name: 'Trabalho', kind: 'INCOME' },
  { key: 'outras-receitas', name: 'Outras receitas', kind: 'INCOME' },
] as const;

export const DEMO_ACCOUNTS = [
  { key: 'nubank', name: 'Conta Nubank', kind: 'CHECKING', aliases: ['conta', 'nubank-conta'], defaultFor: 'INCOME' },
  { key: 'inter', name: 'Conta Inter', kind: 'CHECKING', aliases: ['inter'] },
  { key: 'cartao', name: 'Cartão Nubank', kind: 'CREDIT_CARD', aliases: ['cartao', 'nubank', 'nu'], defaultFor: 'EXPENSE' },
  { key: 'reserva', name: 'Reserva de emergência', kind: 'SAVINGS', aliases: ['reserva'] },
] as const;

/** Contexto do parser montado a partir das listas padrão (usado na prévia offline e nos testes). */
export function demoCommandContext(today: string): CommandContext {
  return {
    today,
    categories: DEFAULT_CATEGORIES.map((c) => ({ id: c.key, name: c.name, kind: c.kind })),
    accounts: DEMO_ACCOUNTS.map((a) => ({
      id: a.key,
      name: a.name,
      aliases: [...a.aliases],
      defaultFor: 'defaultFor' in a ? a.defaultFor : undefined,
    })),
  };
}
