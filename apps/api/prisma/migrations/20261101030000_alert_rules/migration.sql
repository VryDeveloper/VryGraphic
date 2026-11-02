-- Fase 6: regras de alerta por usuário, previsão salva das metas e chaves estrangeiras que faltavam.

-- Regras de alerta: uma linha por tipo, por usuário. Sem linha = regra no padrão.
CREATE TABLE "alert_rules" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "threshold" INTEGER,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "alert_rules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "alert_rules_kind_check" CHECK ("kind" IN ('BUDGET_THRESHOLD', 'INVOICE_CLOSING', 'GOAL_ETA_CHANGED', 'RECURRENCE_MISSED')),
    CONSTRAINT "alert_rules_threshold_check" CHECK ("threshold" IS NULL OR "threshold" BETWEEN 1 AND 100)
);
CREATE UNIQUE INDEX "alert_rules_user_id_kind_key" ON "alert_rules"("user_id", "kind");
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Última previsão conhecida de cada meta: o alerta dispara quando ela muda.
ALTER TABLE "goals" ADD COLUMN "last_eta_month" TEXT;

-- Listagem de alertas por usuário, mais recentes primeiro.
CREATE INDEX "alerts_user_id_created_at_idx" ON "alerts"("user_id", "created_at" DESC);

-- installment_plans e recurrences tinham user_id sem chave estrangeira: apagar um usuário
-- (como o reset diário do demo faz) deixava linhas órfãs. Limpa as que existirem e amarra.
DELETE FROM "installment_plans" p WHERE NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = p."user_id");
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DELETE FROM "recurrences" r WHERE NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = r."user_id");
ALTER TABLE "recurrences" ADD CONSTRAINT "recurrences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
