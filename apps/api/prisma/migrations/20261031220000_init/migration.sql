-- VryGraphic · migração inicial
-- Gerada a partir de schema.prisma, mais as restrições CHECK que o Prisma não declara.

-- CreateEnum
CREATE TYPE "AccountKind" AS ENUM ('CHECKING', 'SAVINGS', 'CREDIT_CARD', 'INVESTMENT', 'CASH');
CREATE TYPE "TxKind" AS ENUM ('INCOME', 'EXPENSE', 'TRANSFER');
CREATE TYPE "TxSource" AS ENUM ('MANUAL', 'COMMAND', 'CSV', 'RECURRING', 'AGENT', 'DEMO');
CREATE TYPE "InvoiceStatus" AS ENUM ('OPEN', 'CLOSED', 'PAID');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "family_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AccountKind" NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "opening_balance_cents" BIGINT NOT NULL DEFAULT 0,
    "credit_limit_cents" BIGINT,
    "closing_day" INTEGER,
    "due_day" INTEGER,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "TxKind" NOT NULL,
    "deleted_at" TIMESTAMPTZ,
    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "category_id" UUID,
    "kind" "TxKind" NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "description" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL,
    "invoice_id" UUID,
    "transfer_group_id" UUID,
    "installment_plan_id" UUID,
    "installment_no" INTEGER,
    "recurrence_id" UUID,
    "source" "TxSource" NOT NULL DEFAULT 'MANUAL',
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "card_invoices" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "closing_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'OPEN',
    CONSTRAINT "card_invoices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "installment_plans" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "total_cents" BIGINT NOT NULL,
    "count" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "installment_plans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "recurrences" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "day_of_month" INTEGER NOT NULL,
    "next_run_on" DATE NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "recurrences_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "budgets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "limit_cents" BIGINT NOT NULL,
    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "goals" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "target_cents" BIGINT NOT NULL,
    "monthly_contribution_cents" BIGINT NOT NULL,
    "monthly_rate_bps" INTEGER NOT NULL DEFAULT 85,
    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "alerts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ,
    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");
CREATE INDEX "accounts_user_id_idx" ON "accounts"("user_id");
CREATE UNIQUE INDEX "categories_user_id_name_key" ON "categories"("user_id", "name");
CREATE INDEX "transactions_user_id_occurred_at_idx" ON "transactions"("user_id", "occurred_at" DESC);
CREATE INDEX "transactions_account_id_occurred_at_id_idx" ON "transactions"("account_id", "occurred_at", "id");
CREATE INDEX "transactions_user_id_category_id_occurred_at_idx" ON "transactions"("user_id", "category_id", "occurred_at");
CREATE INDEX "transactions_transfer_group_id_idx" ON "transactions"("transfer_group_id");
CREATE UNIQUE INDEX "card_invoices_account_id_month_key" ON "card_invoices"("account_id", "month");
CREATE INDEX "installment_plans_user_id_idx" ON "installment_plans"("user_id");
CREATE INDEX "recurrences_user_id_idx" ON "recurrences"("user_id");
CREATE UNIQUE INDEX "budgets_user_id_category_id_month_key" ON "budgets"("user_id", "category_id", "month");
CREATE INDEX "goals_user_id_idx" ON "goals"("user_id");
CREATE UNIQUE INDEX "alerts_user_id_dedupe_key_key" ON "alerts"("user_id", "dedupe_key");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "card_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_installment_plan_id_fkey" FOREIGN KEY ("installment_plan_id") REFERENCES "installment_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurrence_id_fkey" FOREIGN KEY ("recurrence_id") REFERENCES "recurrences"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "card_invoices" ADD CONSTRAINT "card_invoices_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recurrences" ADD CONSTRAINT "recurrences_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recurrences" ADD CONSTRAINT "recurrences_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goals" ADD CONSTRAINT "goals_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Regras de negócio no banco (o Prisma não declara CHECK)
-- Despesa é negativa, receita é positiva; transferência tem sinal livre (as duas pontas somam zero).
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_amount_sign_check"
  CHECK (("kind" = 'EXPENSE' AND "amount_cents" < 0) OR ("kind" = 'INCOME' AND "amount_cents" > 0) OR ("kind" = 'TRANSFER' AND "amount_cents" <> 0));
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_limit_check" CHECK ("limit_cents" >= 0);
ALTER TABLE "goals" ADD CONSTRAINT "goals_target_check" CHECK ("target_cents" > 0);
ALTER TABLE "recurrences" ADD CONSTRAINT "recurrences_day_check" CHECK ("day_of_month" BETWEEN 1 AND 31);
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_card_days_check" CHECK (("closing_day" IS NULL OR "closing_day" BETWEEN 1 AND 31) AND ("due_day" IS NULL OR "due_day" BETWEEN 1 AND 31));
