import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // /api vai para a API local: o front e a API parecem a mesma origem (o cookie funciona).
    // ws: true também repassa o WebSocket do terminal do Modo Dev.
    proxy: { '/api': { target: 'http://localhost:3333', ws: true } },
  },
});
