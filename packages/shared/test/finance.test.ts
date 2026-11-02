import { describe, expect, it } from 'vitest';
import { meanAndSampleStd, projectNetWorth, savingsRate, simulateGoal, suggestBudget } from '../src/finance';

// Patrimônio de nov/25 a out/26 do modo demo, em centavos
const HISTORY = [980000, 1045000, 990000, 1120000, 1210000, 1180000, 1305000, 1420000, 1390000, 1560000, 1710000, 1845290];

describe('meta com juros compostos', () => {
  it('reserva de emergência: R$ 6.400 → R$ 10.000 com R$ 750/mês a 0,85% a.m. leva 5 meses', () => {
    const s = simulateGoal({ currentCents: 640000, targetCents: 1000000, monthlyContributionCents: 75000, monthlyRateBps: 85 });
    expect(s.reached).toBe(true);
    expect(s.months).toBe(5);
    expect(s.depositedCents).toBe(375000);
    expect(s.finalBalanceCents).toBe(640000 + s.depositedCents + s.interestCents);
    expect(s.interestCents).toBeGreaterThan(0);
  });

  it('sem rendimento leva mais tempo que com rendimento', () => {
    const base = { currentCents: 135000, targetCents: 300000, monthlyContributionCents: 18333 };
    const sem = simulateGoal({ ...base, monthlyRateBps: 0 });
    const com = simulateGoal({ ...base, monthlyRateBps: 85 });
    expect(sem.months).toBe(10);
    expect(com.months).toBe(9);
  });

  it('meta já atingida devolve 0 meses', () => {
    expect(simulateGoal({ currentCents: 240000, targetCents: 240000, monthlyContributionCents: 0, monthlyRateBps: 85 }).months).toBe(0);
  });

  it('sem aporte e sem juros não entra em laço infinito', () => {
    const s = simulateGoal({ currentCents: 100, targetCents: 1000, monthlyContributionCents: 0, monthlyRateBps: 0 });
    expect(s.reached).toBe(false);
    expect(s.months).toBe(0);
  });
});

describe('projeção do patrimônio', () => {
  it('usa média e desvio-padrão amostral das variações dos últimos 6 meses', () => {
    const { mean } = meanAndSampleStd([125000, 115000, -30000, 170000, 150000, 135290]);
    expect(Math.round(mean)).toBe(110882);
    const [nov, dez] = projectNetWorth(HISTORY, 2);
    expect(dez.expectedCents).toBe(Math.round(1845290 + 2 * mean));
    expect(dez.expectedCents).toBe(2067053); // R$ 20.670,53, o mesmo valor das telas
    expect(nov.lowCents).toBeLessThan(nov.expectedCents);
    expect(dez.highCents - dez.expectedCents).toBeGreaterThan(nov.highCents - nov.expectedCents);
  });
});

describe('orçamento e poupança', () => {
  it('sugere a média de 3 meses arredondada para cima em R$ 50', () => {
    expect(suggestBudget([84000, 86000, 112000])).toBe(95000);
    expect(suggestBudget([185000, 185000, 185000])).toBe(185000);
    expect(suggestBudget([])).toBe(0);
  });

  it('taxa de poupança de outubro: 33,6%', () => {
    expect(savingsRate(785000, 521237)).toBeCloseTo(0.336, 3);
    expect(savingsRate(0, 100)).toBe(0);
  });
});
