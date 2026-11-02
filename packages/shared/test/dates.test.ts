import { describe, expect, it } from 'vitest';
import { addMonthsToDate, dateToInstant, dayOfMonth, instantToDate, monthRange } from '../src/dates';
import { buildCommandContext } from '../src/context';
import { parseCommand } from '../src/command';

describe('datas em São Paulo', () => {
  it('ida e volta de um dia não muda a data', () => {
    for (const d of ['2026-01-01', '2026-02-28', '2026-10-31', '2026-12-31']) expect(instantToDate(dateToInstant(d))).toBe(d);
  });

  it('mês vai da meia-noite de SP até a meia-noite do mês seguinte', () => {
    const r = monthRange('2026-12');
    expect(r.gte.toISOString()).toBe('2026-12-01T03:00:00.000Z');
    expect(r.lt.toISOString()).toBe('2027-01-01T03:00:00.000Z');
  });

  it('somar meses prende o dia no fim do mês', () => {
    expect(addMonthsToDate('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsToDate('2027-12-31', 2)).toBe('2028-02-29');
    expect(addMonthsToDate('2026-11-15', 3)).toBe('2027-02-15');
    expect(dayOfMonth('2026-02', 31)).toBe('2026-02-28');
  });
});

describe('contexto do comando a partir das contas do usuário', () => {
  const ctx = buildCommandContext({
    today: '2026-10-31',
    accounts: [
      { id: 'c1', name: 'Conta corrente', kind: 'CHECKING', aliases: ['conta'] },
      { id: 'k1', name: 'Cartão', kind: 'CREDIT_CARD', aliases: ['Cartão'] },
    ],
    categories: [
      { id: 'a', name: 'Alimentação', kind: 'EXPENSE' },
      { id: 'o', name: 'Outros', kind: 'EXPENSE' },
      { id: 't', name: 'Trabalho', kind: 'INCOME' },
    ],
  });

  it('despesa cai no cartão e receita na conta corrente', () => {
    expect(parseCommand('mercado 50 alim', ctx).accountId).toBe('k1');
    expect(parseCommand('+freela 50 trab', ctx).accountId).toBe('c1');
  });

  it('apelido é normalizado (sem acento, minúsculo)', () => {
    expect(parseCommand('pão 8 cartao', ctx).accountId).toBe('k1');
  });

  it('sem nenhuma conta o comando acusa o problema', () => {
    const p = parseCommand('pão 8', buildCommandContext({ today: '2026-10-31', accounts: [], categories: [] }));
    expect(p.ok).toBe(false);
    expect(p.issues).toContain('MISSING_ACCOUNT');
  });

  it('com uma conta só, ela é padrão de tudo', () => {
    const one = buildCommandContext({ today: '2026-10-31', accounts: [{ id: 'x', name: 'Carteira', kind: 'CASH', aliases: [] }], categories: [] });
    expect(parseCommand('pão 8', one).accountId).toBe('x');
    expect(parseCommand('+pix 8', one).accountId).toBe('x');
  });
});
