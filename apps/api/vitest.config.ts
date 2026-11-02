import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['test/setup-env.ts'],
    // os testes de integração dividem o mesmo banco: um arquivo por vez
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
