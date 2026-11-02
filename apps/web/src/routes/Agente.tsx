import { useEffect, useRef, useState, type FormEvent } from 'react';
import * as api from '../lib/api';

type Line =
  | { kind: 'user'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string; ok: boolean; summary: string }
  | { kind: 'approval'; preview: string; answer?: 's' | 'n' }
  | { kind: 'error'; text: string };

const SUGGESTIONS = [
  'quanto gastei com alimentação este mês?',
  'estou estourando algum orçamento?',
  'lança padaria 18,90 hoje',
  'quanto falta para a reserva? e se eu guardar 1.200 por mês?',
];
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function Agente({ onDataChanged }: { onDataChanged?: () => void }) {
  const [status, setStatus] = useState<api.AgentStatus | null>(null);
  const [mode, setMode] = useState<'agent' | 'dev'>('agent');
  useEffect(() => {
    api.agentStatus().then(setStatus).catch(() => undefined);
  }, []);

  return (
    <>
      <div className="page-head">
        <h1>Agente</h1>
        <div className="seg mono" role="group" aria-label="Modo" data-tour="agente">
          <button type="button" aria-pressed={mode === 'agent'} onClick={() => setMode('agent')}>vry agent</button>
          <button type="button" aria-pressed={mode === 'dev'} onClick={() => setMode('dev')} title={status?.dev.reason ?? undefined}>dev · local</button>
        </div>
      </div>
      <section className="panel term-panel" aria-label={mode === 'agent' ? 'Terminal do Vry Agent' : 'Terminal do Modo Dev'}>
        {mode === 'agent' ? <AgentTerminal status={status} onDataChanged={onDataChanged} /> : <DevTerminal status={status} />}
      </section>
    </>
  );
}

// ───────────────────────── Vry Agent ─────────────────────────

