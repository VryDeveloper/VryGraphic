import { describe, expect, it } from 'vitest';
import { formatBRL, formatPct, formatPlain, parseBRL, sumCents } from '../src/money';

describe('parseBRL', () => {
  it.each([
    ['120', 12000],
    ['120,50', 12050],
    ['1.234,56', 123456],
    ['1234,56', 123456],
    ['12.50', 1250],
    ['0,5', 50],
    ['R$ 7.850,00', 785000],
  ])('"%s" → %i centavos', (input, cents) => {
    expect(parseBRL(input)).toBe(cents);
  });

  it('"1.200" é milhar, não decimal', () => {
    expect(parseBRL('1.200')).toBe(120000);
  });

  it('rejeita o que não é valor', () => {
    expect(parseBRL('mercado')).toBeNull();
    expect(parseBRL('12,345')).toBeNull();
    expect(parseBRL('')).toBeNull();
  });
});

describe('formatação', () => {
  it('formata em reais com sinal tipográfico', () => {
    expect(formatBRL(123456)).toBe('R$ 1.234,56');
    expect(formatBRL(-2375)).toBe('− R$ 23,75');
    expect(formatPlain(1845290)).toBe('18.452,90');
    expect(formatPct(0.336)).toBe('33,6%');
  });

  it('soma em centavos sem erro de ponto flutuante', () => {
    // 0,10 + 0,20 em float daria 0.30000000000000004
    expect(sumCents([10, 20])).toBe(30);
    expect(() => sumCents([10.5])).toThrow();
  });
});
