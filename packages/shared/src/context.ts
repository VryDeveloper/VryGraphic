import type { CommandContext, CommandKind } from './command';
import { normalize } from './command';

export interface ContextAccount { id: string; name: string; kind: string; aliases: string[] }
export interface ContextCategory { id: string; name: string; kind: string }

/**
 * Monta o contexto do parser a partir das contas e categorias REAIS do usuário.
 * Usado igual no front (prévia ao digitar) e na API (gravação), então os dois concordam.
 * Conta padrão: despesa vai no primeiro cartão (ou na primeira conta), receita na primeira conta corrente.
 */
export function buildCommandContext(input: { accounts: ContextAccount[]; categories: ContextCategory[]; today: string }): CommandContext {
  const firstCard = input.accounts.find((a) => a.kind === 'CREDIT_CARD');
  const firstChecking = input.accounts.find((a) => a.kind === 'CHECKING') ?? input.accounts[0];
  const expenseDefault = firstCard ?? firstChecking;
  return {
    today: input.today,
    categories: input.categories
      .filter((c) => c.kind === 'INCOME' || c.kind === 'EXPENSE')
      .map((c) => ({ id: c.id, name: c.name, kind: c.kind as CommandKind })),
    accounts: input.accounts.map((a) => {
      const defaults: CommandKind[] = [];
      if (a.id === expenseDefault?.id) defaults.push('EXPENSE');
      if (a.id === firstChecking?.id) defaults.push('INCOME');
      return {
        id: a.id,
        name: a.name,
        aliases: a.aliases.map(normalize),
        // quando a mesma conta é padrão de despesa e de receita, vale para as duas
        defaultFor: defaults.length === 2 ? 'ANY' : defaults[0],
      };
    }),
  };
}
