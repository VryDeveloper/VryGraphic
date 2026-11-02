import { addMonths, dayOfMonth, daysInMonth } from '@vrygraphic/shared';

/**
 * Gerador dos 12 meses do modo demonstração. Função pura e determinística:
 * a mesma data de "hoje" gera sempre os mesmos lançamentos (semente fixa), então
 * os testes conseguem conferir os números e o demo não muda a cada reinício.
 */

export type DemoAccountKey = 'nubank' | 'inter' | 'cartao' | 'reserva';

export type DemoOp =
  | {
      type: 'tx';
      kind: 'INCOME' | 'EXPENSE';
      description: string;
      amountCents: number;
      account: DemoAccountKey;
      category: string;
      date: string;
      installments?: number;
      recurrence?: string;
    }
  | { type: 'transfer'; from: DemoAccountKey; to: DemoAccountKey; amountCents: number; date: string; description: string };

/** Contas fixas que viram "recorrências" (e aparecem nos vencimentos do mês seguinte). */
export const DEMO_RECURRENCES = [
  { key: 'aluguel', description: 'Aluguel', amountCents: 185000, day: 6, account: 'nubank', category: 'Moradia' },
  { key: 'luz', description: 'Luz', amountCents: 21467, day: 10, account: 'nubank', category: 'Moradia' },
  { key: 'internet', description: 'Internet', amountCents: 9990, day: 15, account: 'nubank', category: 'Moradia' },
  { key: 'academia', description: 'Academia', amountCents: 11990, day: 2, account: 'cartao', category: 'Saúde' },
  { key: 'streaming', description: 'Streaming', amountCents: 5590, day: 15, account: 'cartao', category: 'Lazer' },
] as const;

/** Saldo de abertura de cada conta, 12 meses atrás. */
export const DEMO_OPENING: Record<DemoAccountKey, number> = { nubank: 180000, inter: 45000, cartao: 0, reserva: 250000 };