function AgentTerminal({ status, onDataChanged }: { status: api.AgentStatus | null; onDataChanged?: () => void }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [waiting, setWaiting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [frame, setFrame] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const screen = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setFrame((f) => (f + 1) % SPINNER.length), 80);
    return () => clearInterval(t);
  }, [busy]);

  useEffect(() => {
    screen.current?.scrollTo({ top: screen.current.scrollHeight, behavior: reduced ? 'auto' : 'smooth' });
  }, [lines, busy]);

  function absorb(r: api.AgentReply) {
    setSessionId(r.sessionId);
    setWaiting(r.waiting);
    const wrote = r.events.some((e) => e.type === 'tool' && e.ok && ['lancar', 'excluir_lancamento', 'transferir', 'definir_orcamento', 'ajustar_meta'].includes(e.name));
    if (wrote) onDataChanged?.();
    setLines((ls) => [
      ...ls,
      ...r.events.map((e): Line => (e.type === 'text' ? { kind: 'text', text: e.text } : e.type === 'tool' ? { kind: 'tool', name: e.name, ok: e.ok, summary: e.summary } : { kind: 'approval', preview: e.preview })),
    ]);
  }

  async function run(fn: () => Promise<api.AgentReply>) {
    setBusy(true);
    try {
      absorb(await fn());
    } catch (e) {
      setLines((ls) => [...ls, { kind: 'error', text: (e as api.ApiError).message ?? 'erro' }]);
    } finally {
      setBusy(false);
      setTimeout(() => input.current?.focus(), 0);
    }
  }

  function submit(e?: FormEvent, preset?: string) {
    e?.preventDefault();
    const t = (preset ?? text).trim();
    if (!t || busy) return;
    if (waiting) return answer(t);
    setText('');
    setLines((ls) => [...ls, { kind: 'user', text: t }]);
    run(() => api.agentSend(t, sessionId));
  }

  function answer(raw: string) {
    const a = raw.trim().toLowerCase();
    if (!['s', 'n', 'sim', 'não', 'nao'].includes(a)) {
      setLines((ls) => [...ls, { kind: 'error', text: 'responda s ou n' }]);
      setText('');
      return;
    }
    const approve = a.startsWith('s');
    setText('');
    setLines((ls) => {
      const copy = [...ls];
      for (let k = copy.length - 1; k >= 0; k--) {
        const l = copy[k];
        if (l.kind === 'approval' && !l.answer) {
          copy[k] = { ...l, answer: approve ? 's' : 'n' };
          break;
        }
      }
      return copy;
    });
    run(() => api.agentDecide(sessionId!, approve));
  }

  function reset() {
    if (sessionId) api.agentReset(sessionId).catch(() => undefined);
    setSessionId(undefined);
    setWaiting(false);
    setLines([]);
  }

  if (status && !status.agent.enabled) return <AgentSetup />;

  return (
    <div className="term">
      <div className="term-bar mono">
        <span><span className="gain">●</span> VRY AGENT <span className="label">· Powered by Claude</span></span>
        <span className="label hide-s">só lê e grava os seus dados, e pede [s/n] antes de gravar</span>
        {lines.length > 0 && <button type="button" className="act" onClick={reset}>nova conversa</button>}
      </div>
      <div className="term-screen mono" ref={screen} aria-live="polite">
        {lines.length === 0 && (
          <div className="term-hello">
            <p className="gain">vry agent v1 · pronto</p>
            <p className="label">Pergunte sobre seus gastos, orçamentos e metas, ou peça para lançar algo. Exemplos:</p>
            <div className="chips">
              {SUGGESTIONS.map((s) => <button key={s} type="button" className="chip" onClick={() => submit(undefined, s)}>{s}</button>)}
            </div>
          </div>
        )}
        {lines.map((l, i) => <TermLine key={i} line={l} last={i === lines.length - 1} />)}
        {busy && <p className="label term-busy">{reduced ? '…' : SPINNER[frame]} pensando</p>}
      </div>
      <form className="term-input mono" onSubmit={submit}>
        <span className={waiting ? 'warn' : 'gain'}>{waiting ? '[s/n] ›' : 'vry ›'}</span>
        <input
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // no [s/n] basta apertar a tecla
            if (waiting && !busy && (e.key === 's' || e.key === 'n') && !text) {
              e.preventDefault();
              answer(e.key);
            }
          }}
          placeholder={waiting ? 's para confirmar, n para recusar' : 'pergunte algo…'}
          disabled={busy}
          maxLength={1000}
          aria-label={waiting ? 'Confirmar: s ou n' : 'Mensagem para o agente'}
          autoComplete="off"
          spellCheck={false}
        />
        {waiting && !busy && (
          <span className="yn">
            <button type="button" className="btn sm" onClick={() => answer('s')}>s · confirmar</button>
            <button type="button" className="btn ghost sm" onClick={() => answer('n')}>n</button>
          </span>
        )}
      </form>
    </div>
  );
}

function TermLine({ line, last }: { line: Line; last: boolean }) {
  switch (line.kind) {
    case 'user':
      return <p className="tl user"><span className="gain">vry ›</span> {line.text}</p>;
    case 'tool':
      return <p className={`tl tool ${line.ok ? '' : 'bad'}`}>  ⎿ <span className="tool-name">{line.name}</span> · {line.summary} {line.ok ? <span className="gain">✓</span> : <span className="over">✗</span>}</p>;
    case 'approval':
      return (
        <div className="tl approval">
          <p><span className="warn">?</span> {line.preview}</p>
          <p className="label">{line.answer === 's' ? <span className="gain">✓ confirmado</span> : line.answer === 'n' ? <span className="over">✗ recusado</span> : 'confirmar? [s/n]'}</p>
        </div>
      );
    case 'error':
      return <p className="tl over">✗ {line.text}</p>;
    default:
      return <Typed text={line.text} animate={last} />;
  }
}

/** Texto do agente aparecendo como num terminal (sem animação se a pessoa pediu menos movimento). */
function Typed({ text, animate }: { text: string; animate: boolean }) {
  const [n, setN] = useState(animate && !reduced ? 0 : text.length);
  useEffect(() => {
    if (n >= text.length) return;
    const t = setTimeout(() => setN((x) => Math.min(text.length, x + Math.max(2, Math.ceil(text.length / 90)))), 12);
    return () => clearTimeout(t);
  }, [n, text]);
  return <p className="tl text">{text.slice(0, n)}{n < text.length && <span className="caret">▍</span>}</p>;
}

