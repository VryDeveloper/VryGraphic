import { randomUUID } from 'node:crypto';
import { todayISO } from '@vrygraphic/shared';
import { AppError } from '../../lib/errors';
import { env } from '../../config/env';
import { modelClient, type ModelBlock } from './model';
import { TOOL_BY_NAME, TOOLS, ToolInputError } from './tools';

/**
 * Vry Agent: loop da API de mensagens com ferramentas próprias.
 *
 *   pessoa → modelo → (ferramenta de leitura roda sozinha) → modelo → ... → resposta
 *                   → (ferramenta de escrita) → PAUSA: prévia + [s/n] → executa ou recusa → modelo → ...
 *
 * O modelo nunca toca no banco: ele só pede ferramentas, e cada ferramenta chama os mesmos serviços
 * da API, sempre com o id do usuário logado. Não há ferramenta de arquivo, shell ou rede.
 */

export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; ok: boolean; summary: string }
  | { type: 'approval'; name: string; preview: string };

interface Pending { id: string; name: string; input: unknown; preview: string }
interface Session {
  id: string;
  userId: string;
  messages: { role: 'user' | 'assistant'; content: unknown }[];
  queue: ModelBlock[]; // tool_use ainda não resolvidos da última resposta
  results: { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }[];
  decisions: Map<string, boolean>;
  pending: Pending | null;
  busy: boolean;
  touchedAt: number;
}

const MAX_STEPS = 8; // chamadas ao modelo por mensagem da pessoa
const MAX_MESSAGES = 40;
const SESSION_TTL = 30 * 60 * 1000;
const sessions = new Map<string, Session>();

function systemPrompt() {
  return `Você é o Vry Agent, o assistente financeiro dentro do VryGraphic, um app de controle financeiro pessoal com visual de terminal.
Hoje é ${todayISO()} (fuso de São Paulo). Responda sempre em português do Brasil, curto e direto, como num terminal: frases curtas, listas com "-" quando ajudar, sem tabelas e sem markdown pesado.
Valores em reais no formato 1.234,56.

Regras:
- Use as ferramentas para qualquer número. Nunca invente valores, datas ou lançamentos.
- Para gravar algo (lançar, excluir, transferir, orçamento, meta), chame a ferramenta direto: o próprio app mostra a prévia e pede [s/n] para a pessoa. Não peça confirmação em texto antes.
- Se a pessoa recusar, não tente de novo; pergunte o que ajustar.
- Para lançar, use a linguagem da barra de comando: "descrição valor categoria [conta] [Nx] [hoje|ontem|dd/mm]"; receita começa com "+".
- Você só enxerga os dados desta pessoa, por meio das ferramentas. Não tem acesso a código, arquivos, internet ou outros usuários.
- Assuntos fora das finanças desta pessoa no app: diga em uma frase que só ajuda com isso aqui.`;
}

const toolSpecs = () => TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));

function sweep() {
  const now = Date.now();
  for (const [id, s] of sessions) if (now - s.touchedAt > SESSION_TTL) sessions.delete(id);
}

function getSession(userId: string, id?: string): Session {
  sweep();
  if (id) {
    const s = sessions.get(id);
    if (s && s.userId === userId) return s;
    if (s) throw new AppError(404, 'NOT_FOUND', 'Sessão não encontrada');
  }
  const s: Session = { id: randomUUID(), userId, messages: [], queue: [], results: [], decisions: new Map(), pending: null, busy: false, touchedAt: Date.now() };
  sessions.set(s.id, s);
  return s;
}

/** Corta o histórico antigo sem quebrar pares tool_use/tool_result: só começa numa mensagem de texto da pessoa. */
function trim(s: Session) {
  if (s.messages.length <= MAX_MESSAGES) return;
  let start = s.messages.length - MAX_MESSAGES;
  while (start < s.messages.length && !(s.messages[start].role === 'user' && typeof s.messages[start].content === 'string')) start++;
  s.messages = s.messages.slice(start);
}

const truncate = (text: string, max = 8000) => (text.length > max ? `${text.slice(0, max)}… (cortado)` : text);