/** mulberry32: gerador pseudoaleatório pequeno, rápido e determinístico. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateDemo(today: string): DemoOp[] {
  const rnd = prng(20261031);
  const between = (min: number, max: number) => Math.round(min + rnd() * (max - min));
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
  const ops: DemoOp[] = [];
  const add = (op: DemoOp) => {
    if (op.date <= today) ops.push(op);
  };

  const thisMonth = today.slice(0, 7);
  const first = addMonths(thisMonth, -11);

  for (let m = 0; m < 12; m++) {
    const month = addMonths(first, m);
    const [y, mm] = month.split('-').map(Number);
    const day = (d: number) => dayOfMonth(month, d);

    // receitas: salário com reajuste no 7º mês, 13º em dezembro, freelas de vez em quando
    add({ type: 'tx', kind: 'INCOME', description: 'Salário', amountCents: m < 6 ? 750000 : 785000, account: 'nubank', category: 'Trabalho', date: day(5) });
    if (mm === 12) add({ type: 'tx', kind: 'INCOME', description: 'Décimo terceiro', amountCents: 392500, account: 'nubank', category: 'Trabalho', date: day(18) });
    if ([1, 4, 7, 9].includes(m)) add({ type: 'tx', kind: 'INCOME', description: 'Freela', amountCents: between(40000, 95000), account: 'inter', category: 'Trabalho', date: day(between(12, 24)) });
    if (m === 11) add({ type: 'tx', kind: 'INCOME', description: 'Freela landing page', amountCents: 64050, account: 'inter', category: 'Trabalho', date: day(27) });

    // contas fixas
    for (const r of DEMO_RECURRENCES) {
      const amount = r.key === 'luz' ? between(15500, 26500) : r.amountCents;
      add({ type: 'tx', kind: 'EXPENSE', description: r.description, amountCents: amount, account: r.account, category: r.category, date: day(r.day), recurrence: r.key });
    }

    // guardar dinheiro: aporte mensal na reserva, maior no mês do 13º
    add({ type: 'transfer', from: 'nubank', to: 'reserva', amountCents: mm === 12 ? 250000 : 80000, date: day(7), description: 'Aporte na reserva' });

    // gastos do dia a dia: fim de semana pesa mais
    for (let d = 1; d <= daysInMonth(y, mm); d++) {
      const date = day(d);
      const dow = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = domingo
      const weekend = dow === 0 || dow === 6;
      if (dow === 6) add({ type: 'tx', kind: 'EXPENSE', description: pick(['Mercado', 'Atacarejo', 'Supermercado']), amountCents: between(19000, 41000), account: 'cartao', category: 'Alimentação', date });
      if (dow === 3 && rnd() < 0.6) add({ type: 'tx', kind: 'EXPENSE', description: 'Hortifruti', amountCents: between(3500, 8500), account: 'cartao', category: 'Alimentação', date });
      if (rnd() < (weekend ? 0.55 : 0.16)) add({ type: 'tx', kind: 'EXPENSE', description: pick(['iFood', 'Restaurante', 'Lanche']), amountCents: between(2800, 9500), account: 'cartao', category: 'Alimentação', date });
      if (rnd() < 0.22) add({ type: 'tx', kind: 'EXPENSE', description: 'Padaria', amountCents: between(900, 2600), account: 'nubank', category: 'Alimentação', date });
      if (!weekend && rnd() < 0.3) add({ type: 'tx', kind: 'EXPENSE', description: pick(['Uber', '99']), amountCents: between(1400, 4300), account: 'cartao', category: 'Transporte', date });
      if (weekend && rnd() < 0.35) add({ type: 'tx', kind: 'EXPENSE', description: pick(['Cinema', 'Bar', 'Show', 'Passeio']), amountCents: between(4000, 16000), account: 'cartao', category: 'Lazer', date });
      if (rnd() < 0.045) add({ type: 'tx', kind: 'EXPENSE', description: 'Farmácia', amountCents: between(3800, 12500), account: 'inter', category: 'Saúde', date });
      if (rnd() < 0.04) add({ type: 'tx', kind: 'EXPENSE', description: pick(['Presente', 'Papelaria', 'Barbearia']), amountCents: between(2500, 14000), account: 'cartao', category: 'Outros', date });
    }
  }

  // compras parceladas (datas relativas a hoje para o demo sempre ter parcelas em aberto)
  const rel = (monthsAgo: number, d: number) => dayOfMonth(addMonths(thisMonth, -monthsAgo), d);
  add({ type: 'tx', kind: 'EXPENSE', description: 'Presentes de Natal', amountCents: 90000, account: 'cartao', category: 'Outros', date: rel(10, 14), installments: 3 });
  add({ type: 'tx', kind: 'EXPENSE', description: 'Fone bluetooth', amountCents: 53940, account: 'cartao', category: 'Tecnologia', date: rel(3, 20), installments: 6 });
  add({ type: 'tx', kind: 'EXPENSE', description: 'Passagens', amountCents: 180000, account: 'cartao', category: 'Lazer', date: rel(3, 9), installments: 6 });
  add({ type: 'tx', kind: 'EXPENSE', description: 'Notebook', amountCents: 240000, account: 'cartao', category: 'Tecnologia', date: rel(1, 14), installments: 7 });

  return ops.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Orçamentos do demo (mês atual e anterior): uns folgados, outros estourando, para os alertas terem o que dizer. */
export const DEMO_BUDGETS = [
  { category: 'Moradia', limitCents: 230000 },
  { category: 'Alimentação', limitCents: 195000 },
  { category: 'Transporte', limitCents: 30000 },
  { category: 'Lazer', limitCents: 50000 },
  { category: 'Tecnologia', limitCents: 40000 },
  { category: 'Saúde', limitCents: 30000 },
  { category: 'Outros', limitCents: 15000 },
] as const;

export const DEMO_GOALS = [
  { name: 'Reserva de emergência', account: 'reserva', targetCents: 2000000, monthlyContributionCents: 80000, monthlyRateBps: 85 },
] as const;
