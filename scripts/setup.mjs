// Prepara tudo com um comando: npm run setup
// 1) cria apps/api/.env a partir do exemplo  2) sobe o Postgres no Docker
// 3) espera o banco ficar pronto  4) aplica as migrações  5) cria o usuário demo
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';

const run = (cmd) => execSync(cmd, { stdio: 'inherit' });
const step = (msg) => console.log(`\n\x1b[32m›\x1b[0m ${msg}`);

step('Arquivo de configuração');
if (!existsSync('apps/api/.env')) {
  copyFileSync('apps/api/.env.example', 'apps/api/.env');
  console.log('  apps/api/.env criado a partir do .env.example');
} else console.log('  apps/api/.env já existe, mantido');

step('Conferindo o Docker');
try {
  execSync('docker info', { stdio: 'ignore' });
  console.log('  Docker rodando');
} catch {
  console.error(`
  \x1b[33mO Docker Desktop não está rodando.\x1b[0m
  1. Abra o Docker Desktop pelo menu Iniciar.
  2. Espere aparecer "Engine running" no canto inferior esquerdo (pode levar 1 minuto).
  3. Rode de novo: npm run setup
`);
  process.exit(1);
}

step('Subindo o Postgres no Docker');
run('docker compose up -d');

step('Esperando o banco responder');
for (let i = 1; i <= 30; i++) {
  try {
    execSync('docker exec vrygraphic-db pg_isready -U vry -d vrygraphic', { stdio: 'ignore' });
    console.log('  banco pronto');
    break;
  } catch {
    if (i === 30) throw new Error('O banco não respondeu em 30 s. O Docker Desktop está aberto?');
    await new Promise((r) => setTimeout(r, 1000));
  }
}

step('Criando as tabelas (migrações)');
run('npm run db:deploy -w apps/api');

step('Criando o usuário demo');
run('npm run db:seed -w apps/api');

console.log('\n\x1b[32mPronto!\x1b[0m Agora rode: npm run dev  e abra http://localhost:5173\n');
