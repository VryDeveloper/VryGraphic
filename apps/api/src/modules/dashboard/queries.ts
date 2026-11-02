import { prisma } from '../../lib/prisma';

/**
 * As consultas dos painéis. Toda conta pesada acontece no PostgreSQL:
 * séries com generate_series, saldos acumulados com SUM() OVER (window functions),
 * comparação com o mês anterior com LAG(), participação com SUM() OVER () e RANK(),
 * percentil com PERCENTILE_CONT e agregados condicionais com FILTER.
 *
 * Datas: o banco guarda instantes (timestamptz); o dia "de verdade" é o de São Paulo,
 * então todo agrupamento por dia/mês converte com AT TIME ZONE antes.
 */

const n = (v: bigint | number | null) => (v === null ? 0 : Number(v));

export interface DayRow { day: string; dow: number; net: number; inflow: number; outflow: number; close: number; spent: number }

/**
 * Um registro por dia do mês: saldo de fechamento da conta corrente (saldo inicial + tudo antes do mês
 * + soma acumulada do mês), entradas e saídas do dia (para o "pavio" do candle) e o gasto do dia
 * em todas as contas, incluindo o cartão (a "barra de volume" e o mapa de calor).
 */
export async function dailyRows(userId: string, monthStart: string, monthEnd: string): Promise<DayRow[]> {
  const rows = await prisma.$queryRaw<Record<string, bigint | number | string>[]>`
    WITH days AS (
      SELECT gs::date AS day FROM generate_series(${monthStart}::date, ${monthEnd}::date, interval '1 day') AS gs
    ),
    liquid AS (
      SELECT id, opening_balance_cents FROM accounts
      WHERE user_id = ${userId}::uuid AND kind = 'CHECKING' AND deleted_at IS NULL
    ),
    moves AS (
      SELECT (t.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
             SUM(t.amount_cents)              AS net,
             SUM(GREATEST(t.amount_cents, 0)) AS inflow,
             SUM(LEAST(t.amount_cents, 0))    AS outflow
      FROM transactions t JOIN liquid l ON l.id = t.account_id
      WHERE t.deleted_at IS NULL
      GROUP BY 1
    ),
    spend AS (
      SELECT (t.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date AS day, -SUM(t.amount_cents) AS spent
      FROM transactions t
      WHERE t.user_id = ${userId}::uuid AND t.deleted_at IS NULL AND t.kind = 'EXPENSE'
        AND (t.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN ${monthStart}::date AND ${monthEnd}::date
      GROUP BY 1
    ),
    base AS (
      SELECT (SELECT COALESCE(SUM(opening_balance_cents), 0) FROM liquid)
           + (SELECT COALESCE(SUM(net), 0) FROM moves WHERE day < ${monthStart}::date) AS b
    )
    SELECT d.day::text                                       AS day,
           EXTRACT(ISODOW FROM d.day)::int                   AS dow,
           COALESCE(m.net, 0)::bigint                        AS net,
           COALESCE(m.inflow, 0)::bigint                     AS inflow,
           COALESCE(m.outflow, 0)::bigint                    AS outflow,
           (base.b + SUM(COALESCE(m.net, 0)) OVER w)::bigint AS close,
           COALESCE(s.spent, 0)::bigint                      AS spent
    FROM days d
    CROSS JOIN base
    LEFT JOIN moves m ON m.day = d.day
    LEFT JOIN spend s ON s.day = d.day
    WINDOW w AS (ORDER BY d.day ROWS UNBOUNDED PRECEDING)
    ORDER BY d.day`;
  return rows.map((r) => ({
    day: String(r.day),
    dow: n(r.dow as number),
    net: n(r.net as bigint),
    inflow: n(r.inflow as bigint),
    outflow: n(r.outflow as bigint),
    close: n(r.close as bigint),
    spent: n(r.spent as bigint),
  }));
}

