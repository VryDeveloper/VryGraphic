// Roda antes de cada arquivo de teste. Com TEST_DATABASE_URL, a API aponta para o banco de TESTE
// (nunca o de desenvolvimento) e os testes de integração rodam; sem ela, eles são pulados.
process.env.NODE_ENV = 'test';
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
// nunca usar uma chave real da Anthropic nos testes: o agente roda com um modelo simulado
delete process.env.ANTHROPIC_API_KEY;
process.env.JOBS_ENABLED = 'false';
