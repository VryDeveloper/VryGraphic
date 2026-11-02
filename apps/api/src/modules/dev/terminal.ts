import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { env } from '../../config/env';
import { verifyAccessToken } from '../auth/tokens';

/**
 * Modo Dev: um terminal de verdade (PTY) dentro do app, na pasta do projeto, para rodar o Claude Code.
 * É um shell com o poder do seu usuário, então só liga com TODAS as travas:
 *   1. DEV_TERMINAL=true no .env e fora de produção;
 *   2. conexão vinda da própria máquina (loopback);
 *   3. Origin do navegador = a página do app (outro site não abre o terminal pelo seu navegador);
 *   4. access token válido de quem está logado.
 */

const PATH = '/api/v1/dev/terminal';
const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

interface Pty { onData(cb: (d: string) => void): void; onExit(cb: () => void): void; write(d: string): void; resize(c: number, r: number): void; kill(): void }
interface PtyModule { spawn(file: string, args: string[], opts: Record<string, unknown>): Pty }

/** node-pty é dependência opcional (binário nativo). Sem ele o resto do app funciona normal. */
async function loadPty(): Promise<PtyModule | null> {
  for (const name of ['@homebridge/node-pty-prebuilt-multiarch', 'node-pty']) {
    try {
      const m = await import(name);
      return (m.default ?? m) as PtyModule;
    } catch {
      /* tenta o próximo */
    }
  }
  return null;
}

export function devTerminalEnabled() {
  return env.DEV_TERMINAL && env.NODE_ENV !== 'production';
}

function allowedOrigin(origin: string | undefined) {
  if (!origin) return false;
  const ok = new Set([env.WEB_ORIGIN, `http://localhost:${env.PORT}`, `http://127.0.0.1:${env.PORT}`, 'http://localhost:5173', 'http://127.0.0.1:5173']);
  return ok.has(origin);
}

function refuse(socket: Duplex, status: number, msg: string) {
  socket.write(`HTTP/1.1 ${status} ${msg}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

/** Ambiente do shell sem os segredos da API (o Claude Code usa o login dele, não a chave do agente). */
function shellEnv() {
  const e = { ...process.env };
  for (const k of ['JWT_SECRET', 'ANTHROPIC_API_KEY', 'DATABASE_URL']) delete e[k];
  return { ...e, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
}

export function attachDevTerminal(server: Server) {
  if (!devTerminalEnabled()) return;
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== PATH) return refuse(socket, 404, 'Not Found');
    if (!LOOPBACK.has(req.socket.remoteAddress ?? '')) return refuse(socket, 403, 'Forbidden');
    if (!allowedOrigin(req.headers.origin)) return refuse(socket, 403, 'Forbidden');
    try {
      verifyAccessToken(url.searchParams.get('token') ?? '');
    } catch {
      return refuse(socket, 401, 'Unauthorized');
    }
    const pty = await loadPty();
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (!pty) {
        ws.send('\r\n\x1b[33mnode-pty não está instalado.\x1b[0m Rode na pasta do projeto: npm install -w apps/api @homebridge/node-pty-prebuilt-multiarch\r\n');
        ws.close();
        return;
      }
      session(ws, pty, url);
    });
  });
  console.log('[dev] terminal ligado (só localhost)');
}

function session(ws: WebSocket, pty: PtyModule, url: URL) {
  const cols = Math.min(Math.max(Number(url.searchParams.get('cols')) || 100, 20), 400);
  const rows = Math.min(Math.max(Number(url.searchParams.get('rows')) || 30, 5), 200);
  const win = process.platform === 'win32';
  const shell = win ? 'powershell.exe' : process.env.SHELL || 'bash';
  const term = pty.spawn(shell, win ? ['-NoLogo'] : [], { name: 'xterm-256color', cols, rows, cwd: ROOT, env: shellEnv() });

  term.onData((d) => ws.readyState === ws.OPEN && ws.send(d));
  term.onExit(() => ws.readyState === ws.OPEN && ws.close());
  if (url.searchParams.get('mode') === 'claude') setTimeout(() => term.write('claude\r'), 400);

  ws.on('message', (raw) => {
    try {
      const m = JSON.parse(String(raw)) as { type: 'input'; data: string } | { type: 'resize'; cols: number; rows: number };
      if (m.type === 'input' && typeof m.data === 'string') term.write(m.data);
      else if (m.type === 'resize') term.resize(Math.min(Math.max(m.cols | 0, 20), 400), Math.min(Math.max(m.rows | 0, 5), 200));
    } catch {
      /* mensagem inválida: ignora */
    }
  });
  ws.on('close', () => term.kill());
}