/** Estatísticas do gasto diário até `untilDay`: percentil 80 (dia "quente") e quanto caiu no fim de semana. */
export async function spendStats(userId: string, monthStart: string, untilDay: string) {
  const [r] = await prisma.$queryRaw<{ p80: number | null; weekend: bigint; total: bigint; variable_total: bigint; variable_weekend: bigint }[]>`
    WITH spend AS (
      SELECT (t.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
             -SUM(t.amount_cents) AS spent,
             -SUM(t.amount_cents) FILTER (WHERE t.recurrence_id IS NULL AND t.installment_plan_id IS NULL) AS variable
      FROM transactions t
      WHERE t.user_id = ${userId}::uuid AND t.deleted_at IS NULL AND t.kind = 'EXPENSE'
        AND (t.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN ${monthStart}::date AND ${untilDay}::date
      GROUP BY 1
    )
    SELECT PERCENTILE_CONT(0.8) WITHIN GROUP (ORDER BY spent)::float8                          AS p80,
           COALESCE(SUM(spent) FILTER (WHERE EXTRACT(ISODOW FROM day) IN (6, 7)), 0)::bigint   AS weekend,
           COALESCE(SUM(spent), 0)::bigint                                                    AS total,
           COALESCE(SUM(variable), 0)::bigint                                                 AS variable_total,
           COALESCE(SUM(variable) FILTER (WHERE EXTRACT(ISODOW FROM day) IN (6, 7)), 0)::bigint AS variable_weekend
    FROM spend`;
  return {
    hotThresholdCents: r?.p80 === null || r?.p80 === undefined ? 0 : Math.round(r.p80),
    totalSpentCents: n(r?.total ?? 0n),
    weekendSpentCents: n(r?.weekend ?? 0n),
    variableSpentCents: n(r?.variable_total ?? 0n),
    variableWeekendCents: n(r?.variable_weekend ?? 0n),
  };
}

export interface MonthRow { month: string; income: number; expense: number; netWorth: number; expenseChange: number | null; txCount: number }

/**
 * Mês a mês: receitas, despesas e patrimônio no fim do mês (todas as contas ativas, cartão negativo),
 * com a variação da despesa em relação ao mês anterior via LAG(). Nada depois de `upTo` entra
 * (no mês atual, parcelas marcadas para daqui a alguns dias ainda não aconteceram).
 */
export async function monthlyRows(userId: string, fromMonth: string, toMonth: string, upTo: Date): Promise<MonthRow[]> {
  const rows = await prisma.$queryRaw<{ month: string; income: bigint; expense: bigint; net_worth: bigint; expense_change: bigint | null; tx_count: number }[]>`
    WITH months AS (
      SELECT to_char(gs, 'YYYY-MM') AS month
      FROM generate_series(${`${fromMonth}-01`}::date, ${`${toMonth}-01`}::date, interval '1 month') AS gs
    ),
    tx AS (
      SELECT to_char(t.occurred_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') AS month, t.kind, t.amount_cents
      FROM transactions t JOIN accounts a ON a.id = t.account_id AND a.deleted_at IS NULL
      WHERE t.user_id = ${userId}::uuid AND t.deleted_at IS NULL AND t.occurred_at < ${upTo}
    ),
    agg AS (
      SELECT month,
             COALESCE(SUM(amount_cents) FILTER (WHERE kind = 'INCOME'), 0)   AS income,
             COALESCE(-SUM(amount_cents) FILTER (WHERE kind = 'EXPENSE'), 0) AS expense,
             SUM(amount_cents)                                              AS net,
             COUNT(*) FILTER (WHERE kind <> 'TRANSFER')                     AS tx_count
      FROM tx GROUP BY month
    ),
    base AS (
      SELECT (SELECT COALESCE(SUM(opening_balance_cents), 0) FROM accounts WHERE user_id = ${userId}::uuid AND deleted_at IS NULL)
           + (SELECT COALESCE(SUM(amount_cents), 0) FROM tx WHERE month < ${fromMonth}) AS b
    )
    SELECT m.month,
           COALESCE(a.income, 0)::bigint                                                     AS income,
           COALESCE(a.expense, 0)::bigint                                                    AS expense,
           (base.b + SUM(COALESCE(a.net, 0)) OVER w)::bigint                                 AS net_worth,
           (COALESCE(a.expense, 0) - LAG(COALESCE(a.expense, 0)) OVER (ORDER BY m.month))::bigint AS expense_change,
           COALESCE(a.tx_count, 0)::int                                                      AS tx_count
    FROM months m
    CROSS JOIN base
    LEFT JOIN agg a USING (month)
    WINDOW w AS (ORDER BY m.month ROWS UNBOUNDED PRECEDING)
    ORDER BY m.month`;
  return rows.map((r) => ({
    month: r.month,
    income: n(r.income),
    expense: n(r.expense),
    netWorth: n(r.net_worth),
    expenseChange: r.expense_change === null ? null : n(r.expense_change),
    txCount: r.tx_count,
  }));
}

