import { useCallback, useEffect, useState } from 'react';
import * as api from './lib/api';
import { Login } from './routes/Login';
import { Transacoes } from './routes/Transacoes';
import { Agente } from './routes/Agente';
import { Contas } from './routes/Contas';
import { Plano } from './routes/Plano';
import { VisaoGeral } from './routes/VisaoGeral';
import { Shell, type TabId, type TickerItem } from './ui/Shell';
import { Tour } from './ui/Tour';
import { TOUR_STEPS } from './ui/tourSteps';

/** O demo é compartilhado: para ele, "já vi o guia" fica neste navegador. */
const DEMO_KEY = 'vry:guia-visto';
const demoSeen = () => {
  try {
    return localStorage.getItem(DEMO_KEY) === '1';
  } catch {
    return false;
  }
};

function Footer() {
  const [h, setH] = useState<{ api: 'up' | 'down' | '...'; db: 'up' | 'down' | '...' }>({ api: '...', db: '...' });
  useEffect(() => {
    api.health().then((r) => setH({ api: 'up', db: r.db })).catch(() => setH({ api: 'down', db: 'down' }));
  }, []);
  const cls = (v: string) => `dot ${v === 'up' ? 'up' : v === 'down' ? 'down' : ''}`;
  return (
    <footer className="footer" aria-label="Status dos serviços">
      <span><span className={cls(h.api)} />API {h.api}</span>
      <span><span className={cls(h.db)} />BANCO {h.db}</span>
      <span>VryGraphic · v1.0</span>
    </footer>
  );
}

export function App() {
  const [user, setUser] = useState<api.User | null>(null);
  const [checking, setChecking] = useState(true);
  const [tab, setTab] = useState<TabId>('visao');
  const [ticker, setTicker] = useState<TickerItem[] | null>(null);
  const onTicker = useCallback((t: TickerItem[] | null) => setTicker(t), []);
  const [unread, setUnread] = useState(0);
  const [touring, setTouring] = useState(false);

  // primeiro acesso: abre o guia sozinho (uma vez por conta; no demo, uma vez por navegador)
  useEffect(() => {
    if (user && (user.isDemo ? !demoSeen() : !user.onboarded)) setTouring(true);
  }, [user]);

  const finishTour = useCallback(
    (completed: boolean) => {
      setTouring(false);
      if (completed) setTab('visao');
      if (!user) return;
      if (user.isDemo) {
        try {
          localStorage.setItem(DEMO_KEY, '1');
        } catch {
          /* navegador sem armazenamento: o guia volta no próximo acesso */
        }
      } else if (!user.onboarded) {
        api.setOnboarding(true).catch(() => undefined);
        setUser({ ...user, onboarded: true });
      }
    },
    [user],
  );
  const tourTab = useCallback((t: TabId) => setTab(t), []);
  const onAlertsSeen = useCallback(() => setUnread(0), []);
  const goTransactions = useCallback(() => setTab('transacoes'), []);

  // contador de alertas: ao entrar, ao trocar de aba e a cada 5 minutos
  useEffect(() => {
    if (!user) return;
    const load = () => api.alerts().then((r) => setUnread(r.unread)).catch(() => undefined);
    load();
    const t = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [user, tab]);

  useEffect(() => {
    api.restoreSession().then((u) => {
      setUser(u);
      setChecking(false);
    });
  }, []);

  if (checking) return <p className="mono label" style={{ padding: 18 }}>$ carregando sessão…</p>;

  if (!user) return (<><Login onLogin={setUser} /><Footer /></>);

  return (
    <Shell tab={tab} onTab={setTab} userName={user.name} ticker={tab === 'visao' ? ticker : null} unread={unread} onGuide={() => setTouring(true)} onLogout={async () => { await api.logout(); setUser(null); setTab('visao'); }}>
      {tab === 'visao' && <VisaoGeral onTicker={onTicker} onGoTransactions={goTransactions} onAlertsSeen={onAlertsSeen} />}
      {tab === 'transacoes' && <Transacoes />}
      {tab === 'plano' && <Plano />}
      {tab === 'contas' && <Contas />}
      {tab === 'agente' && <Agente onDataChanged={() => api.alerts().then((r) => setUnread(r.unread)).catch(() => undefined)} />}
      <Footer />
      {touring && <Tour steps={TOUR_STEPS} onTab={tourTab} onClose={finishTour} />}
    </Shell>
  );
}
