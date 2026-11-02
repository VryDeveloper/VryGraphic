import { assertCents, type Cents } from './money';

export interface Installment {
  number: number; // 1..count
  amountCents: Cents;
  /** Mês da fatura no formato "AAAA-MM". */
  invoiceMonth: string;
}

/**
 * Divide um total em N parcelas inteiras em centavos.
 * O resto da divisão vai para a 1ª parcela, então a soma bate ao centavo.
 * Ex.: 240000 em 7 → [34290, 34285 × 6].
 */
export function splitInstallments(totalCents: Cents, count: number): Cents[] {
  assertCents(totalCents);
  if (!Number.isInteger(count) || count < 1 || count > 24) {
    throw new RangeError('parcelas devem ser de 1 a 24');
  }
  const sign = totalCents < 0 ? -1 : 1;
  const abs = Math.abs(totalCents);
  const base = Math.floor(abs / count);
  const rest = abs - base * count;
  return Array.from({ length: count }, (_, i) => sign * (i === 0 ? base + rest : base));
}

/** Soma N meses a "AAAA-MM". */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  const yy = Math.floor(idx / 12);
  const mm = (idx % 12) + 1;
  return `${yy}-${String(mm).padStart(2, '0')}`;
}

/** Parcelas com o mês de cada fatura, a partir da primeira fatura. */
export function installmentSchedule(totalCents: Cents, count: number, firstInvoiceMonth: string): Installment[] {
  return splitInstallments(totalCents, count).map((amountCents, i) => ({
    number: i + 1,
    amountCents,
    invoiceMonth: addMonths(firstInvoiceMonth, i),
  }));
}

/**
 * Em qual fatura cai uma compra no cartão.
 * Compras até o dia de fechamento entram na fatura do próprio mês de fechamento;
 * depois dele, na do mês seguinte. A fatura "AAAA-MM" é a que FECHA naquele mês.
 */
export function invoiceMonthFor(purchaseISODate: string, closingDay: number): string {
  const [y, m, d] = purchaseISODate.slice(0, 10).split('-').map(Number);
  const month = `${y}-${String(m).padStart(2, '0')}`;
  return d <= closingDay ? month : addMonths(month, 1);
}
