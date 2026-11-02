const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** "2026-11" → "nov/26" */
export const fmtMonth = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
/** "2026-11" → "novembro 2026" */
export const fmtMonthLong = (m: string) => `${MESES_LONGOS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
/** "2026-11" → "NOV" */
export const fmtMonthTag = (m: string) => MESES[Number(m.slice(5, 7)) - 1].toUpperCase();
/** "2026-11-05" → "05/11" */
export const fmtDay = (d: string) => `${d.slice(8)}/${d.slice(5, 7)}`;
/** 0.336 → "33,6%" */
export const pct = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')}%`;
