-- Guia de primeiro uso: quando a pessoa terminou (ou pulou) o tour. NULL = ainda não viu.
ALTER TABLE "users" ADD COLUMN "onboarded_at" TIMESTAMPTZ;
