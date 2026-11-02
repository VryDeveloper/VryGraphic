# VryGraphic

Controle financeiro pessoal com visual de terminal. Cada lançamento vira saldo diário, alocação do salário,
alertas de orçamento e previsão de metas, tudo calculado no banco de dados.

> Projeto de portfólio: cálculos com dinheiro em centavos inteiros, Postgres com window functions,
> CRUD com validação compartilhada entre front e back, autenticação com rotação de refresh token.

## Como rodar no Windows (passo a passo)

### 1. Instale uma vez
- **Node.js 22**: https://nodejs.org (versão LTS). Confira no terminal: `node -v`
- **Docker Desktop**: https://www.docker.com/products/docker-desktop. Deixe ele **aberto** enquanto usa o projeto.

### 2. Abra o terminal na pasta do projeto
No VS Code: *Arquivo → Abrir pasta → `C:\Users\vryar\Dev\projetos\VryGraphic`* e depois *Terminal → Novo terminal*.

### 3. Instale as dependências
```
npm install
```

### 4. Prepare o banco (um comando só)
```
npm run setup
```
Ele cria `apps/api/.env`, sobe o Postgres no Docker, cria as tabelas e o usuário demo.

### 5. Rode o app
```
npm run dev
```
Abra **http://localhost:5173** e clique em **Entrar na demonstração**. O usuário demo já vem com 12 meses de lançamentos.

No primeiro acesso abre um **guia rápido** que passa por cada parte da tela (Visão geral, Transações e Plano).
Dá para pular, e o botão **? GUIA** no topo mostra de novo quando quiser. Em contas normais, "já vi o guia" fica salvo
na conta; no demo, que é compartilhado, fica no navegador.

Na **Visão geral** (calculada no PostgreSQL):
- saldo diário da conta corrente em candles, com o gasto do dia embaixo;
- para onde foi o salário, patrimônio de 12 meses com projeção até o fim do ano;
- mapa de calor do gasto por dia, últimos lançamentos com o saldo depois de cada um;
- vencimentos do mês seguinte e alertas (orçamento estourado, limite do cartão, metas).

No **Plano**:
- orçamento do mês por categoria: clique no limite para editar, veja o uso e a média dos últimos 3 meses;
- sugestão de limite para o mês seguinte (média arredondada para cima em R$ 50) e um botão para aplicar todas;
- metas com simulador: mexa no aporte e no rendimento e veja na hora quando a meta chega; salve na meta;
- criar e excluir metas;
- regras de alerta: ligar/desligar cada aviso e ajustar o limite (ex.: avisar com 75% do orçamento).

**Contas** (aba 4):
- contas (corrente, poupança, cartão com limite, fechamento e vencimento, dinheiro, investimento): criar, editar, excluir; apelidos usados no comando;
- categorias de despesa e receita: criar, renomear (clique no nome) e excluir;
- contas fixas (aluguel, assinaturas, salário): cadastrar, editar, pausar e excluir; o job lança sozinho no dia.

**Agente** (aba 5):
- **Vry Agent · Powered by Claude**: pergunte sobre gastos, orçamentos e metas ou peça para lançar, transferir, ajustar orçamento ou meta.
  Ele só usa ferramentas deste app, só enxerga os seus dados, e **pede [s/n] antes de gravar** qualquer coisa.
  Para ligar: coloque `ANTHROPIC_API_KEY=sua-chave` no `apps/api/.env` (chave em platform.claude.com) e reinicie o `npm run dev`.
- **Modo Dev**: um terminal de verdade dentro do app, na pasta do projeto, para rodar o Claude Code.
  Para ligar: `DEV_TERMINAL=true` no `apps/api/.env`. Só funciona no seu PC (nunca em produção, só localhost, exige login).

**Alertas e jobs** (rodam sozinhos a cada hora):
- contas fixas (aluguel, luz, internet...) são lançadas no dia, com a tag `fixa`; se o servidor ficou parado, ele lança os meses atrasados;
- alertas de orçamento, fatura fechando, meta que mudou de previsão e conta fixa não lançada; o contador aparece no topo.

Na tela de Transações você pode:
- lançar pela barra de comando (`mercado 120,50 alimentação`, `notebook 2.400 tecnologia 7x`, `+freela 640 trabalho`);
- trocar de mês, filtrar por tipo e conta, buscar pela descrição;
- **editar** um lançamento na própria linha (Enter salva, Esc cancela) e **excluir** com **desfazer**;
- transferir entre contas e ver os saldos mudarem na hora.