/** Resolve a fila de ferramentas e chama o modelo até ele responder ou até uma escrita precisar do [s/n]. */
async function advance(s: Session): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for (let step = 0; step <= MAX_STEPS; step++) {
    while (s.queue.length) {
      const use = s.queue[0];
      const t = TOOL_BY_NAME.get(use.name ?? '');
      const fail = (msg: string) => {
        s.results.push({ type: 'tool_result', tool_use_id: use.id!, content: msg, is_error: true });
        events.push({ type: 'tool', name: use.name ?? '?', ok: false, summary: msg });
        s.queue.shift();
      };
      if (!t) {
        fail(`ferramenta desconhecida: ${use.name}`);
        continue;
      }
      const parsed = t.schema.safeParse(use.input ?? {});
      if (!parsed.success) {
        fail(`entrada inválida: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
        continue;
      }
      try {
        if (t.kind === 'write') {
          const decision = s.decisions.get(use.id!);
          if (decision === undefined) {
            const preview = await t.preview!(s.userId, parsed.data);
            s.pending = { id: use.id!, name: t.name, input: parsed.data, preview };
            events.push({ type: 'approval', name: t.name, preview });
            return events; // espera o [s/n]
          }
          if (decision === false) {
            s.results.push({ type: 'tool_result', tool_use_id: use.id!, content: 'A pessoa recusou. Nada foi gravado.' });
            events.push({ type: 'tool', name: t.name, ok: false, summary: 'recusado' });
            s.queue.shift();
            continue;
          }
        }
        const result = await t.run(s.userId, parsed.data);
        s.results.push({ type: 'tool_result', tool_use_id: use.id!, content: truncate(JSON.stringify(result)) });
        events.push({ type: 'tool', name: t.name, ok: true, summary: t.summarize(result) });
        s.queue.shift();
      } catch (e) {
        if (e instanceof ToolInputError || e instanceof AppError) fail(e.message);
        else throw e;
      }
    }

    if (s.results.length) {
      s.messages.push({ role: 'user', content: s.results });
      s.results = [];
    }
    if (step === MAX_STEPS) break;

    const res = await modelClient().create({ system: systemPrompt(), tools: toolSpecs(), messages: s.messages });
    s.messages.push({ role: 'assistant', content: res.content });
    for (const b of res.content) if (b.type === 'text' && b.text?.trim()) events.push({ type: 'text', text: b.text.trim() });
    s.queue = res.content.filter((b) => b.type === 'tool_use');
    if (!s.queue.length) return events;
  }
  events.push({ type: 'text', text: 'Parei aqui: muitos passos para uma mensagem só. Pode reformular?' });
  // fecha os tool_use pendentes para o histórico continuar válido
  if (s.queue.length) {
    s.messages.push({ role: 'user', content: s.queue.map((u) => ({ type: 'tool_result', tool_use_id: u.id, content: 'interrompido', is_error: true })) });
    s.queue = [];
  }
  return events;
}

async function locked<T>(s: Session, fn: () => Promise<T>): Promise<T> {
  if (s.busy) throw new AppError(409, 'AGENT_BUSY', 'O agente ainda está respondendo');
  s.busy = true;
  s.touchedAt = Date.now();
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AppError) throw e;
    console.error('[agent]', e);
    const status = (e as { status?: number }).status;
    throw new AppError(502, 'AGENT_UPSTREAM', status === 401 ? 'Chave da API da Anthropic inválida' : status === 429 ? 'A API está ocupada agora. Tente em instantes.' : 'O agente não respondeu. Tente de novo.');
  } finally {
    s.busy = false;
  }
}

// ── teto diário somando todo mundo (protege a fatura da API num demo público) ──
let day = '';
let used = 0;
function spendDaily() {
  const today = todayISO();
  if (today !== day) {
    day = today;
    used = 0;
  }
  if (used >= env.AGENT_DAILY_LIMIT) throw new AppError(429, 'AGENT_DAILY_LIMIT', 'O agente atingiu o limite de uso de hoje. Volte amanhã.');
  used++;
}

export async function send(userId: string, text: string, sessionId?: string) {
  const s = getSession(userId, sessionId);
  if (s.pending) throw new AppError(409, 'AGENT_WAITING', 'Responda [s/n] à pergunta anterior primeiro', { decision: 'pendente' });
  spendDaily();
  return locked(s, async () => {
    // uma rodada anterior caiu no meio (ex.: a API falhou): fecha as ferramentas abertas antes de seguir
    if (s.queue.length) {
      s.messages.push({ role: 'user', content: s.queue.map((u) => ({ type: 'tool_result', tool_use_id: u.id, content: 'interrompido', is_error: true })) });
      s.queue = [];
    }
    s.messages.push({ role: 'user', content: text });
    trim(s);
    const events = await advance(s);
    return { sessionId: s.id, events, waiting: s.pending !== null };
  });
}

export async function decide(userId: string, sessionId: string, approve: boolean) {
  const s = getSession(userId, sessionId);
  if (s.id !== sessionId || !s.pending) throw new AppError(409, 'AGENT_NOTHING_PENDING', 'Não há nada esperando confirmação');
  return locked(s, async () => {
    s.decisions.set(s.pending!.id, approve);
    s.pending = null;
    const events = await advance(s);
    return { sessionId: s.id, events, waiting: s.pending !== null };
  });
}

export function reset(userId: string, sessionId: string) {
  const s = sessions.get(sessionId);
  if (s && s.userId === userId) sessions.delete(sessionId);
}

/** Só para testes. */
export function _clearSessions() {
  sessions.clear();
  used = 0;
}
