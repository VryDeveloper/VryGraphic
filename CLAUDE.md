# VryGraphic — notas para agentes

- Monorepo npm workspaces: packages/shared, apps/api, apps/web. TypeScript em tudo.
- Dinheiro é SEMPRE centavos inteiros (BIGINT no banco, number no TS). Formate só na tela (`formatBRL`/`formatPlain`).
- Regra de negócio nova vai em packages/shared com teste (vitest) antes de ser usada no front ou no back.
- Migrações são SQL escritas à mão em apps/api/prisma/migrations (têm CHECK constraints que o Prisma não gera).
- Erros da API sempre no formato `{ error: { code, message, fields? } }` via `AppError`.
- Antes de terminar: `npm run typecheck` e `npm test` passando.
- Não commitar sem pedir ao Victor.