function AgentSetup() {
  return (
    <div className="term">
      <div className="term-bar mono"><span><span className="label">●</span> VRY AGENT <span className="label">· Powered by Claude</span></span></div>
      <div className="term-screen mono setup">
        <p className="warn">agente desligado: falta a chave da API da Anthropic</p>
        <ol>
          <li>Crie uma chave em <a href="https://platform.claude.com" target="_blank" rel="noreferrer">platform.claude.com</a> (API Keys).</li>
          <li>Abra <code>apps/api/.env</code> e adicione a linha <code>ANTHROPIC_API_KEY=sua-chave</code>.</li>
          <li>Pare e rode de novo <code>npm run dev</code>.</li>
        </ol>
        <p className="label">O agente só consegue usar ferramentas deste app (ler e gravar os seus lançamentos, orçamentos e metas) e pede [s/n] antes de gravar qualquer coisa. Cada mensagem gasta créditos da sua conta da API; há limite por pessoa e por dia.</p>
      </div>
    </div>
  );
}

// ───────────────────────── Modo Dev ─────────────────────────

function DevTerminal({ status }: { status: api.AgentStatus | null }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'idle' | 'open' | 'closed'>('idle');
  const cleanup = useRef<() => void>();

  useEffect(() => () => cleanup.current?.(), []);

  async function connect(mode: 'shell' | 'claude') {
    cleanup.current?.();
    const [{ Terminal }, { FitAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit'), import('@xterm/xterm/css/xterm.css')]);
    const term = new Terminal({
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      fontSize: 13,
      cursorBlink: true,
      theme: { background: '#040705', foreground: '#d8e2dc', cursor: '#43b883', selectionBackground: '#22302a', green: '#43b883', brightGreen: '#56c596', red: '#e8896f', yellow: '#e5c17a' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current!);
    fit.fit();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/v1/dev/terminal?token=${encodeURIComponent(api.getAccessToken() ?? '')}&cols=${term.cols}&rows=${term.rows}&mode=${mode}`);
    ws.onopen = () => {
      setState('open');
      term.focus();
    };
    ws.onmessage = (e) => term.write(typeof e.data === 'string' ? e.data : '');
    ws.onclose = () => {
      setState('closed');
      term.write('\r\n\x1b[90m[conexão encerrada]\x1b[0m\r\n');
    };
    const input = term.onData((data) => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ type: 'input', data })));
    const onResize = () => {
      fit.fit();
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    };
    window.addEventListener('resize', onResize);
    cleanup.current = () => {
      window.removeEventListener('resize', onResize);
      input.dispose();
      ws.close();
      term.dispose();
    };
  }

  if (status && !status.dev.enabled) {
    return (
      <div className="term">
        <div className="term-bar mono"><span><span className="label">●</span> MODO DEV <span className="label">· terminal local</span></span></div>
        <div className="term-screen mono setup">
          <p className="warn">modo dev desligado: {status.dev.reason}</p>
          <p className="label">Um terminal de verdade dentro do app, na pasta do projeto, para rodar o Claude Code e trabalhar no próprio VryGraphic. Por segurança só funciona no seu PC:</p>
          <ol>
            <li>No <code>apps/api/.env</code>, adicione <code>DEV_TERMINAL=true</code>.</li>
            <li>Pare e rode de novo <code>npm run dev</code>.</li>
            <li>Volte aqui e clique em <b>abrir Claude Code</b> (precisa do Claude Code instalado no PC).</li>
          </ol>
          <p className="label">Nunca liga em produção, só aceita conexões da própria máquina vindas desta página, e exige login.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="term">
      <div className="term-bar mono">
        <span><span className={state === 'open' ? 'gain' : 'label'}>●</span> MODO DEV <span className="label">· terminal local na pasta do projeto</span></span>
        <span className="term-actions">
          <button type="button" className="btn sm" onClick={() => connect('claude')}>abrir Claude Code</button>
          <button type="button" className="btn ghost sm" onClick={() => connect('shell')}>abrir shell</button>
        </span>
      </div>
      {state === 'idle' && <p className="label mono" style={{ padding: 16, margin: 0 }}>Escolha abrir o Claude Code ou um shell. O terminal roda no seu PC, na pasta do VryGraphic.</p>}
      {/* o xterm desenha aqui dentro; o React não coloca nada neste div */}
      <div className="xterm-host" ref={host} />
    </div>
  );
}
