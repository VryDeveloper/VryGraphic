import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

// terminal ligado só neste arquivo (o env é lido na importação)
vi.stubEnv('DEV_TERMINAL', 'true');
vi.mock('../src/lib/prisma', () => ({ prisma: {} }));
const { createApp } = await import('../src/app');
const { attachDevTerminal } = await import('../src/modules/dev/terminal');
const { signAccessToken } = await import('../src/modules/auth/tokens');

let port = 0;
let close: () => void;
beforeAll(async () => {
  const server = createApp().listen(0);
  attachDevTerminal(server);
  await new Promise((r) => server.once('listening', r));
  port = (server.address() as AddressInfo).port;
  close = () => server.close();
});
afterAll(() => close());

const token = signAccessToken({ sub: '00000000-0000-0000-0000-000000000001', email: 'a@a.dev', demo: false });
const open = (q: string, origin = 'http://localhost:5173') =>
  new Promise<{ ws?: WebSocket; status?: number }>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/v1/dev/terminal?${q}`, { headers: { Origin: origin } });
    ws.once('open', () => resolve({ ws }));
    ws.once('unexpected-response', (_req, res) => resolve({ status: res.statusCode }));
    ws.once('error', () => resolve({ status: -1 }));
  });

describe('terminal do Modo Dev', () => {
  it('abre um shell de verdade na pasta do projeto', async () => {
    const { ws } = await open(`token=${token}&cols=80&rows=24`);
    expect(ws).toBeDefined();
    let out = '';
    ws!.on('message', (d) => (out += String(d)));
    // o shell é o PowerShell no Windows e o bash no Linux/macOS: um comando para cada um
    const cmd = process.platform === 'win32' ? 'Write-Output ("vry-" + (40+2)); (Get-Item package.json).Name\r' : 'echo "vry-$((40+2))"; ls package.json\r';
    ws!.send(JSON.stringify({ type: 'input', data: cmd }));
    await vi.waitFor(() => expect(out).toContain('vry-42'), { timeout: 8000 });
    await vi.waitFor(() => expect(out).toMatch(/package\.json\s/), { timeout: 8000 });
    ws!.close();
  });

  it('recusa sem token, com token inválido e vindo de outro site', async () => {
    expect((await open('')).status).toBe(401);
    expect((await open('token=abc')).status).toBe(401);
    expect((await open(`token=${token}`, 'https://site-malicioso.com')).status).toBe(403);
    expect((await open(`token=${token}`, '')).status).toBe(403);
  });
});