/** Gasto por categoria no mês: participação (SUM OVER ()), posição (RANK) e média dos 3 meses anteriores. */
export async function categoryRows(userId: string, range: { gte: Date; lt: Date }, prevGte: Date) {
  const rows = await prisma.$queryRaw<{ id: string | null; name: string; spent: bigint; share: number; rank: number; avg3: bigint }[]>`
    WITH cur AS (
      SELECT t.category_id, -SUM(t.amount_cents) AS spent
      FROM transactions t
      WHERE t.user_id = ${userId}::uuid AND t.deleted_at IS NULL AND t.kind = 'EXPENSE'
        AND t.occurred_at >= ${range.gte} AND t.occurred_at < ${range.lt}
      GROUP BY t.category_id
    ),
    prev AS (
      SELECT t.category_id, -SUM(t.amount_cents) AS spent
      FROM transactions t
      WHERE t.user_id = ${userId}::uuid AND t.deleted_at IS NULL AND t.kind = 'EXPENSE'
        AND t.occurred_at >= ${prevGte} AND t.occurred_at < ${range.gte}
      GROUP BY t.category_id
    )
    SELECT c.id,
           COALESCE(c.name, 'Sem categoria')                          AS name,
           cur.spent::bigint                                          AS spent,
           ROUND(cur.spent * 100.0 / SUM(cur.spent) OVER (), 1)::float8 AS share,
           RANK() OVER (ORDER BY cur.spent DESC)::int                 AS rank,
           ROUND(COALESCE(prev.spent, 0) / 3.0)::bigint               AS avg3
    FROM cur
    LEFT JOIN categories c ON c.id = cur.category_id
    LEFT JOIN prev ON prev.category_id IS NOT DISTINCT FROM cur.category_id
    ORDER BY cur.spent DESC, name`;
  return rows.map((r) => ({ id: r.id, name: r.name, spentCents: n(r.spent), share: r.share, rank: r.rank, avg3Cents: n(r.avg3) }));
}

/**
 * Últimos lançamentos com o saldo da conta depois de cada um:
 * SUM() OVER (PARTITION BY conta ORDER BY data) roda sobre TODO o histórico e só depois o LIMIT corta.
 */
export async function flowRows(userId: string, before: Date, limit = 8) {
  const rows = await prisma.$queryRaw<{ id: string; day: string; description: string; category: string | null; account: string; kind: string; amount: bigint; balance_after: bigint }[]>`
    SELECT t.id,
           (t.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date::text AS day,
           t.description,
           c.name AS category,
           a.name AS account,
           t.kind::text AS kind,
           t.amount_cents AS amount,
           (a.opening_balance_cents + SUM(t.amount_cents) OVER (
              PARTITION BY t.account_id ORDER BY t.occurred_at, t.created_at, t.id ROWS UNBOUNDED PRECEDING
           ))::bigint AS balance_after
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.user_id = ${userId}::uuid AND t.deleted_at IS NULL AND t.occurred_at < ${before}
    ORDER BY t.occurred_at DESC, t.created_at DESC, t.id DESC
    LIMIT ${limit}`;
  return rows.map((r) => ({
    id: r.id,
    date: r.day,
    description: r.description,
    category: r.category,
    account: r.account,
    kind: r.kind,
    amountCents: n(r.amount),
    balanceAfterCents: n(r.balance_after),
  }));
}

/** Faturas que vencem no mês: total de cada uma somando os lançamentos ligados a ela. */
export async function invoicesDue(userId: string, monthStart: string, monthEnd: string) {
  const rows = await prisma.$queryRaw<{ due: string; account: string; month: string; total: bigint; items: number }[]>`
    SELECT i.due_date::text AS due, a.name AS account, i.month,
           COALESCE(-SUM(t.amount_cents), 0)::bigint AS total,
           COUNT(t.id)::int AS items
    FROM card_invoices i
    JOIN accounts a ON a.id = i.account_id AND a.user_id = ${userId}::uuid AND a.deleted_at IS NULL
    LEFT JOIN transactions t ON t.invoice_id = i.id AND t.deleted_at IS NULL AND t.kind = 'EXPENSE'
    WHERE i.due_date BETWEEN ${monthStart}::date AND ${monthEnd}::date
    GROUP BY i.id, i.due_date, a.name, i.month
    ORDER BY i.due_date`;
  return rows.map((r) => ({ dueDate: r.due, account: r.account, invoiceMonth: r.month, totalCents: n(r.total), items: r.items }));
}
