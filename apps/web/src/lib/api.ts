/**
 * Cliente da API. O access token fica só em memória (some ao recarregar);
 * o refresh token fica num cookie httpOnly que o JavaScript não lê.
 * Ao abrir o app, `restoreSession` usa o cookie para pegar um access token novo.
 */
let accessToken: string | null = null;

/** Para o WebSocket do terminal do Modo Dev (o navegador não manda header Authorization em WebSocket). */
export const getAccessToken = () => accessToken;

export interface User { id: string; name: string; email: string; isDemo: boolean; onboarded: boolean }
export interface ApiError { code: string; message: string; fields?: Record<string, string> }

async function call<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
  });
  if (res.status === 401 && retry && path !== '/auth/refresh' && accessToken) {
    if (await restoreSession()) return call<T>(path, init, false);
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw (body.error ?? { code: 'NETWORK', message: 'Sem resposta da API' }) as ApiError;
  return body as T;
}

type SessionResponse = { accessToken: string; user: User };

export async function login(email: string, password: string): Promise<User> {
  const s = await call<SessionResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  accessToken = s.accessToken;
  return s.user;
}

export async function register(name: string, email: string, password: string): Promise<User> {
  const s = await call<SessionResponse>('/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password }) });
  accessToken = s.accessToken;
  return s.user;
}

/**
 * Renova a sessão com o cookie. Só UMA renovação por vez nesta aba: quem chamar enquanto ela está
 * em andamento recebe a mesma promessa (o React em modo dev roda efeitos duas vezes, e vários
 * pedidos podem dar 401 juntos quando o access token vence). Duas renovações paralelas com o mesmo
 * refresh token pareceriam roubo para a API.
 */
let restoring: Promise<User | null> | null = null;
export function restoreSession(): Promise<User | null> {
  restoring ??= renew().finally(() => {
    restoring = null;
  });
  return restoring;
}

async function renew(retry = true): Promise<User | null> {
  try {
    const s = await call<SessionResponse>('/auth/refresh', { method: 'POST' }, false);
    accessToken = s.accessToken;
    return s.user;
  } catch (e) {
    // outra aba girou o token neste instante: o cookie novo já chegou, tenta uma vez de novo
    if (retry && (e as ApiError).code === 'TOKEN_RACE') {
      await new Promise((r) => setTimeout(r, 300));
      return renew(false);
    }
    accessToken = null;
    return null;
  }
}

export async function logout(): Promise<void> {
  await call('/auth/logout', { method: 'POST' }).catch(() => undefined);
  accessToken = null;
}

export const health = () => call<{ status: string; db: 'up' | 'down' }>('/health');


// ───────────────────────── dados (fase 3) ─────────────────────────

export interface Account {
  id: string;
  name: string;
  kind: 'CHECKING' | 'SAVINGS' | 'CREDIT_CARD' | 'INVESTMENT' | 'CASH';
  aliases: string[];
  openingBalanceCents: number;
  balanceCents: number;
  creditLimitCents: number | null;
  availableCents: number | null;
  closingDay: number | null;
  dueDay: number | null;
}
export interface Category { id: string; name: string; kind: 'INCOME' | 'EXPENSE'; transactionCount: number }
export interface Transaction {
  id: string;
  kind: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  description: string;
  amountCents: number;
  date: string;
  account: { id: string; name: string; kind: Account['kind'] };
  category: { id: string; name: string } | null;
  installment: { planId: string; number: number; count: number; totalCents: number } | null;
  invoiceMonth: string | null;
  transferGroupId: string | null;
  recurring: boolean;
  source: string;
}
export interface TxPage {
  items: Transaction[];
  nextCursor: string | null;
  totals: { count: number; incomeCents: number; expenseCents: number; netCents: number };
}
export interface TxFilters { month?: string; accountId?: string; kind?: string; q?: string; cursor?: string; limit?: number }

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });
const qs = (f: object) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const accounts = () => call<{ items: Account[] }>('/accounts').then((r) => r.items);
export const categories = () => call<{ items: Category[] }>('/categories').then((r) => r.items);
export const transactions = (f: TxFilters) => call<TxPage>(`/transactions${qs(f)}`);

/** POST /transactions/command: a API interpreta de novo com os dados do usuário e grava. 422 diz o que falta. */
export const runCommand = (text: string) =>
  call<{ items: Transaction[] }>('/transactions/command', { method: 'POST', ...json({ text }) }).then((r) => r.items);

