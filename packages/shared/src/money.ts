/**
 * Dinheiro no VryGraphic é SEMPRE um inteiro em centavos.
 * Nada de float para valor monetário: 0.1 + 0.2 !== 0.3 em ponto flutuante.
 */

export type Cents = number;

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const PLAIN = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 123456 → "R$ 1.234,56" (negativos com sinal de menos tipográfico: "− R$ 10,00"). */
export function formatBRL(cents: Cents): string {
  assertCents(cents);
  const s = BRL.format(Math.abs(cents) / 100).replace(/ /g, ' ');
  return cents < 0 ? `− ${s}` : s;
}

/** 123456 → "1.234,56" (sem símbolo, usado nas tabelas do Terminal). */
export function formatPlain(cents: Cents): string {
  assertCents(cents);
  const s = PLAIN.format(Math.abs(cents) / 100);
  return cents < 0 ? `−${s}` : s;
}

/**
 * Converte texto digitado em centavos. Aceita os formatos que uma pessoa
 * no Brasil digita: "1.234,56", "1234,56", "1234.56", "120", "0,5", "R$ 12".
 * Regra do ponto: "1.200" é milhar (mil e duzentos), "12.50" é decimal.
 * Retorna null quando não é um valor.
 */
export function parseBRL(input: string): Cents | null {
  const t = input.trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
  if (!t) return null;
  // com vírgula decimal: pontos são separadores de milhar
  if (/^\d{1,3}(\.\d{3})*,\d{1,2}$|^\d+,\d{1,2}$/.test(t)) {
    const [int, dec] = t.replace(/\./g, '').split(',');
    return toCents(int, dec);
  }
  // só pontos de milhar: 1.200 / 12.345.678
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return toCents(t.replace(/\./g, ''), '');
  // ponto decimal com 1 ou 2 casas: 12.5 / 12.50
  if (/^\d+\.\d{1,2}$/.test(t)) {
    const [int, dec] = t.split('.');
    return toCents(int, dec);
  }
  if (/^\d+$/.test(t)) return toCents(t, '');
  return null;
}

function toCents(int: string, dec: string): Cents {
  const d = (dec + '00').slice(0, 2);
  return Number(int) * 100 + Number(d);
}

export function assertCents(v: number): void {
  if (!Number.isSafeInteger(v)) throw new TypeError(`valor em centavos inválido: ${v}`);
}

/** Soma em centavos com checagem de inteiro seguro. */
export function sumCents(values: Cents[]): Cents {
  return values.reduce((acc, v) => {
    assertCents(v);
    return acc + v;
  }, 0);
}

/** Percentual com 1 casa no padrão brasileiro: 0.336 → "33,6%". */
export function formatPct(ratio: number): string {
  return `${(ratio * 100).toFixed(1).replace('.', ',')}%`;
}
