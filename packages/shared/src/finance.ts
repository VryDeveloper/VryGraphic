import { assertCents, type Cents } from './money';

export interface GoalSimulation {
  /** Número de aportes mensais até atingir a meta (0 se já atingida). */
  months: number;
  reached: boolean;
  depositedCents: Cents;
  interestCents: Cents;
  finalBalanceCents: Cents;
  /** Saldo no fim de cada mês, em centavos. */
  path: Cents[];
}

/**
 * Juros compostos mensais com aporte no FIM de cada mês:
 *   saldo(m) = saldo(m-1) × (1 + taxa) + aporte
 * Taxa em pontos-base ao mês (85 = 0,85% a.m.). Para no máximo em `maxMonths`.
 * Cada mês é arredondado para o centavo, como um banco faria.
 */
export function simulateGoal(params: {
  currentCents: Cents;
  targetCents: Cents;
  monthlyContributionCents: Cents;
  monthlyRateBps: number;
  maxMonths?: number;
}): GoalSimulation {
  const { currentCents, targetCents, monthlyContributionCents, monthlyRateBps } = params;
  const maxMonths = params.maxMonths ?? 600;
  [currentCents, targetCents, monthlyContributionCents].forEach(assertCents);
  const rate = monthlyRateBps / 10_000;
  let balance = currentCents;
  let deposited = 0;
  const path: Cents[] = [];
  while (balance < targetCents && path.length < maxMonths) {
    if (monthlyContributionCents <= 0 && rate <= 0) break;
    balance = Math.round(balance * (1 + rate)) + monthlyContributionCents;
    deposited += monthlyContributionCents;
    path.push(balance);
  }
  return {
    months: path.length,
    reached: balance >= targetCents,
    depositedCents: deposited,
    interestCents: balance - currentCents - deposited,
    finalBalanceCents: balance,
    path,
  };
}

/** Média e desvio-padrão amostral (n − 1), como STDDEV_SAMP do PostgreSQL. */
export function meanAndSampleStd(values: number[]): { mean: number; std: number } {
  if (values.length < 2) throw new RangeError('precisa de pelo menos 2 valores');
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return { mean, std: Math.sqrt(variance) };
}

export interface Projection {
  monthsAhead: number;
  expectedCents: Cents;
  lowCents: Cents;
  highCents: Cents;
}

/**
 * Projeta o patrimônio a partir dos saldos de fim de mês (do mais antigo ao mais novo).
 * Usa as variações dos últimos `window` meses: média por mês e faixa de ±1 desvio × √k.
 */
export function projectNetWorth(monthEndBalances: Cents[], monthsAhead: number, window = 6): Projection[] {
  monthEndBalances.forEach(assertCents);
  if (monthEndBalances.length < window + 1) throw new RangeError(`precisa de ${window + 1} meses de histórico`);
  const recent = monthEndBalances.slice(-(window + 1));
  const deltas = recent.slice(1).map((v, i) => v - recent[i]);
  const { mean, std } = meanAndSampleStd(deltas);
  const last = monthEndBalances[monthEndBalances.length - 1];
  return Array.from({ length: monthsAhead }, (_, i) => {
    const k = i + 1;
    const expected = last + k * mean;
    const band = std * Math.sqrt(k);
    return {
      monthsAhead: k,
      expectedCents: Math.round(expected),
      lowCents: Math.round(expected - band),
      highCents: Math.round(expected + band),
    };
  });
}

/** Sugestão de limite: média dos meses informados, arredondada PARA CIMA em passos (padrão R$ 50). */
export function suggestBudget(pastMonthsSpentCents: Cents[], stepCents: Cents = 5000): Cents {
  pastMonthsSpentCents.forEach(assertCents);
  if (pastMonthsSpentCents.length === 0) return 0;
  const avg = pastMonthsSpentCents.reduce((a, b) => a + b, 0) / pastMonthsSpentCents.length;
  return Math.ceil(avg / stepCents) * stepCents;
}

/** Taxa de poupança do período: (receitas − despesas) ÷ receitas. Transferências não entram. */
export function savingsRate(incomeCents: Cents, expenseCents: Cents): number {
  assertCents(incomeCents);
  assertCents(expenseCents);
  if (incomeCents <= 0) return 0;
  return (incomeCents - expenseCents) / incomeCents;
}
