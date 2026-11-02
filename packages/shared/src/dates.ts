/**
 * Datas do VryGraphic. O usuário pensa em dias ("2026-10-31"), o banco guarda instantes (timestamptz).
 * Regra: um dia vira 12:00 em São Paulo, longe da meia-noite, então nunca "pula" de dia ao converter.
 * São Paulo não tem horário de verão desde 2019, então o fuso é fixo em −03:00.
 */
export const TZ = 'America/Sao_Paulo';
const OFFSET = '-03:00';

export const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const ISO_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** "2026-10-31" → instante às 12:00 de São Paulo. */
export function dateToInstant(date: string): Date {
  return new Date(`${date}T12:00:00${OFFSET}`);
}

/** Instante → "AAAA-MM-DD" no fuso de São Paulo. */
export function instantToDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
}

/** Hoje em São Paulo, "AAAA-MM-DD". */
export function todayISO(now = new Date()): string {
  return instantToDate(now);
}

/** Mês seguinte de "AAAA-MM". */
function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** Intervalo [início, fim) de um mês em São Paulo, para filtros `gte`/`lt`. */
export function monthRange(month: string): { gte: Date; lt: Date } {
  return { gte: new Date(`${month}-01T00:00:00${OFFSET}`), lt: new Date(`${nextMonth(month)}-01T00:00:00${OFFSET}`) };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Soma N meses a uma data, prendendo o dia no fim do mês: 31/01 + 1 mês = 28/02 (ou 29). */
export function addMonthsToDate(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  const yy = Math.floor(idx / 12);
  const mm = (idx % 12) + 1;
  const dd = Math.min(d, daysInMonth(yy, mm));
  return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/** Dia N de um mês "AAAA-MM", preso ao último dia (dia 31 em fevereiro vira 28/29). */
export function dayOfMonth(month: string, day: number): string {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(Math.min(day, daysInMonth(y, m))).padStart(2, '0')}`;
}
