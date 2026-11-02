# Imagem única: API + front compilado. Sobe aplicando as migrações e depois a API.
FROM node:22-slim

# o Prisma precisa do OpenSSL
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# 1) dependências primeiro (camada em cache enquanto os package.json não mudam)
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/api/prisma apps/api/prisma
# --omit=optional: o terminal nativo do Modo Dev (node-pty) não vai para produção
RUN npm ci --omit=optional

# 2) código e build do front
COPY . .
RUN npm run build -w apps/web

ENV NODE_ENV=production
ENV PORT=3333
EXPOSE 3333

# migrações são idempotentes: rodar a cada deploy só aplica as novas
CMD ["sh", "-c", "npm run db:deploy -w apps/api && npm run start -w apps/api"]