Para parar: `Ctrl + C` no terminal. Para desligar o banco: `npm run db:down`.

## Já tinha o projeto rodando? Depois de atualizar

```
npm install
npm run db:deploy
npm run db:seed
```

`npm install` atualiza o Prisma, `db:deploy` aplica as migrações novas e `db:seed` recria o demo.

## Comandos úteis

| Comando | O que faz |
|---|---|
| `npm run dev` | API (porta 3333) e site (porta 5173) juntos |
| `npm test` | Testes rápidos (regras compartilhadas + API sem banco) |
| `npm run test:db` | Testes de integração da API contra o Postgres (cria o banco `vrygraphic_test` sozinho) |
| `npm run typecheck` | Checagem de tipos do TypeScript |
| `npm run db:up` / `db:down` | Liga / desliga o Postgres |
| `npm run db:seed` | Recria o usuário demo com 12 meses de dados (leva alguns segundos) |

## Problemas comuns

- **`docker` não é reconhecido / banco não responde**: abra o Docker Desktop e espere ele dizer *Engine running*.
- **Porta 5433 em uso**: outro Postgres está nessa porta. Troque `5433` no `docker-compose.yml` e no `apps/api/.env`.
- **Rodapé mostra `BANCO down`**: o Docker parou. Rode `npm run db:up`.

## API (fase 3)

Tudo em `/api/v1`, com `Authorization: Bearer <token>` (menos auth e health). Erros sempre como `{ error: { code, message, fields? } }`.

| Rota | O que faz |
|---|---|
| `GET/POST /accounts`, `PATCH/DELETE /accounts/:id` | Contas com saldo calculado (saldo inicial + lançamentos) |
| `GET/POST /categories`, `PATCH/DELETE /categories/:id` | Categorias de receita e despesa |
| `GET /transactions?month=&accountId=&kind=&q=&cursor=` | Lista paginada por cursor, com totais do filtro |
| `POST /transactions` | Lançamento; com `installments` cria as parcelas e as faturas do cartão numa transação só |
| `POST /transactions/command` | Mesmo parser do front, com as contas e categorias do usuário |
| `PATCH/DELETE /transactions/:id`, `POST /transactions/:id/restore` | Editar, excluir (lógico) e desfazer |
| `POST /transfers` | Transferência: duas pernas que somam zero |
| `GET/PUT /budgets?month=`, `DELETE /budgets/:id` | Orçamento do mês com o gasto real |
| `GET /budgets/plan?month=`, `POST /budgets/apply` | Planejamento: 3 meses por categoria, sugestão e aplicar vários limites numa transação |
| `GET/POST /goals`, `PATCH/DELETE /goals/:id` | Metas com projeção de juros compostos |
| `GET /me`, `PUT /me/onboarding` | Quem está logado e se já viu o guia de primeiro uso |
| `GET/POST /recurrences`, `PATCH/DELETE /recurrences/:id` | Contas fixas: próxima data calculada, pausar, excluir sem apagar o histórico |
| `GET /alerts`, `POST /alerts/read`, `GET/PUT /alerts/rules/:tipo` | Alertas gravados (sem duplicar) e regras por usuário |
| `GET /agent/status`, `POST /agent/messages`, `POST /agent/sessions/:id/decision` | Vry Agent: conversa com ferramentas próprias e confirmação [s/n] |
| `GET /dashboard?month=` | Todos os painéis da Visão geral num pedido (window functions, percentil, LAG, RANK) |

Cada pessoa só enxerga os próprios dados: um id de outra pessoa responde 404, sem revelar que existe.

## Estrutura

```
packages/shared   regras que front e back usam: dinheiro, parser de comando, parcelas, metas, validação (Zod)
apps/api          Express + Prisma + Postgres: autenticação e CRUD (contas, categorias, lançamentos, transferências, orçamentos, metas)
apps/web          React + Vite: login e tela de transações com a barra de comando
```

## Fases

1. ✅ Base: monorepo, regras compartilhadas com testes, banco e migração
2. ✅ Autenticação (JWT + refresh token com rotação) e tela de transações com prévia ao vivo
3. ✅ CRUD completo no banco com testes de integração
4. ✅ Consultas dos painéis (window functions) e seed de 12 meses
5. ✅ Tela do Plano (orçamentos e metas)
6. ✅ Alertas, contas fixas automáticas, jobs e preparo do deploy ([DEPLOY.md](DEPLOY.md))
7. ✅ Agente no terminal (Vry Agent · Powered by Claude) e Modo Dev com terminal real
