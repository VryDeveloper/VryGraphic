import 'dotenv/config';
import { z } from 'zod';

/** Variáveis de ambiente validadas na inicialização: a API não sobe com configuração errada. */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3333),
  DATABASE_URL: z.string().url().optional(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET precisa de pelo menos 32 caracteres'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().positive().default(7),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  /** jobs de contas fixas e alertas a cada hora (desligados nos testes) */
  JOBS_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  /** recria o usuário demo todo dia (ligar em produção) */
  DEMO_RESET: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  DEMO_RESET_HOUR: z.coerce.number().int().min(0).max(23).default(4),
  /** chave da API da Anthropic para o Vry Agent; sem ela a aba Agente mostra como configurar */
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-5-5'),
  /** teto de mensagens ao agente por dia, somando todo mundo (protege a fatura da API) */
  AGENT_DAILY_LIMIT: z.coerce.number().int().positive().default(300),
  /** terminal real dentro do app (Modo Dev). Só funciona fora de produção e acessando por localhost. */
  DEV_TERMINAL: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});

const parsed = schema.safeParse({
  ...process.env,
  JWT_SECRET: process.env.JWT_SECRET ?? (process.env.NODE_ENV === 'test' ? 'segredo-de-teste-com-mais-de-32-caracteres!!' : undefined),
});

if (!parsed.success) {
  console.error('Configuração inválida no .env:');
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

export const env = parsed.data;
