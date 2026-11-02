import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TabId } from './Shell';
import type { TourStep } from './tourSteps';

interface Rect { top: number; left: number; width: number; height: number }
const PAD = 8;
const MOBILE = 700;

/** Espera o elemento aparecer (a aba pode estar carregando dados) por até 2,5 s. */
function waitFor(target: string, timeout = 2500): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const started = performance.now();
    const look = () => {
      const el = find(target);
      if (el && el.getBoundingClientRect().height > 0) return resolve(el);
      if (performance.now() - started > timeout) return resolve(null);
      setTimeout(look, 80);
    };
    look();
  });
}

const find = (target: string) => document.querySelector<HTMLElement>(`[data-tour="${target}"]`);

/** Área destacada, presa à janela (um painel mais alto que a tela fica recortado). */
function measure(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  const top = Math.max(r.top - PAD, 4);
  const bottom = Math.min(r.bottom + PAD, window.innerHeight - 4);
  const left = Math.max(r.left - PAD, 4);
  const right = Math.min(r.right + PAD, window.innerWidth - 4);
  return { top, left, width: right - left, height: Math.max(bottom - top, 24) };
}

/**
 * Guia de primeiro uso. Para cada passo: abre a aba certa, espera o elemento existir, rola até ele,
 * escurece o resto da tela e põe o cartão de explicação ao lado. Setas do teclado navegam, Esc pula.
 */
export function Tour(props: { steps: TourStep[]; onTab: (t: TabId) => void; onClose: (completed: boolean) => void }) {
  const { steps, onTab, onClose } = props;
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [card, setCard] = useState<{ top: number; left: number } | null>(null);
  const [ready, setReady] = useState(false);
  const el = useRef<HTMLElement | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const nextBtn = useRef<HTMLButtonElement>(null);
  const step = steps[i];
  const last = i === steps.length - 1;

  // abre a aba e encontra o alvo
  useEffect(() => {
    let alive = true;
    setReady(false);
    if (step.tab) onTab(step.tab);
    if (!step.target) {
      el.current = null;
      setRect(null);
      setReady(true);
      return;
    }
    waitFor(step.target).then((found) => {
      if (!alive) return;
      el.current = found;
      if (!found) {
        setRect(null);
        setReady(true);
        return;
      }
      const r = found.getBoundingClientRect();
      // no celular o cartão fica embaixo da tela: o alvo vai para o topo
      const tall = r.height > window.innerHeight * 0.6 || window.innerWidth <= MOBILE;
      found.scrollIntoView({ block: tall ? 'start' : 'center', behavior: 'smooth' });
      setTimeout(() => {
        if (!alive) return;
        setRect(measure(found));
        setReady(true);
      }, 420);
    });
    return () => {
      alive = false;
    };
  }, [step, onTab]);

  // acompanha rolagem, redimensionamento e mudanças na tela (se o painel for redesenhado, acha de novo)
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (el.current && !el.current.isConnected && step.target) el.current = find(step.target);
        if (el.current) setRect(measure(el.current));
      });
    };
    const ticker = setInterval(update, 500);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      clearInterval(ticker);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      cancelAnimationFrame(frame);
    };
  }, [step]);

  // posiciona o cartão: embaixo do alvo, ou em cima, ou no canto; no celular, sempre embaixo da tela
  useLayoutEffect(() => {
    const c = cardRef.current;
    if (!c || !ready) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w <= MOBILE || !rect) {
      setCard(null);
      return;
    }
    const ch = c.offsetHeight;
    const cw = c.offsetWidth;
    const gap = 14;
    const clampLeft = (x: number) => Math.min(Math.max(x, 16), w - cw - 16);
    const clampTop = (y: number) => Math.min(Math.max(y, 16), h - ch - 16);
    if (rect.top + rect.height + gap + ch < h - 8) setCard({ top: rect.top + rect.height + gap, left: clampLeft(rect.left) });
    else if (rect.top - gap - ch > 8) setCard({ top: rect.top - gap - ch, left: clampLeft(rect.left) });
    // alvo alto demais: cartão ao lado, se couber
    else if (rect.left + rect.width + gap + cw < w - 8) setCard({ top: clampTop(rect.top + 40), left: rect.left + rect.width + gap });
    else if (rect.left - gap - cw > 8) setCard({ top: clampTop(rect.top + 40), left: rect.left - gap - cw });
    else setCard({ top: h - ch - 16, left: w - cw - 16 });
  }, [rect, ready, i]);

  useEffect(() => {
    if (ready) nextBtn.current?.focus({ preventScroll: true });
  }, [ready, i]);

  const next = useCallback(() => (last ? onClose(true) : setI((n) => n + 1)), [last, onClose]);
  const back = useCallback(() => setI((n) => Math.max(0, n - 1)), []);

  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose(false);
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') back();
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  }, [next, back, onClose]);

  const welcome = i === 0;
  const centered = !rect;

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-t" aria-describedby="tour-b">
      {/* camada que bloqueia cliques no app durante o guia */}
      <div className={`tour-shade ${centered ? 'full' : ''}`} />
      {rect && <div className="tour-spot" style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }} aria-hidden="true" />}
      <div
        ref={cardRef}
        key={i}
        className={`tour-card mono ${centered ? 'center' : ''} ${welcome ? 'welcome' : ''}`}
        style={card ? { top: card.top, left: card.left } : undefined}
        data-ready={ready}
      >
        {welcome && <p className="tour-brand">VRYGRAPHIC</p>}
        <p className="label tour-count">{welcome ? 'GUIA RÁPIDO · 1 MINUTO' : `${i} DE ${steps.length - 1}`}</p>
        <h2 id="tour-t">{step.title}</h2>
        <p id="tour-b" className="tour-body">{step.body}</p>
        {!welcome && (
          <div className="tour-dots" aria-hidden="true">
            {steps.slice(1).map((_, k) => <span key={k} className={k + 1 <= i ? 'on' : ''} />)}
          </div>
        )}
        <div className="tour-actions">
          {welcome ? (
            <>
              <button type="button" className="act" onClick={() => onClose(false)}>agora não</button>
              <button ref={nextBtn} type="button" className="btn sm" onClick={next}>começar o tour →</button>
            </>
          ) : (
            <>
              <button type="button" className="act" onClick={() => onClose(false)}>pular guia</button>
              <span style={{ flex: 1 }} />
              <button type="button" className="btn ghost sm" onClick={back}>← voltar</button>
              <button ref={nextBtn} type="button" className="btn sm" onClick={next}>{last ? 'começar a usar' : 'próximo →'}</button>
            </>
          )}
        </div>
        {!welcome && <p className="label tour-keys hide-s">← → navegam · Esc pula</p>}
      </div>
    </div>
  );
}
