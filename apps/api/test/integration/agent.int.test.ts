import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setModelClient, type ModelBlock, type ModelRequest } from '../../src/modules/agent/model';
import { _clearSessions } from '../../src/modules/agent/service';
import { hasDb, newUser, prisma, resetDb, type TestUser } from './helpers';

/** Modelo simulado: devolve as respostas do roteiro em ordem e guarda o que recebeu. */
function script(...turns: ModelBlock[][]) {
  const seen: ModelRequest[] = [];
  let i = 0;
  setModelClient({
    async create(req) {
      seen.push(JSON.parse(JSON.stringify(req)));
      const content = turns[Math.min(i++, turns.length - 1)];
      return { content, stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn' };
    },
  });
  return seen;
}
const use = (id: string, name: string, input: unknown): ModelBlock => ({ type: 'tool_use', id, name, input });
const say = (text: string): ModelBlock => ({ type: 'text', text });
type Res = { sessionId: string; waiting: boolean; events: { type: string; name?: string; ok?: boolean; summary?: string; preview?: string; text?: string }[] };

describe.skipIf(!hasDb)('Vry Agent', () => {
  let u: TestUser;
  let other: TestUser;
  beforeAll(async () => {
    await resetDb();
    u = await newUser('Agente');
    other = await newUser('Outra pessoa');
    await u.api.post('/transactions', { kind: 'EXPENSE', description: 'Mercado', amountCents: 12050, accountId: u.conta, categoryId: u.cat('Alimentação'), date: '2026-10-05' });
    await other.api.post('/transactions', { kind: 'EXPENSE', description: 'Segredo da outra', amountCents: 99900, accountId: other.conta, categoryId: other.cat('Lazer'), date: '2026-10-05' });
  });
  afterEach(() => {
    setModelClient(null);
    _clearSessions();
  });

  it('sem chave da API o agente fica desligado e diz como configurar', async () => {
    const s = await u.api.get('/agent/status');
    expect(s.body.agent).toMatchObject({ enabled: false, branding: 'Vry Agent · Powered by Claude' });
    const r = await u.api.post('/agent/messages', { text: 'oi' });
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('AGENT_DISABLED');
  });

  it('ferramenta de leitura roda sozinha e só enxerga os dados de quem perguntou', async () => {
    const seen = script([say('Vou olhar.'), use('t1', 'listar_lancamentos', { mes: '2026-10' })], [say('Você gastou 120,50 no mercado.')]);
    const r = (await u.api.post('/agent/messages', { text: 'quanto gastei em outubro?' })).body as Res;
    expect(r.waiting).toBe(false);
    expect(r.events.map((e) => e.type)).toEqual(['text', 'tool', 'text']);
    expect(r.events[1]).toMatchObject({ name: 'listar_lancamentos', ok: true, summary: '1 de 1 lançamentos' });
    // o que voltou para o modelo: só o lançamento desta pessoa
    const toolResult = JSON.stringify(seen[1].messages.at(-1));
    expect(toolResult).toContain('Mercado');
    expect(toolResult).not.toContain('Segredo da outra');
    expect(seen[0].tools.map((t) => t.name)).toContain('lancar');
    expect(seen[0].system).toContain('Vry Agent');
  });

  it('escrita para no [s/n] com a prévia; confirmar grava com origem AGENT', async () => {
    script([use('w1', 'lancar', { comando: 'padaria 18,90 alimentação ontem' })], [say('Lançado.')]);
    const first = (await u.api.post('/agent/messages', { text: 'lança padaria 18,90 ontem' })).body as Res;
    expect(first.waiting).toBe(true);
    expect(first.events.at(-1)).toMatchObject({ type: 'approval', name: 'lancar' });
    expect(first.events.at(-1)!.preview).toMatch(/^lançar despesa: Padaria · 18,90 · Alimentação · Cartão de crédito · \d{2}\/\d{2}\/\d{4}$/);
    expect(await prisma.transaction.count({ where: { userId: u.id, description: 'Padaria' } })).toBe(0);

    // enquanto espera, outra mensagem é recusada
    expect((await u.api.post('/agent/messages', { text: 'e aí?', sessionId: first.sessionId })).status).toBe(409);

    const done = (await u.api.post(`/agent/sessions/${first.sessionId}/decision`, { approve: true })).body as Res;
    expect(done.events.map((e) => e.type)).toEqual(['tool', 'text']);
    expect(done.events[0]).toMatchObject({ ok: true, summary: '1 lançamento(s) gravado(s)' });
    const saved = await prisma.transaction.findFirst({ where: { userId: u.id, description: 'Padaria' } });
    expect(saved).toMatchObject({ source: 'AGENT', amountCents: -1890n });
  });

  it('recusar não grava nada e avisa o modelo', async () => {
    const seen = script([use('w2', 'definir_orcamento', { categoria: 'lazer', limite: '300,00', mes: '2026-10' })], [say('Ok, não mexi.')]);
    const first = (await u.api.post('/agent/messages', { text: 'põe 300 de limite em lazer' })).body as Res;
    expect(first.events.at(-1)!.preview).toBe('orçamento de Lazer em out/26: 300,00');
    const r = (await u.api.post(`/agent/sessions/${first.sessionId}/decision`, { approve: false })).body as Res;
    expect(r.events[0]).toMatchObject({ type: 'tool', ok: false, summary: 'recusado' });
    expect(await prisma.budget.count({ where: { userId: u.id } })).toBe(0);
    expect(JSON.stringify(seen[1].messages.at(-1))).toContain('A pessoa recusou');
  });

  it('entrada errada volta para o modelo corrigir, sem pedir confirmação', async () => {
    const seen = script(
      [use('w3', 'transferir', { de: 'conta', para: 'poupança inexistente', valor: '100' })],
      [use('r1', 'listar_lancamentos', { limite: 500 })],
      [say('Não achei essa conta.')],
    );
    const r = (await u.api.post('/agent/messages', { text: 'transfere 100 pra poupança' })).body as Res;
    expect(r.waiting).toBe(false);
    expect(r.events[0]).toMatchObject({ type: 'tool', ok: false });
    expect(r.events[0].summary).toContain('não existe');
    expect(r.events[1]).toMatchObject({ type: 'tool', ok: false });
    expect(r.events[1].summary).toContain('entrada inválida');
    expect(JSON.stringify(seen[1].messages.at(-1))).toContain('"is_error":true');
  });

  it('não exclui lançamento de outra pessoa nem com o id certo', async () => {
    const theirs = await prisma.transaction.findFirst({ where: { userId: other.id } });
    script([use('w4', 'excluir_lancamento', { id: theirs!.id })], [say('Não encontrei.')]);
    const r = (await u.api.post('/agent/messages', { text: `apaga ${theirs!.id}` })).body as Res;
    expect(r.waiting).toBe(false);
    expect(r.events[0]).toMatchObject({ ok: false, summary: 'lançamento não encontrado' });
    expect(await prisma.transaction.count({ where: { id: theirs!.id, deletedAt: null } })).toBe(1);
  });

  it('para depois de muitos passos e deixa o histórico consistente', async () => {
    const seen = script([use('loop', 'listar_contas', {})]);
    const r = (await u.api.post('/agent/messages', { text: 'em loop' })).body as Res;
    expect(seen).toHaveLength(8); // no máximo 8 chamadas ao modelo por mensagem
    expect(r.events.filter((e) => e.type === 'tool')).toHaveLength(8);
    expect(r.events.at(-1)!.text).toContain('muitos passos');
    // a conversa continua válida: cada tool_use tem seu tool_result
    script([say('ok')]);
    expect((await u.api.post('/agent/messages', { text: 'e agora?', sessionId: r.sessionId })).status).toBe(200);
  });

  it('sessão de uma pessoa não serve para outra', async () => {
    script([say('oi')]);
    const r = (await u.api.post('/agent/messages', { text: 'oi' })).body as Res;
    expect((await other.api.post('/agent/messages', { text: 'oi', sessionId: r.sessionId })).status).toBe(404);
  });
});
