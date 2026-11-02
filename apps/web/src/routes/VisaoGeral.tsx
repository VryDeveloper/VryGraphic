import { useEffect, useMemo, useRef, useState } from 'react';
import { addMonths, formatPlain, todayISO } from '@vrygraphic/shared';
import * as api from '../lib/api';
import { fmtDay, fmtMonth, fmtMonthLong, fmtMonthTag, pct } from '../lib/format';
import type { TickerItem } from '../ui/Shell';

const WEEKDAYS = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM'];

/** Itens da faixa de cima (ticker) a partir dos números do mês. */
export function tickerFrom(d: api.Dashboard): TickerItem[] {
  const card = d.accounts.find((a) => a.kind === 'CREDIT_CARD');
  const goal = d.goals[0];
  const proj = d.netWorth.projection[d.netWorth.projection.length - 1];
  const sign = (v: number) => (v >= 0 ? '+' : '');
  return [
    ['PATRIMÔNIO', formatPlain(d.kpis.netWorthCents), true],
    ['Δ MÊS', `${sign(d.kpis.netWorthChangeCents)}${formatPlain(d.kpis.netWorthChangeCents)}`, d.kpis.netWorthChangeCents >= 0],
    ['TAXA POUP.', pct(d.kpis.savingsRate), d.kpis.savingsRate > 0],
    ['GASTOS', formatPlain(d.kpis.expenseCents), false],
    ...(d.kpis.budgetUse !== null ? [['ORÇ. USO', pct(d.kpis.budgetUse), d.kpis.budgetUse < 1] as TickerItem] : []),
    ...(card ? [[`LIVRE ${card.name.toUpperCase()}`, formatPlain(card.availableCents ?? 0), false] as TickerItem] : []),
    ...(goal ? [[goal.name.split(' ')[0].toUpperCase(), pct(goal.progress), true] as TickerItem] : []),
    ...(proj ? [[`PROJ. ${fmtMonthTag(proj.month)}`, formatPlain(proj.expectedCents), true] as TickerItem] : []),
    [`VENCE ${fmtMonthTag(d.bills.month)}`, formatPlain(d.bills.totalCents), false],
  ];
}

export function VisaoGeral(props: { onTicker: (items: TickerItem[] | null) => void; onGoTransactions: () => void; onAlertsSeen: () => void }) {
  const today = todayISO();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [data, setData] = useState<api.Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  // callbacks do pai num ref: a busca dos painéis depende SÓ do mês (se dependesse das funções,
  // cada render do App criaria uma função nova e buscaria de novo, em loop)
  const cb = useRef(props);
  cb.current = props;

  useEffect(() => {
    let alive = true;
    let readTimer: ReturnType<typeof setTimeout> | undefined;
    setError(null);
    api
      .dashboard(month)
      .then((d) => {
        if (!alive) return;
        setData(d);
        cb.current.onTicker(tickerFrom(d));
        // os alertas estão na tela: depois de alguns segundos contam como lidos
        if (d.unreadAlerts) readTimer = setTimeout(() => api.readAlerts().then(() => cb.current.onAlertsSeen()).catch(() => undefined), 4000);
      })
      .catch((e: api.ApiError) => alive && setError(e.message));
    return () => {
      alive = false;
      clearTimeout(readTimer);
    };
  }, [month]);

  useEffect(() => () => cb.current.onTicker(null), []);

  const isCurrent = month === today.slice(0, 7);

  return (
    <>
      <div className="page-head">
        <h1>Visão geral · {fmtMonthLong(month)}</h1>
        <div className="month-nav mono" data-tour="meses">
          <span className="label hide-s">
            <span className="live-dot" aria-hidden="true" /> calculado no PostgreSQL{data ? ` · ${data.kpis.txCount} lançamentos no mês` : ''}
          </span>
          <button type="button" className="chip" onClick={() => setMonth(addMonths(month, -1))} aria-label="Mês anterior">‹</button>
          <button type="button" className="chip" onClick={() => setMonth(addMonths(month, 1))} disabled={isCurrent} aria-label="Próximo mês">›</button>
        </div>
      </div>

      {error ? (
        <p className="err" role="alert" style={{ padding: 18 }}>{error}</p>
      ) : !data || data.month !== month ? (
        <p className="label mono" style={{ padding: 18 }}>$ calculando painéis…</p>
      ) : (
        <div className="g" key={month}>
          <DailyPanel d={data} />
          <AllocationPanel d={data} />
          <NetWorthPanel d={data} />
          <HeatPanel d={data} />
          <FlowPanel d={data} onMore={props.onGoTransactions} />
          <BillsPanel d={data} />
          <AlertsPanel d={data} />
        </div>
      )}
    </>
  );
}

