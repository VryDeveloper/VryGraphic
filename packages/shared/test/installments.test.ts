import { describe, expect, it } from 'vitest';
import { addMonths, installmentSchedule, invoiceMonthFor, splitInstallments } from '../src/installments';

describe('parcelamento', () => {
  it('R$ 2.400 em 7x: o resto de 5 centavos vai para a 1ª parcela', () => {
    const p = splitInstallments(240000, 7);
    expect(p[0]).toBe(34290);
    expect(p.slice(1)).toEqual(Array(6).fill(34285));
    expect(p.reduce((a, b) => a + b, 0)).toBe(240000);
  });

  it('a soma sempre bate com o total, para qualquer valor e número de parcelas', () => {
    for (let total = 1; total < 5000; total += 37) {
      for (let n = 1; n <= 24; n++) {
        expect(splitInstallments(total, n).reduce((a, b) => a + b, 0)).toBe(total);
      }
    }
  });

  it('mantém o sinal de despesa', () => {
    expect(splitInstallments(-1000, 3)).toEqual([-334, -333, -333]);
  });

  it('recusa 0 ou mais de 24 parcelas', () => {
    expect(() => splitInstallments(1000, 0)).toThrow();
    expect(() => splitInstallments(1000, 25)).toThrow();
  });

  it('agenda as faturas virando o ano', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    const s = installmentSchedule(240000, 7, '2026-12');
    expect(s.map((i) => i.invoiceMonth)).toEqual(['2026-12', '2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06']);
  });

  it('compra depois do fechamento cai na fatura seguinte', () => {
    expect(invoiceMonthFor('2026-10-03', 5)).toBe('2026-10');
    expect(invoiceMonthFor('2026-10-05', 5)).toBe('2026-10');
    expect(invoiceMonthFor('2026-10-06', 5)).toBe('2026-11');
    expect(invoiceMonthFor('2026-12-20', 5)).toBe('2027-01');
  });
});