export interface TxPatch { description?: string; amountCents?: number; categoryId?: string | null; date?: string; accountId?: string }
export const updateTransaction = (id: string, patch: TxPatch) => call<Transaction>(`/transactions/${id}`, { method: 'PATCH', ...json(patch) });
export const deleteTransaction = (id: string) => call<{ deleted: number }>(`/transactions/${id}`, { method: 'DELETE' });
export const restoreTransaction = (id: string) => call<{ restored: number }>(`/transactions/${id}/restore`, { method: 'POST' });

export const transfer = (body: { fromAccountId: string; toAccountId: string; amountCents: number; date: string; description?: string }) =>
  call<{ items: Transaction[] }>('/transfers', { method: 'POST', ...json(body) }).then((r) => r.items);

// ───────────────────────── painéis (fase 4) ─────────────────────────

export interface DashDay { day: string; dow: number; future: boolean; open: number | null; close: number | null; high: number | null; low: number | null; spentCents: number }
export interface Dashboard {
  month: string;
  today: string;
  isCurrent: boolean;
  kpis: {
    incomeCents: number; expenseCents: number; savedCents: number; savingsRate: number; yearSavingsRate: number;
    netWorthCents: number; netWorthChangeCents: number; txCount: number; budgetUse: number | null;
  };
  daily: DashDay[];
  /** candles: o mês inteiro, ou os últimos 30 dias no começo do mês (inMonth=false = mês anterior) */
  chart: { window: 'month' | 'rolling'; days: (DashDay & { inMonth: boolean })[]; hotThresholdCents: number };
  ohlc: { open: number; close: number; high: number; low: number } | null;
  spend: { hotThresholdCents: number; totalSpentCents: number; weekendSpentCents: number; weekendShare: number };
  allocation: { incomeCents: number; savedCents: number; savedShare: number; items: { name: string; cents: number; share: number; overBudget: boolean }[] };
  categories: { id: string | null; name: string; spentCents: number; share: number; rank: number; avg3Cents: number }[];
  netWorth: {
    series: { month: string; income: number; expense: number; netWorth: number; expenseChange: number | null; txCount: number }[];
    projection: { month: string; expectedCents: number; lowCents: number; highCents: number }[];
    meanDeltaCents: number;
  };
  flow: { id: string; date: string; description: string; category: string | null; account: string; kind: string; amountCents: number; balanceAfterCents: number }[];
  bills: { month: string; items: { date: string; name: string; cents: number; kind: 'invoice' | 'recurrence'; detail: string }[]; totalCents: number; liquidCents: number; leftCents: number };
  alerts: { level: 'over' | 'warn' | 'info' | 'good'; text: string; at: string; read: boolean }[];
  unreadAlerts: number;
  accounts: { id: string; name: string; kind: string; balanceCents: number; availableCents: number | null }[];
  goals: { id: string; name: string; progress: number; etaMonth: string | null }[];
}

export const dashboard = (month: string) => call<Dashboard>(`/dashboard?month=${month}`);

// ───────────────────────── plano (fase 5) ─────────────────────────

export interface PlanRow {
  categoryId: string; name: string; budgetId: string | null; limitCents: number | null; spentCents: number; ratio: number | null;
  status: 'ok' | 'warn' | 'over' | null; history: number[]; avg3Cents: number; suggestionCents: number; deltaCents: number | null;
  nextBudgetId: string | null; nextLimitCents: number | null;
}
export interface BudgetPlan {
  month: string; nextMonth: string; items: PlanRow[];
  totals: { limitCents: number; spentCents: number; spentBudgetedCents: number; used: number | null; leftCents: number; avg3Cents: number; suggestionCents: number };
}
export interface Goal {
  id: string; name: string; account: { id: string; name: string } | null; targetCents: number; currentCents: number; progress: number;
  monthlyContributionCents: number; monthlyRateBps: number;
  projection: { reached: boolean; months: number; etaMonth: string | null; depositedCents: number; interestCents: number; path: number[] };
}
export interface GoalInput { name: string; accountId: string; targetCents: number; monthlyContributionCents: number; monthlyRateBps?: number }

export const budgetPlan = (month: string) => call<BudgetPlan>(`/budgets/plan?month=${month}`);
export const putBudget = (categoryId: string, month: string, limitCents: number) => call('/budgets', { method: 'PUT', ...json({ categoryId, month, limitCents }) });
export const deleteBudget = (id: string) => call(`/budgets/${id}`, { method: 'DELETE' });
export const applyBudgets = (month: string, items: { categoryId: string; limitCents: number }[]) =>
  call<{ applied: number }>('/budgets/apply', { method: 'POST', ...json({ month, items }) });