function PanelHead(props: { id: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="ph">
      <h2 id={props.id}>{props.title}</h2>
      {props.children && <div className="ph-r mono">{props.children}</div>}
    </div>
  );
}

/** Saldo diário da conta corrente como candles; embaixo, o gasto do dia (laranja acima do percentil 80). */
function DailyPanel({ d }: { d: api.Dashboard }) {
  const days = d.chart.days;
  const rolling = d.chart.window === 'rolling';
  const firstInMonth = days.findIndex((x) => x.inMonth);
  const W = 1000;
  const H = 300;
  const VH = 70;
  const slot = W / days.length;
  const past = days.filter((x) => !x.future);
  const lo = Math.min(...past.map((x) => x.low!), d.ohlc?.low ?? 0);
  const hi = Math.max(...past.map((x) => x.high!), d.ohlc?.high ?? 1);
  const pad = (hi - lo) * 0.08 || 1000;
  const y = (v: number) => H - ((v - (lo - pad)) / (hi + pad - (lo - pad))) * H;
  const maxSpent = Math.max(...days.map((x) => x.spentCents), 1);
  // eixo: dias do mês, ou dd/mm a cada 5 dias na janela de 30 dias
  const ticks: { i: number; label: string }[] = rolling
    ? days.map((x, i) => ({ i, label: fmtDay(x.day) })).filter(({ i }) => i % 5 === 0 && Math.abs(i - firstInMonth) > 2)
    : [1, 5, 10, 15, 20, 25, days.length].map((t) => ({ i: t - 1, label: String(t).padStart(2, '0') }));

  return (
    <section className="panel s3" aria-labelledby="c-t" data-tour="saldo">
      <PanelHead id="c-t" title={rolling ? 'CONTA CORRENTE · ÚLTIMOS 30 DIAS' : 'CONTA CORRENTE · SALDO DIÁRIO'}>
        {d.ohlc && (
          <span className="ohlc">
            <span><span className="label">ABR</span> {formatPlain(d.ohlc.open)}</span>
            <span><span className="label">MÁX</span> {formatPlain(d.ohlc.high)}</span>
            <span><span className="label">MÍN</span> {formatPlain(d.ohlc.low)}</span>
            <span><span className="label">FECH</span> <span className={d.ohlc.close >= d.ohlc.open ? 'gain' : 'over'}>{formatPlain(d.ohlc.close)}</span></span>
          </span>
        )}
      </PanelHead>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={`Saldo diário: abriu em ${formatPlain(d.ohlc?.open ?? 0)} e fechou em ${formatPlain(d.ohlc?.close ?? 0)}`}>
        {[0.2, 0.4, 0.6, 0.8].map((f) => <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} className="gridline" />)}
        {rolling && firstInMonth > 0 && (
          <g className="month-split">
            <line x1={slot * firstInMonth} x2={slot * firstInMonth} y1="0" y2={H} />
            <text x={slot * firstInMonth + 8} y="16">{fmtMonthTag(d.month)}</text>
          </g>
        )}
        {days.map((x, i) => {
          if (x.future) return null;
          const cx = slot * i + slot / 2;
          const up = x.close! >= x.open!;
          const top = y(Math.max(x.open!, x.close!));
          const h = Math.max(2, Math.abs(y(x.open!) - y(x.close!)));
          return (
            <g key={x.day} className={`cdl ${x.inMonth ? '' : 'prev'}`} style={{ animationDelay: `${i * 18}ms` }}>
              <title>{`${fmtDay(x.day)} · abriu ${formatPlain(x.open!)} · fechou ${formatPlain(x.close!)}`}</title>
              <line x1={cx} x2={cx} y1={y(x.high!)} y2={y(x.low!)} className={up ? 'wick up' : 'wick'} />
              <rect x={cx - slot * 0.3} width={slot * 0.6} y={top} height={h} className={up ? 'body up' : 'body'} />
            </g>
          );
        })}
      </svg>
      <svg viewBox={`0 0 ${W} ${VH}`} className="chart vol" aria-hidden="true">
        {days.map((x, i) => {
          const h = (x.spentCents / maxSpent) * (VH - 4);
          const hot = x.spentCents > d.chart.hotThresholdCents && x.spentCents > 0;
          return <rect key={x.day} x={slot * i + slot * 0.15} width={slot * 0.7} y={VH - Math.max(h, x.future ? 0 : 1.5)} height={Math.max(h, x.future ? 0 : 1.5)} className={`${hot ? 'v hot' : 'v'} ${x.inMonth ? '' : 'prev'}`} style={{ animationDelay: `${300 + i * 12}ms` }} />;
        })}
      </svg>
      <div className="xticks mono label" aria-hidden="true">
        {ticks.map((t) => <span key={t.i} style={{ left: `${((t.i + 0.5) / days.length) * 100}%` }}>{t.label}</span>)}
        {rolling && firstInMonth > 0 && <span className="gain" style={{ left: `${((firstInMonth + 0.5) / days.length) * 100}%` }}>{fmtDay(days[firstInMonth].day)}</span>}
      </div>
      <p className="note">
        {rolling ? `Começo de mês: mostrando os últimos 30 dias, com ${fmtMonthLong(addMonths(d.month, -1)).split(' ')[0]} apagado. ` : ''}
        Barras de baixo: gasto do dia em todas as contas. Em laranja, os dias acima do percentil 80 ({formatPlain(d.chart.hotThresholdCents)}).
      </p>
    </section>
  );
}

