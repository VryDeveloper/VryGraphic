import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/env';

/** O pedaço da API de mensagens que o agente usa. Os testes trocam por um modelo simulado. */
export interface ModelBlock { type: string; text?: string; id?: string; name?: string; input?: unknown }
export interface ModelResponse { content: ModelBlock[]; stop_reason: string | null }
export interface ModelRequest {
  system: string;
  tools: { name: string; description: string; input_schema: Record<string, unknown> }[];
  messages: { role: 'user' | 'assistant'; content: unknown }[];
}
export interface ModelClient { create(req: ModelRequest): Promise<ModelResponse> }

let override: ModelClient | null = null;
let real: ModelClient | null = null;

/** Para testes e para o e2e com roteiro: usa este modelo no lugar da API real. */
export function setModelClient(c: ModelClient | null) {
  override = c;
}

export function agentEnabled() {
  return Boolean(override || env.ANTHROPIC_API_KEY);
}

export function modelClient(): ModelClient {
  if (override) return override;
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY não configurada');
  if (!real) {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    real = {
      async create(req) {
        const r = await client.messages.create({
          model: env.ANTHROPIC_MODEL,
          max_tokens: 1024,
          system: req.system,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tools: req.tools as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          messages: req.messages as any,
        });
        return { content: r.content as unknown as ModelBlock[], stop_reason: r.stop_reason };
      },
    };
  }
  return real;
}
