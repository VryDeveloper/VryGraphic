/**
 * Seed: recria o usuário demo com 12 meses de lançamentos, faturas, orçamentos e uma meta.
 * Login demo: demo@vrygraphic.dev / demo12345
 */
import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { DEMO_EMAIL, DEMO_PASSWORD, resetDemo } from '../src/modules/demo/write';

const started = Date.now();
resetDemo()
  .then((r) => {
    console.log(`Usuário demo pronto: ${DEMO_EMAIL} (senha: ${DEMO_PASSWORD})`);
    console.log(`  ${r.transactions} lançamentos em 12 meses · ${((Date.now() - started) / 1000).toFixed(1)} s`);
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
