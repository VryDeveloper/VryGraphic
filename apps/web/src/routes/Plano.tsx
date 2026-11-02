import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { addMonths, formatPlain, parseBRL, simulateGoal, todayISO } from '@vrygraphic/shared';
import * as api from '../lib/api';
import { fmtMonth, fmtMonthLong, fmtMonthTag, pct } from '../lib/format';

const errMsg = (e: unknown) => {
  const err = e as api.ApiError;
  return err.fields ? Object.values(err.fields).join(' · ') : err.message ?? 'Algo deu errado';
};

export function Plano() {
  const today = todayISO();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <>
      <div className="page-head">
        <h1>Plano · orçamentos e metas</h1>
        <div className="month-nav mono">
          <button type="button" className="chip" onClick={() => setMonth(addMonths(month, -1))} aria-label="Mês anterior">‹</button>
          <span aria-live="polite">{fmtMonthLong(month)}</span>
          <button type="button" className="chip" onClick={() => setMonth(addMonths(month, 1))} disabled={month >= today.slice(0, 7)} aria-label="Próximo mês">›</button>
        </div>
      </div>
      <div className="g">
        <BudgetPanel month={month} onToast={setToast} />
        <Goals onToast={setToast} />
      </div>
      {toast && <div className="toast mono" role="status">{toast}</div>}
    </>
  );
}

// ───────────────────────── orçamentos ─────────────────────────