export const goals = () => call<{ items: Goal[] }>('/goals').then((r) => r.items);
export const createGoal = (g: GoalInput) => call<Goal>('/goals', { method: 'POST', ...json(g) });
export const updateGoal = (id: string, g: Partial<GoalInput>) => call<Goal>(`/goals/${id}`, { method: 'PATCH', ...json(g) });
export const deleteGoal = (id: string) => call(`/goals/${id}`, { method: 'DELETE' });

// ───────────────────────── alertas (fase 6) ─────────────────────────

export interface AlertItem { id: string; kind: string; level: 'over' | 'warn' | 'info' | 'good'; message: string; createdAt: string; read: boolean }
export interface AlertRule { kind: string; enabled: boolean; threshold: number | null; label: string; unit: string | null }

export const alerts = () => call<{ unread: number; items: AlertItem[] }>('/alerts');
export const readAlerts = () => call<{ read: number }>('/alerts/read', { method: 'POST' });
export const alertRules = () => call<{ items: AlertRule[] }>('/alerts/rules').then((r) => r.items);
export const setAlertRule = (kind: string, body: { enabled: boolean; threshold?: number | null }) =>
  call<AlertRule>(`/alerts/rules/${kind}`, { method: 'PUT', ...json(body) });

// ───────────────────────── guia de primeiro uso ─────────────────────────
export const setOnboarding = (done: boolean) => call<{ onboarded: boolean }>('/me/onboarding', { method: 'PUT', ...json({ done }) });

// ───────────────────────── agente (fase 7) ─────────────────────────
export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; ok: boolean; summary: string }
  | { type: 'approval'; name: string; preview: string };
export interface AgentReply { sessionId: string; events: AgentEvent[]; waiting: boolean }
export interface AgentStatus { agent: { enabled: boolean; model: string; branding: string }; dev: { enabled: boolean; reason: string | null } }

export const agentStatus = () => call<AgentStatus>('/agent/status');
export const agentSend = (text: string, sessionId?: string) => call<AgentReply>('/agent/messages', { method: 'POST', ...json({ text, sessionId }) });
export const agentDecide = (sessionId: string, approve: boolean) => call<AgentReply>(`/agent/sessions/${sessionId}/decision`, { method: 'POST', ...json({ approve }) });
export const agentReset = (sessionId: string) => call(`/agent/sessions/${sessionId}`, { method: 'DELETE' });

// ───────────────────────── contas, categorias e contas fixas ─────────────────────────
export interface AccountInput {
  name?: string; kind?: Account['kind']; aliases?: string[]; openingBalanceCents?: number;
  creditLimitCents?: number | null; closingDay?: number | null; dueDay?: number | null;
}
export interface Recurrence {
  id: string; kind: 'INCOME' | 'EXPENSE'; description: string; amountCents: number; dayOfMonth: number; nextRunOn: string; active: boolean;
  account: { id: string; name: string; kind: string }; category: { id: string; name: string }; launched: number;
}
export interface RecurrenceInput { kind?: 'INCOME' | 'EXPENSE'; description?: string; amountCents?: number; accountId?: string; categoryId?: string; dayOfMonth?: number; active?: boolean }

export const createAccount = (a: AccountInput) => call<Account>('/accounts', { method: 'POST', ...json(a) });
export const updateAccount = (id: string, a: AccountInput) => call<Account>(`/accounts/${id}`, { method: 'PATCH', ...json(a) });
export const deleteAccount = (id: string) => call(`/accounts/${id}`, { method: 'DELETE' });
export const createCategory = (name: string, kind: 'INCOME' | 'EXPENSE') => call<Category>('/categories', { method: 'POST', ...json({ name, kind }) });
export const renameCategory = (id: string, name: string) => call<Category>(`/categories/${id}`, { method: 'PATCH', ...json({ name }) });
export const deleteCategory = (id: string) => call(`/categories/${id}`, { method: 'DELETE' });
export const recurrences = () => call<{ items: Recurrence[] }>('/recurrences').then((r) => r.items);
export const createRecurrence = (r: RecurrenceInput) => call<Recurrence>('/recurrences', { method: 'POST', ...json(r) });
export const updateRecurrence = (id: string, r: RecurrenceInput) => call<Recurrence>(`/recurrences/${id}`, { method: 'PATCH', ...json(r) });
export const deleteRecurrence = (id: string) => call(`/recurrences/${id}`, { method: 'DELETE' });
