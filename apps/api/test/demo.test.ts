import { describe, expect, it } from 'vitest';
import { generateDemo } from '../src/modules/demo/generate';

describe('gerador do demo', () => {
  const ops = generateDemo('2026-10-31');

  it('é determinístico: mesma data, mesmos lançamentos', () => {
    expect(generateDemo('2026-10-31')).toEqual(ops);
  });

  it('cobre 12 meses, em ordem, sem nada depois de hoje', () => {
    const months = new Set(ops.map((o) => o.date.slice(0, 7)));
    expect([...months][0]).toBe('2025-11');
    expect(months.size).toBe(12);
    expect(ops.every((o) => o.date <= '2026-10-31')).toBe(true);
    expect(ops.map((o) => o.date)).toEqual([...ops.map((o) => o.date)].sort());
  });

  it('todo mês tem salário, aluguel e aporte; valores são centavos inteiros positivos', () => {
    for (const m of new Set(ops.map((o) => o.date.slice(0, 7)))) {
      const inMonth = ops.filter((o) => o.date.startsWith(m));
      expect(inMonth.some((o) => o.type === 'tx' && o.description === 'Salário')).toBe(true);
      expect(inMonth.some((o) => o.type === 'tx' && o.description === 'Aluguel')).toBe(true);
      expect(inMonth.some((o) => o.type === 'transfer')).toBe(true);
    }
    expect(ops.every((o) => Number.isInteger(o.amountCents) && o.amountCents > 0)).toBe(true);
  });

  it('o demo gasta menos do que ganha (taxa de poupança realista)', () => {
    const sum = (k: string) => ops.reduce((s, o) => s + (o.type === 'tx' && o.kind === k ? o.amountCents : 0), 0);
    const rate = (sum('INCOME') - sum('EXPENSE')) / sum('INCOME');
    expect(rate).toBeGreaterThan(0.1);
    expect(rate).toBeLessThan(0.45);
  });
});
