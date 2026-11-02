# Deploy do VryGraphic

Em produção é **um serviço só**: a API Express entrega o front já compilado, na mesma URL.
As migrações rodam sozinhas a cada deploy, e o usuário demo é criado (e recriado todo dia às 4h) pelo job.

## Antes: testar o container no seu PC

Com o Docker Desktop aberto, na pasta do projeto:

```
docker compose --profile app up --build
```

Abra **http://localhost:8080** e entre na demonstração. Na primeira vez o demo leva uns segundos para ser criado
(aparece `[jobs]` no terminal). Para parar: `Ctrl + C`.

## Render (grátis)

1. Suba o projeto para o GitHub.
2. Entre em https://render.com com a conta do GitHub.
3. **New → Blueprint** e escolha o repositório `VryGraphic`. O Render lê o `render.yaml` e cria:
   - o banco `vrygraphic-db` (Postgres);
   - o serviço `vrygraphic`, com `DATABASE_URL` ligado ao banco e um `JWT_SECRET` aleatório.
4. Clique em **Apply** e espere o primeiro deploy (uns 5 minutos).
5. Abra a URL do serviço (`https://vrygraphic-xxxx.onrender.com`) e entre na demonstração.

Bom saber:
- No plano grátis o serviço **dorme** depois de 15 minutos sem acesso; a primeira visita depois disso leva ~1 minuto.
  Ao acordar, o job roda em 10 s e lança as contas fixas que venceram enquanto ele dormia.
- O Postgres grátis do Render expira depois de 30 dias. Para algo permanente, use um Postgres grátis do
  [Neon](https://neon.tech) e coloque a URL dele em `DATABASE_URL` no painel do serviço.

## Variáveis de ambiente

| Variável | Para quê | Padrão |
|---|---|---|
| `DATABASE_URL` | Postgres | obrigatória |
| `JWT_SECRET` | assina os tokens (32+ caracteres) | obrigatória |
| `NODE_ENV` | `production` liga cookie seguro e serve o front | `production` na imagem |
| `JOBS_ENABLED` | contas fixas e alertas a cada hora | `true` |
| `DEMO_RESET` | recria o usuário demo todo dia | `false` (o blueprint liga) |
| `DEMO_RESET_HOUR` | hora do reset (São Paulo) | `4` |
| `PORT` | porta HTTP | `3333` (o Render define a dele) |
| `ANTHROPIC_API_KEY` | liga o Vry Agent (cada mensagem gasta créditos da sua conta) | vazia = agente desligado |
| `ANTHROPIC_MODEL` | modelo do agente | `claude-sonnet-5-5` |
| `AGENT_DAILY_LIMIT` | teto de mensagens ao agente por dia (todo mundo somado) | `300` |

O **Modo Dev** (terminal real) nunca liga em produção, mesmo com `DEV_TERMINAL=true`.

Num demo público, o agente usa a sua chave: o limite diário e o limite por pessoa (30 mensagens a cada 15 minutos)
seguram o custo. Para não gastar nada, deixe `ANTHROPIC_API_KEY` vazia; a aba mostra como ligar.
