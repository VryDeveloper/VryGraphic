import { describe, expect, it } from 'vitest';
import { parseCommand } from '../src/command';
import { demoCommandContext } from '../src/demo';

const ctx = demoCommandContext('2026-10-31');
const p = (t: string) => parseCommand(t, ctx);

describe('barra de comando', () => {
  it('mercado 120,50 alimentação', () => {
    const r = p('mercado 120,50 alimentação');
    expect(r).toMatchObject({ ok: true, kind: 'EXPENSE', description: 'Mercado', amountCents: 12050, categoryName: 'Alimentação', accountName: 'Cartão Nubank', date: '2026-10-31', installments: 1 });
  });

  it('notebook 2.400 tecnologia 7x', () => {
    const r = p('notebook 2.400 tecnologia 7x');
    expect(r).toMatchObject({ ok: true, amountCents: 240000, installments: 7, categoryName: 'Tecnologia' });
  });

  it('+freela 640,50 trabalho inter', () => {
    const r = p('+freela 640,50 trabalho inter');
    expect(r).toMatchObject({ ok: true, kind: 'INCOME', description: 'Freela', amountCents: 64050, categoryName: 'Trabalho', accountName: 'Conta Inter' });
  });

  it('uber 23 transp ontem: prefixo de categoria e data relativa', () => {
    const r = p('uber 23 transp ontem');
    expect(r).toMatchObject({ ok: true, amountCents: 2300, categoryName: 'Transporte', date: '2026-10-30' });
  });

  it('data dd/mm', () => {
    expect(p('farmácia 112,30 saúde 15/10').date).toBe('2026-10-15');
  });

  it('dd/mm no futuro é do ano anterior', () => {
    expect(p('presente 200 lazer 20/12').date).toBe('2025-12-20');
  });

  it('data impossível é recusada', () => {
    expect(p('teste 10 31/02').issues).toContain('INVALID_DATE');
  });

  it('12x sozinho: falta valor e descrição', () => {
    const r = p('12x');
    expect(r.ok).toBe(false);
    expect(r.issues).toEqual(['MISSING_AMOUNT', 'MISSING_DESCRIPTION']);
  });

  it('25x passa do limite', () => {
    expect(p('tv 3000 25x').issues).toContain('TOO_MANY_INSTALLMENTS');
  });

  it('"sa" não basta para escolher Saúde: vira descrição e usa Outros', () => {
    const r = p('remédio 30 sa');
    expect(r.categoryName).toBe('Outros');
    expect(r.categoryGuessed).toBe(true);
    expect(r.description).toBe('Remédio sa');
  });

  it('categoria de receita sem "+" vira receita', () => {
    const r = p('salário 7.850 trabalho');
    expect(r.kind).toBe('INCOME');
    expect(r.accountName).toBe('Conta Nubank');
  });

  it('a ordem dos tokens não importa', () => {
    const a = p('alimentação 120,50 mercado');
    expect(a).toMatchObject({ description: 'Mercado', amountCents: 12050, categoryName: 'Alimentação' });
  });

  it('só o primeiro número é o valor; os outros entram na descrição', () => {
    const r = p('pizza 2 sabores 89,90 alimentação');
    expect(r.amountCents).toBe(200);
    expect(r.description).toBe('Pizza sabores 89,90');
  });

  it('valor zero é tratado como ausente', () => {
    expect(p('nada 0 outros').issues).toContain('MISSING_AMOUNT');
  });
});