function AllocationPanel({ d }: { d: api.Dashboard }) {
  const a = d.allocation;
  const max = Math.max(a.savedCents, ...a.items.map((i) => i.cents), 1);
  const rows = [{ name: 'Guardado', cents: Math.max(0, a.savedCents), share: a.savedShare, overBudget: false, saved: true }, ...a.items.map((i) => ({ ...i, saved: false }))];
  return (
    <section className="panel" aria-labelledby="a-t" data-tour="alocacao">
      <PanelHead id="a-t" title="ALOCAÇÃO DO SALÁRIO" />
      <p className={`big mono ${a.savedCents >= 0 ? 'gain' : 'over'}`}>{a.savedCents >= 0 ? '+' : ''}{formatPlain(a.savedCents)}</p>
      <p className="label mono sub">
        {a.incomeCents === 0 ? 'nenhuma receita no mês até agora' : `${pct(d.kpis.savingsRate)} retido`} · média de 12 meses {pct(d.kpis.yearSavingsRate)}
      </p>
      <ul className="alloc">
        {rows.map((r, i) => (
          <li key={r.name}>
            <div className="kv0">
              <span className={r.overBudget ? 'over' : ''}>{r.name.toUpperCase()}{r.overBudget && <span aria-label="acima do orçamento"> ▲</span>}</span>
              <span className={r.saved ? 'gain' : r.overBudget ? 'over' : ''}>{formatPlain(r.cents)}</span>
            </div>
            <div className="meter" title={a.incomeCents ? `${pct(r.share)} da renda` : undefined}>
              <span className={`hb ${r.saved ? 'saved' : r.overBudget ? 'hot' : ''}`} style={{ width: `${(r.cents / max) * 100}%`, animationDelay: `${i * 60}ms` }} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Patrimônio no fim de cada mês + projeção com faixa de ±1 desvio-padrão. */
function NetWorthPanel({ d }: { d: api.Dashboard }) {
  const { series, projection, meanDeltaCents } = d.netWorth;
  const W = 600;
  const H = 190;
  const all = [...series.map((s) => s.netWorth), ...projection.flatMap((p) => [p.lowCents, p.highCents])];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const pad = (hi - lo) * 0.1 || 1000;
  const n = series.length + projection.length;
  const x = (i: number) => (i / (n - 1)) * W;
  const y = (v: number) => H - ((v - (lo - pad)) / (hi - lo + 2 * pad)) * H;
  const line = series.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(s.netWorth).toFixed(1)}`).join(' ');
  const last = series.length - 1;
  const proj = projection.map((p, k) => `L${x(last + k + 1).toFixed(1)},${y(p.expectedCents).toFixed(1)}`).join(' ');
  const band = projection.length
    ? `M${x(last)},${y(series[last].netWorth)} ${projection.map((p, k) => `L${x(last + k + 1)},${y(p.highCents)}`).join(' ')} ${[...projection].reverse().map((p, k) => `L${x(last + projection.length - k)},${y(p.lowCents)}`).join(' ')} Z`
    : '';
  const end = projection[projection.length - 1];

  return (
    <section className="panel s2" aria-labelledby="p-t" data-tour="patrimonio">
      <PanelHead id="p-t" title="PATRIMÔNIO · 12M + PROJEÇÃO">
        {end && <span><span className="label">{fmtMonthTag(end.month)}</span> <span className="gain">{formatPlain(end.expectedCents)}</span> <span className="label">±{formatPlain(end.highCents - end.expectedCents)}</span></span>}
      </PanelHead>
      <p className="big mono">R$ {formatPlain(d.kpis.netWorthCents)}</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={`Patrimônio de ${formatPlain(series[0].netWorth)} a ${formatPlain(series[last].netWorth)} em 12 meses`}>
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} className="gridline" />)}
        {band && <path d={band} className="band late" />}
        <path d={line} className="nw draw" pathLength={1} />
        {proj && <path d={`M${x(last)},${y(series[last].netWorth)} ${proj}`} className="nw proj late" />}
        {series.map((s, i) => (
          <circle key={s.month} cx={x(i)} cy={y(s.netWorth)} r={i === last ? 4 : 0} className="nw-dot late">
            <title>{`${fmtMonth(s.month)} · ${formatPlain(s.netWorth)}`}</title>
          </circle>
        ))}
      </svg>
      <div className="xticks mono label static" aria-hidden="true">
        <span>{fmtMonth(series[0].month)}</span>
        <span>{fmtMonth(series[last].month)}</span>
        {end && <span>{fmtMonth(end.month)}</span>}
      </div>
      <p className="note">
        {projection.length
          ? `Projeção: média de ${formatPlain(meanDeltaCents)}/mês nos últimos 6 meses, faixa de ±1 desvio-padrão.`
          : 'A projeção aparece com 7 meses de histórico.'}
      </p>
    </section>
  );
}

/** Mapa de calor: linhas = dias da semana, colunas = semanas do mês. */
function HeatPanel({ d }: { d: api.Dashboard }) {
  const { weeks, max } = useMemo(() => {
    const first = d.daily[0]?.dow ?? 1; // 1 = segunda
    const cols: (api.DashDay | null)[][] = [];
    d.daily.forEach((day, i) => {
      const pos = first - 1 + i;
      const w = Math.floor(pos / 7);
      (cols[w] ??= Array(7).fill(null))[pos % 7] = day;
    });
    return { weeks: cols, max: Math.max(...d.daily.map((x) => x.spentCents), 1) };
  }, [d.daily]);

  return (
    <section className="panel s2" aria-labelledby="h-t" data-tour="calor">
      <PanelHead id="h-t" title="GASTO POR DIA · CALOR">
        <span><span className="label">TOTAL</span> {formatPlain(d.spend.totalSpentCents)}</span>
      </PanelHead>
      <div className="heat mono" style={{ gridTemplateColumns: `34px repeat(${weeks.length}, minmax(0, 1fr))` }}>
        <span />
        {weeks.map((_, w) => <span key={w} className="label hh">SEM {w + 1}</span>)}
        {WEEKDAYS.map((wd, r) => (
          <div key={wd} className="heat-row">
            <span className="label">{wd}</span>
            {weeks.map((col, w) => {
              const day = col[r];
              if (!day) return <span key={w} />;
              const t = day.spentCents / max;
              const hot = day.spentCents > d.spend.hotThresholdCents && day.spentCents > 0;
              const bg = day.future ? 'transparent' : hot ? `rgba(232, 137, 111, ${0.25 + t * 0.6})` : `rgba(67, 184, 131, ${0.08 + t * 0.75})`;
              return (
                <span key={w} className={`cell ${day.future ? 'future' : ''}`} style={{ background: bg, animationDelay: `${(w * 7 + r) * 10}ms` }} title={`${fmtDay(day.day)} · ${formatPlain(day.spentCents)}`}>
                  {Number(day.day.slice(8))}
                </span>
              );
            })}
          </div>
        ))}
      </div>
      <p className="note">Fins de semana concentram {pct(d.spend.weekendShare)} dos gastos variáveis (sem contas fixas e parcelas).</p>
    </section>
  );
}

function FlowPanel({ d, onMore }: { d: api.Dashboard; onMore: () => void }) {
  return (
    <section className="panel s2" aria-labelledby="f-t" data-tour="fluxo">
      <PanelHead id="f-t" title="FLUXO · ÚLTIMOS LANÇAMENTOS">
        <button type="button" className="act link" onClick={onMore}>ver todos →</button>
      </PanelHead>
      {d.flow.length === 0 ? (
        <p className="label mono">Nenhum lançamento ainda.</p>
      ) : (
        <div className="table-wrap">
          <table className="t flow">
            <thead><tr><th>DATA</th><th>DESCRIÇÃO</th><th className="hide-s">CONTA</th><th className="r">VALOR</th><th className="r">SALDO</th></tr></thead>
            <tbody>
              {d.flow.map((f, i) => (
                <tr key={f.id} className="log" style={{ animationDelay: `${i * 40}ms` }}>
                  <td className="label">{fmtDay(f.date)}</td>
                  <td style={{ color: 'var(--strong)' }}>{f.description}</td>
                  <td className="hide-s label">{f.account}</td>
                  <td className={`r ${f.amountCents > 0 ? 'gain' : f.kind === 'TRANSFER' ? 'label' : ''}`}>{f.amountCents > 0 ? '+' : ''}{formatPlain(f.amountCents)}</td>
                  <td className="r">{formatPlain(f.balanceAfterCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="note">Saldo da conta logo depois de cada lançamento, calculado com SUM() OVER (PARTITION BY conta).</p>
    </section>
  );
}

function BillsPanel({ d }: { d: api.Dashboard }) {
  const b = d.bills;
  return (
    <section className="panel" aria-labelledby="v-t" data-tour="vencimentos">
      <PanelHead id="v-t" title={`VENCIMENTOS · ${fmtMonthTag(b.month)}`} />
      {b.items.length === 0 && <p className="label mono">Nada vencendo em {fmtMonth(b.month)}.</p>}
      {b.items.map((i) => (
        <div className="kv" key={`${i.date}-${i.name}`} title={i.detail}>
          <span><span className="label">{fmtDay(i.date)}</span> {i.name.toUpperCase()}</span>
          <span>{formatPlain(i.cents)}</span>
        </div>
      ))}
      <div className="kv"><span className="label">TOTAL</span><b>{formatPlain(b.totalCents)}</b></div>
      <div className="kv" style={{ borderBottom: 0 }}>
        <span className="label">CONTA CORRENTE − TOTAL</span>
        <span className={b.leftCents >= 0 ? 'gain' : 'over'}>{b.leftCents >= 0 ? '+' : ''}{formatPlain(b.leftCents)}</span>
      </div>
    </section>
  );
}

/** Horário se for de hoje, data se não for. */
function when(iso: string, today: string) {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
  return day === today ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(d) : fmtDay(day);
}

function AlertsPanel({ d }: { d: api.Dashboard }) {
  const cls = { over: 'over', warn: 'warn', info: '', good: 'gain' } as const;
  return (
    <section className="panel" aria-labelledby="l-t" data-tour="alertas">
      <PanelHead id="l-t" title="ALERTAS">{d.unreadAlerts > 0 && <span className="gain">{d.unreadAlerts} novos</span>}</PanelHead>
      <ul className="alerts mono">
        {d.alerts.map((a, i) => (
          <li key={i} className={`log ${a.read ? '' : 'unread'}`} style={{ animationDelay: `${i * 60}ms` }}>
            <span className="label tagl">{when(a.at, d.today)}</span>
            <span className={cls[a.level]}>{a.text}</span>
          </li>
        ))}
        {d.alerts.length === 0 && <li className="label">Tudo em ordem. As regras ficam no Plano.</li>}
      </ul>
    </section>
  );
}
