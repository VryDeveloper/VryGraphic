import type { ReactNode } from 'react';

export type TabId = 'visao' | 'transacoes' | 'plano' | 'contas' | 'agente';

const TABS: { id: TabId; n: number; label: string; ready: boolean; phase?: string }[] = [
  { id: 'visao', n: 1, label: 'VISÃO GERAL', ready: true },
  { id: 'transacoes', n: 2, label: 'TRANSAÇÕES', ready: true },
  { id: 'plano', n: 3, label: 'PLANO', ready: true },
  { id: 'contas', n: 4, label: 'CONTAS', ready: true },
  { id: 'agente', n: 5, label: 'AGENTE', ready: true },
];

export type TickerItem = [label: string, value: string, positive: boolean];

/** Faixa padrão (fora da Visão geral, que mostra os números do mês): a stack e o que está por trás. */
const PROJECT_TICKER: TickerItem[] = [
  ['STACK', 'REACT · EXPRESS · POSTGRESQL', true],
  ['TESTES', '124 PASSANDO', true],
  ['SQL', 'WINDOW FUNCTIONS', true],
  ['AUTH', 'JWT + REFRESH ROTATIVO', false],
  ['DINHEIRO', 'CENTAVOS INTEIROS', false],
  ['JOBS', 'CONTAS FIXAS + ALERTAS', true],
  ['AGENTE', 'POWERED BY CLAUDE', true],
];

export function Ticker({ items: custom }: { items?: TickerItem[] | null }) {
  const base = custom?.length ? custom : PROJECT_TICKER;
  const items = [...base, ...base];
  return (
    <div className="ticker" aria-label="Números do mês" data-tour="ticker">
      <span className="brand">VRYGRAPHIC</span>
      <div style={{ overflow: 'hidden', flex: 1 }}>
        <div className="track">
          {items.map(([k, v, g], i) => (
            <span key={i}>
              <span className="label">{k}</span> <span className={g ? 'gain' : ''}>{v}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Shell(props: { tab: TabId; onTab: (t: TabId) => void; userName: string; onLogout: () => void; ticker?: TickerItem[] | null; unread?: number; onGuide?: () => void; children: ReactNode }) {
  return (
    <div style={{ minHeight: '100svh' }}>
      <Ticker items={props.ticker} />
      <nav className="bar" aria-label="Principal">
        <div className="tabs" role="tablist" data-tour="abas">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              className="tab"
              aria-selected={props.tab === t.id}
              disabled={!t.ready}
              title={t.ready ? undefined : `Chega na ${t.phase}`}
              onClick={() => props.onTab(t.id)}
            >
              <span className="n">{t.n}</span>
              {t.label}
            </button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        {Boolean(props.unread) && (
          <button type="button" className="chip bell" onClick={() => props.onTab('visao')} aria-label={`${props.unread} alertas não lidos`}>
            <span className="dot up" aria-hidden="true" />{props.unread} {props.unread === 1 ? 'alerta' : 'alertas'}
          </button>
        )}
        {props.onGuide && (
          <button type="button" className="chip guide-btn" onClick={props.onGuide} data-tour="guia" title="Rever o guia de uso">? GUIA</button>
        )}
        <span className="mono hide-s label">{props.userName.toUpperCase()}</span>
        <button type="button" className="chip" onClick={props.onLogout}>SAIR</button>
      </nav>
      {props.children}
    </div>
  );
}