function BudgetPanel({ month, onToast }: { month: string; onToast: (m: string) => void }) {
  const [plan, setPlan] = useState<api.BudgetPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setPlan(await api.budgetPlan(month));
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    }
  }, [month]);

  useEffect(() => {
    setPlan(null);
    load();
  }, [load]);

  async function saveLimit(row: api.PlanRow, text: string) {
    setEditing(null);
    const value = text.trim();
    try {
      if (!value || value === '0') {
        if (row.budgetId) {
          await api.deleteBudget(row.budgetId);
          onToast(`limite de ${row.name} removido`);
        }
      } else {
        const cents = parseBRL(value);
        if (!cents || cents <= 0) return onToast('valor inválido');
        if (cents === row.limitCents) return;
        await api.putBudget(row.categoryId, month, cents);
        onToast(`${row.name}: limite de ${formatPlain(cents)} em ${fmtMonth(month)}`);
      }
      await load();
    } catch (e) {
      onToast(errMsg(e));
    }
  }

  async function applyAll() {
    if (!plan) return;
    const items = plan.items.filter((i) => i.suggestionCents > 0).map((i) => ({ categoryId: i.categoryId, limitCents: i.suggestionCents }));
    if (!items.length) return onToast('sem histórico suficiente para sugerir');
    setBusy(true);
    try {
      const r = await api.applyBudgets(plan.nextMonth, items);
      onToast(`${r.applied} limites aplicados em ${fmtMonth(plan.nextMonth)}`);
      await load();
    } catch (e) {
      onToast(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  if (error) return <section className="panel s4"><p className="err" role="alert">{error}</p></section>;
  if (!plan) return <section className="panel s4"><p className="label mono">$ calculando orçamento…</p></section>;

  const m = fmtMonthTag(plan.month);
  const n = fmtMonthTag(plan.nextMonth);
  const t = plan.totals;
  const nextSet = plan.items.filter((i) => i.nextLimitCents !== null).length;

  return (
    <section className="panel s4" aria-labelledby="b-t" data-tour="orcamento">
      <div className="ph">
        <h2 id="b-t">ORÇAMENTO · {m} × SUGESTÃO PARA {n}</h2>
        <div className="ph-r mono">
          <span className="label hide-s">sugestão = média de 3 meses, arredondada para cima em R$ 50 · </span>
          <button type="button" className="btn ghost sm" onClick={applyAll} disabled={busy}>{busy ? 'aplicando…' : `aplicar sugestões em ${n.toLowerCase()}`}</button>
        </div>
      </div>
      <div className="table-wrap">
        <table className="t plan">
          <thead>
            <tr>
              <th>CATEGORIA</th>
              <th className="r">LIMITE {m}</th>
              <th className="r">GASTO {m}</th>
              <th className="hide-s">USO</th>
              <th className="r hide-s">MÉDIA 3M</th>
              <th className="r">SUGESTÃO {n}</th>
              <th className="r hide-s">Δ</th>
              <th className="r hide-s">{n} DEFINIDO</th>
            </tr>
          </thead>
          <tbody>
            {plan.items.map((r, i) => {
              const over = r.status === 'over';
              const w = r.ratio === null ? 0 : Math.min(1, r.ratio);
              return (
                <tr key={r.categoryId}>
                  <td className={over ? 'over' : ''}>{r.name.toUpperCase()}{over && <span aria-label="acima do limite"> ▲</span>}</td>
                  <td className="r">
                    {editing === r.categoryId ? (
                      <LimitInput initial={r.limitCents} onSave={(v) => saveLimit(r, v)} onCancel={() => setEditing(null)} label={`Limite de ${r.name}`} />
                    ) : (
                      <button type="button" className="cellbtn" onClick={() => setEditing(r.categoryId)} aria-label={`Editar limite de ${r.name}`}>
                        {r.limitCents === null ? <span className="label">+ definir</span> : formatPlain(r.limitCents)}
                      </button>
                    )}
                  </td>
                  <td className={`r ${over ? 'over' : ''}`}>{formatPlain(r.spentCents)}</td>
                  <td className="hide-s">
                    {r.ratio !== null ? (
                      <span className="use">
                        <span className="meter"><span className={`hb ${over ? 'hot' : r.status === 'warn' ? 'warnb' : ''}`} style={{ width: `${w * 100}%`, animationDelay: `${i * 40}ms` }} /></span>
                        <span className={over ? 'over' : 'label'}>{Math.round(r.ratio * 100)}%</span>
                      </span>
                    ) : <span className="label">—</span>}
                  </td>
                  <td className="r label hide-s" title={`últimos 3 meses: ${r.history.map(formatPlain).join(' · ')}`}>{formatPlain(r.avg3Cents)}</td>
                  <td className="r">{r.suggestionCents ? formatPlain(r.suggestionCents) : <span className="label">—</span>}</td>
                  <td className={`r hide-s ${r.deltaCents === null ? 'label' : r.deltaCents > 0 ? 'warn' : r.deltaCents < 0 ? 'gain' : 'label'}`}>
                    {r.deltaCents === null ? '—' : `${r.deltaCents > 0 ? '+' : ''}${formatPlain(r.deltaCents)}`}
                  </td>
                  <td className="r hide-s">{r.nextLimitCents === null ? <span className="label">—</span> : formatPlain(r.nextLimitCents)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>TOTAL</td>
              <td className="r">{formatPlain(t.limitCents)}</td>
              <td className="r">{formatPlain(t.spentCents)}</td>
              <td className="label hide-s">{t.used !== null ? `${pct(t.used)} usado · ${t.leftCents >= 0 ? 'sobrou' : 'passou'} ${formatPlain(Math.abs(t.leftCents))}` : 'sem limites definidos'}</td>
              <td className="r hide-s">{formatPlain(t.avg3Cents)}</td>
              <td className="r">{formatPlain(t.suggestionCents)}</td>
              <td className="hide-s" />
              <td className="r label hide-s">{nextSet} de {plan.items.length}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="note">Clique num limite para editar (Enter salva, Esc cancela, vazio remove). O gasto inclui as parcelas já marcadas para o mês, e é somado no banco, mês a mês, numa consulta só.</p>
    </section>
  );
}

function LimitInput(props: { initial: number | null; label: string; onSave: (v: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(props.initial === null ? '' : formatPlain(props.initial));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Enter') props.onSave(v);
    if (e.key === 'Escape') props.onCancel();
  };
  return <input ref={ref} className="inl r limit" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={keys} onBlur={() => props.onSave(v)} inputMode="decimal" aria-label={props.label} placeholder="0,00" />;
}

// ───────────────────────── metas ─────────────────────────

function Goals({ onToast }: { onToast: (m: string) => void }) {
  const [goals, setGoals] = useState<api.Goal[] | null>(null);
  const [accounts, setAccounts] = useState<api.Account[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const [g, a] = await Promise.all([api.goals(), api.accounts()]);
    setGoals(g);
    setAccounts(a);
    setSelected((s) => (s && g.some((x) => x.id === s) ? s : g[0]?.id ?? null));
  }, []);

  useEffect(() => {
    load().catch((e) => onToast(errMsg(e)));
  }, [load, onToast]);

  const goal = goals?.find((g) => g.id === selected) ?? null;

  return (
    <>
      <section className="panel s3" aria-labelledby="sim-t" data-tour="simulador">
        {goal ? (
          <Simulator key={goal.id} goal={goal} onSaved={async (msg) => { onToast(msg); await load(); }} />
        ) : (
          <>
            <h2 id="sim-t">SIMULADOR</h2>
            <p className="label mono">{goals === null ? '$ carregando…' : 'Crie uma meta ao lado para simular aportes e juros.'}</p>
          </>
        )}
      </section>
      <aside className="panel" aria-labelledby="g-t" data-tour="metas">
        <div className="ph">
          <h2 id="g-t">METAS</h2>
          <button type="button" className="act link" onClick={() => setCreating((c) => !c)}>{creating ? 'cancelar' : '+ nova meta'}</button>
        </div>
        {creating && (
          <GoalForm accounts={accounts} usedAccountIds={(goals ?? []).map((g) => g.account?.id).filter((x): x is string => Boolean(x))} onDone={async (g) => { setCreating(false); onToast(`meta "${g.name}" criada`); await load(); setSelected(g.id); }} onError={onToast} />
        )}
        <ul className="goals">
          {goals?.map((g) => (
            <li key={g.id}>
              <button type="button" className={`goal ${g.id === selected ? 'on' : ''}`} onClick={() => setSelected(g.id)} aria-pressed={g.id === selected}>
                <span className="kv0"><span>{g.name.toUpperCase()}</span><span className={g.progress >= 1 ? 'gain' : ''}>{Math.round(g.progress * 100)}%</span></span>
                <span className="meter"><span className="hb saved" style={{ width: `${g.progress * 100}%` }} /></span>
                <span className="kv0 label">
                  <span>{formatPlain(g.currentCents)} / {formatPlain(g.targetCents)}</span>
                  <span>{g.progress >= 1 ? 'concluída' : `${formatPlain(g.monthlyContributionCents)}/mês · ${g.projection.etaMonth ? fmtMonthTag(g.projection.etaMonth) + '/' + g.projection.etaMonth.slice(2, 4) : 'sem previsão'}`}</span>
                </span>
              </button>
            </li>
          ))}
          {goals?.length === 0 && !creating && <li className="label mono">Nenhuma meta ainda.</li>}
        </ul>
        {goal && (
          <button
            type="button"
            className="act del"
            style={{ padding: 0, marginTop: 14 }}
            onClick={async () => {
              if (!window.confirm(`Excluir a meta "${goal.name}"? O dinheiro na conta não é afetado.`)) return;
              await api.deleteGoal(goal.id);
              onToast(`meta "${goal.name}" excluída`);
              await load();
            }}
          >
            excluir meta selecionada
          </button>
        )}
        <AlertRules onToast={onToast} />
      </aside>
    </>
  );
}

function GoalForm(props: { accounts: api.Account[]; usedAccountIds: string[]; onDone: (g: api.Goal) => void; onError: (m: string) => void }) {
  // o progresso da meta é o saldo da conta: duas metas na mesma conta dividiriam o mesmo dinheiro
  const used = new Set(props.usedAccountIds);
  const savings = props.accounts.filter((a) => a.kind !== 'CREDIT_CARD').sort((a, b) => Number(used.has(a.id)) - Number(used.has(b.id)));
  const [name, setName] = useState('');
  const [accountId, setAccountId] = useState(savings.find((a) => !used.has(a.id) && a.kind === 'SAVINGS')?.id ?? savings[0]?.id ?? '');
  const [target, setTarget] = useState('');
  const [monthly, setMonthly] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const targetCents = parseBRL(target);
    const monthlyCents = parseBRL(monthly || '0') ?? 0;
    if (!targetCents) return props.onError('informe o valor da meta');
    setBusy(true);
    try {
      props.onDone(await api.createGoal({ name: name.trim(), accountId, targetCents, monthlyContributionCents: monthlyCents }));
    } catch (err) {
      props.onError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="transfer mono goal-form" onSubmit={submit}>
      <label><span className="label">NOME</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Viagem" required /></label>
      <label><span className="label">CONTA</span>
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {savings.map((a) => <option key={a.id} value={a.id}>{a.name}{used.has(a.id) ? ' (já tem meta)' : ''}</option>)}
        </select>
      </label>
      {used.has(accountId) && <p className="label" style={{ margin: 0 }}>O progresso usa o saldo da conta: as duas metas vão contar o mesmo dinheiro.</p>}
      <label><span className="label">META</span><input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="5.000,00" inputMode="decimal" /></label>
      <label><span className="label">APORTE</span><input value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder="por mês" inputMode="decimal" /></label>
      <button type="submit" className="btn ghost" disabled={busy}>{busy ? 'criando…' : 'criar meta'}</button>
    </form>
  );
}

/**
 * Simulador: o mesmo `simulateGoal` do shared que a API usa, rodando no navegador a cada movimento
 * do slider. Juros compostos mensais, aporte no fim do mês, cada mês arredondado ao centavo.
 */
function Simulator({ goal, onSaved }: { goal: api.Goal; onSaved: (msg: string) => void }) {
  const [monthly, setMonthly] = useState(goal.monthlyContributionCents);
  const [bps, setBps] = useState(goal.monthlyRateBps);
  const [busy, setBusy] = useState(false);
  const maxMonthly = Math.max(goal.monthlyContributionCents * 3, Math.ceil(goal.targetCents / 6 / 5000) * 5000, 50000);

  const sim = useMemo(
    () => simulateGoal({ currentCents: goal.currentCents, targetCents: goal.targetCents, monthlyContributionCents: monthly, monthlyRateBps: bps, maxMonths: 600 }),
    [goal.currentCents, goal.targetCents, monthly, bps],
  );
  const noInterest = useMemo(
    () => simulateGoal({ currentCents: goal.currentCents, targetCents: goal.targetCents, monthlyContributionCents: monthly, monthlyRateBps: 0, maxMonths: 600 }),
    [goal.currentCents, goal.targetCents, monthly],
  );
  const start = todayISO().slice(0, 7);
  const eta = sim.reached ? addMonths(start, sim.months) : null;
  const changed = monthly !== goal.monthlyContributionCents || bps !== goal.monthlyRateBps;
  const done = goal.currentCents >= goal.targetCents;

  // barras: no máximo 36 (meses agrupados quando a meta é longa)
  const path = sim.path.length ? sim.path : [goal.currentCents];
  const step = Math.ceil(path.length / 36);
  const bars = path.filter((_, i) => i % step === step - 1 || i === path.length - 1);
  const top = Math.max(goal.targetCents, ...bars) * 1.04;
  const saved = monthly === goal.monthlyContributionCents && bps === goal.monthlyRateBps;
  const gain = noInterest.months - sim.months;

  async function save() {
    setBusy(true);
    try {
      await api.updateGoal(goal.id, { monthlyContributionCents: monthly, monthlyRateBps: bps });
      onSaved(`aporte de ${formatPlain(monthly)}/mês salvo em "${goal.name}"`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="ph">
        <h2 id="sim-t">SIMULADOR · {goal.name.toUpperCase()}</h2>
        <span className="ph-r mono label">juros compostos mensais, aporte no fim do mês</span>
      </div>
      <div className="sim">
        <div className="sliders mono">
          <label>
            <span className="kv0"><span className="label">APORTE/MÊS</span><b>{formatPlain(monthly)}</b></span>
            <input type="range" min={0} max={maxMonthly} step={1000} value={monthly} onChange={(e) => setMonthly(Number(e.target.value))} style={{ '--fill': `${(monthly / maxMonthly) * 100}%` } as React.CSSProperties} />
          </label>
          <label>
            <span className="kv0"><span className="label">RENDIMENTO A.M.</span><b>{(bps / 100).toFixed(2).replace('.', ',')}%</b></span>
            <input type="range" min={0} max={200} step={5} value={bps} onChange={(e) => setBps(Number(e.target.value))} style={{ '--fill': `${(bps / 200) * 100}%` } as React.CSSProperties} />
          </label>
          <div className="sim-actions">
            <button type="button" className="btn sm" onClick={save} disabled={!changed || busy}>{busy ? 'salvando…' : saved ? 'salvo' : 'salvar na meta'}</button>
            {changed && <button type="button" className="act" onClick={() => { setMonthly(goal.monthlyContributionCents); setBps(goal.monthlyRateBps); }}>desfazer</button>}
          </div>
        </div>
        <div className="sim-kpis mono">
          <div><span className="label">CONCLUI EM</span><b className="gain">{done ? 'JÁ CONCLUÍDA' : eta ? `${fmtMonthTag(eta)}/${eta.slice(2, 4)}` : 'NUNCA'}</b></div>
          <div><span className="label">APORTES</span><b>{sim.months}</b></div>
          <div><span className="label">VOCÊ DEPOSITA</span><b>{formatPlain(sim.depositedCents)}</b></div>
          <div><span className="label">RENDIMENTO</span><b className="gain">+{formatPlain(Math.max(0, sim.interestCents))}</b></div>
        </div>
      </div>
      <div className="simbars" role="img" aria-label={`Saldo da meta mês a mês até ${formatPlain(sim.finalBalanceCents)}`}>
        <span className="target-line" style={{ bottom: `${(goal.targetCents / top) * 100}%` }} />
        {bars.map((v, i) => (
          <span key={i} className={i === bars.length - 1 && sim.reached ? 'b last' : 'b'} style={{ height: `${(v / top) * 100}%` }} title={formatPlain(v)} />
        ))}
      </div>
      <div className="xticks mono label static" aria-hidden="true">
        <span>{sim.path.length ? fmtMonth(addMonths(start, 1)) : 'hoje'}</span>
        {eta && sim.path.length > 0 && <span>{fmtMonth(eta)}</span>}
      </div>
      <p className="note">
        {done
          ? 'Meta atingida com o saldo atual da conta.'
          : !sim.reached
            ? 'Com esse aporte a meta não chega em 50 anos. Aumente o aporte.'
            : gain > 0
              ? `O rendimento adianta a meta em ${gain} ${gain > 1 ? 'meses' : 'mês'} e soma +${formatPlain(sim.interestCents)}. Linha tracejada: valor da meta.`
              : `Neste aporte o rendimento não adianta a data, mas soma +${formatPlain(Math.max(0, sim.interestCents))}. Linha tracejada: valor da meta.`}
      </p>
    </>
  );
}

// ───────────────────────── regras de alerta ─────────────────────────

function AlertRules({ onToast }: { onToast: (m: string) => void }) {
  const [rules, setRules] = useState<api.AlertRule[] | null>(null);
  useEffect(() => {
    api.alertRules().then(setRules).catch((e) => onToast(errMsg(e)));
  }, [onToast]);

  async function save(r: api.AlertRule, patch: Partial<api.AlertRule>) {
    const next = { ...r, ...patch };
    setRules((rs) => rs?.map((x) => (x.kind === r.kind ? next : x)) ?? null);
    try {
      const saved = await api.setAlertRule(r.kind, { enabled: next.enabled, threshold: next.threshold });
      setRules((rs) => rs?.map((x) => (x.kind === r.kind ? saved : x)) ?? null);
    } catch (e) {
      setRules((rs) => rs?.map((x) => (x.kind === r.kind ? r : x)) ?? null);
      onToast(errMsg(e));
    }
  }

  if (!rules) return null;
  return (
    <div className="rules" data-tour="regras">
      <h2 id="r-t">REGRAS DE ALERTA</h2>
      <ul aria-labelledby="r-t">
        {rules.map((r) => {
          const [before, after] = r.label.split('{n}');
          return (
            <li key={r.kind}>
              <span className="mono rule-label">
                {before}
                {r.threshold !== null && (
                  <input
                    className="inl num"
                    type="number"
                    min={1}
                    max={100}
                    defaultValue={r.threshold}
                    aria-label={`Valor da regra: ${r.label.replace('{n}', 'N')}`}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (v !== r.threshold && v >= 1 && v <= 100) save(r, { threshold: v });
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                )}
                {after}
              </span>
              <button type="button" role="switch" aria-checked={r.enabled} className="switch" onClick={() => save(r, { enabled: !r.enabled })} aria-label={r.label.replace('{n}', String(r.threshold ?? ''))}>
                <span />
              </button>
            </li>
          );
        })}
      </ul>
      <p className="note">Avaliadas a cada hora e sempre que você abre a Visão geral. Cada aviso aparece uma vez só.</p>
    </div>
  );
}
