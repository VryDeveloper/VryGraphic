// Testes de integração contra um Postgres de verdade: npm run test:db
// Usa um banco SEPARADO (vrygraphic_test) no mesmo container, então seus dados de desenvolvimento ficam intactos.
import { execSync } from 'node:child_process';

const TEST_URL = 'postgresql://vry:vry@localhost:5433/vrygraphic_test?schema=public';
const run = (cmd, env = {}) => execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...env } });
const quiet = (cmd) => execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();

try {
  quiet('docker exec vrygraphic-db pg_isready -U vry');
} catch {
  console.error('\n  O banco não está rodando. Abra o Docker Desktop e rode: npm run db:up\n');
  process.exit(1);
}

const exists = quiet(`docker exec vrygraphic-db psql -U vry -d vrygraphic -tAc "SELECT 1 FROM pg_database WHERE datname = 'vrygraphic_test'"`);
if (exists !== '1') {
  console.log('› Criando o banco de teste vrygraphic_test');
  quiet('docker exec vrygraphic-db createdb -U vry vrygraphic_test');
}

console.log('› Aplicando as migrações no banco de teste');
run('npm run db:deploy -w apps/api', { DATABASE_URL: TEST_URL });

console.log('› Rodando os testes da API com o banco');
run('npm run test -w apps/api', { TEST_DATABASE_URL: TEST_URL });
