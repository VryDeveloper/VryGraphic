import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  addMonths,
  buildCommandContext,
  formatPlain,
  installmentSchedule,
  invoiceMonthFor,
  ISSUE_MESSAGES,
  parseBRL,
  parseCommand,
  todayISO,
} from '@vrygraphic/shared';
import * as api from '../lib/api';
import { fmtDay, fmtMonth, fmtMonthLong } from '../lib/format';

const EXAMPLES = ['mercado 120,50 alimentação', 'notebook 2.400 tecnologia 7x', '+freela 640,50 trabalho', 'uber 23 transp ontem'];
const errMsg = (e: unknown) => {
  const err = e as api.ApiError;
  return err.fields ? Object.values(err.fields).join(' · ') : err.message ?? 'Algo deu errado';
};

type Kind = '' | 'EXPENSE' | 'INCOME' | 'TRANSFER';
const KINDS: [Kind, string][] = [['', 'tudo'], ['EXPENSE', 'despesas'], ['INCOME', 'receitas'], ['TRANSFER', 'transferências']];

export function Transacoes() {
  const today = todayISO();
  const [accounts, setAccounts] = useState<api.Account[]>([]);
  const [categories, setCategories] = useState<api.Category[]>([]);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [accountId, setAccountId] = useState('');
  const [kind, setKind] = useState<Kind>('');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [page, setPage] = useState<api.TxPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; undoId?: string } | null>(null);

  const refreshRefs = useCallback(async () => {
    const [a, c] = await Promise.all([api.accounts(), api.categories()]);
    setAccounts(a);
    setCategories(c);
  }, []);

  useEffect(() => {
    refreshRefs().catch((e) => setLoadError(errMsg(e)));
  }, [refreshRefs]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const filters = useMemo(() => ({ month, accountId, kind, q: debouncedQ, limit: 30 }), [month, accountId, kind, debouncedQ]);

  // pedido mais recente vence: digitar rápido na busca não deixa uma resposta velha sobrescrever a nova
  const reqId = useRef(0);
  const reload = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    try {
      const p = await api.transactions(filters);
      if (id === reqId.current) {
        setPage(p);
        setLoadError(null);
      }
    } catch (e) {
      if (id === reqId.current) setLoadError(errMsg(e));
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function loadMore() {
    if (!page?.nextCursor) return;
    const more = await api.transactions({ ...filters, cursor: page.nextCursor });
    setPage({ ...more, items: [...page.items, ...more.items] });
  }

  const afterChange = useCallback(async (newIds: string[] = []) => {
    setFresh(new Set(newIds));
    await Promise.all([reload(), refreshRefs()]);
  }, [reload, refreshRefs]);

  async function remove(t: api.Transaction) {
    try {
      const r = await api.deleteTransaction(t.id);
      const what = t.installment ? `parcelamento "${t.description}" (${r.deleted} parcelas) excluído` : t.transferGroupId ? 'transferência excluída' : `"${t.description}" excluído`;
      setToast({ msg: what, undoId: t.id });
      await afterChange();
    } catch (e) {
      setToast({ msg: errMsg(e) });
    }
  }

  async function undo(id: string) {
    await api.restoreTransaction(id);
    setToast({ msg: 'desfeito' });
    await afterChange([id]);
  }

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(t);
  }, [toast]);

  const isCurrentMonth = month === today.slice(0, 7);

  return (
    <>
      <div className="page-head">
        <h1>Transações</h1>
        <span className="mono label">gravado no PostgreSQL · saldos calculados na hora</span>
      </div>

      <CommandBar accounts={accounts} categories={categories} today={today} onSaved={(items) => {
        // se lançou em outro mês, pula para ele para a pessoa ver o que gravou
        const m = items[0]?.date.slice(0, 7);
        if (m && m !== month) setMonth(m);
        afterChange(items.map((i) => i.id));
      }} />

      <div className="grid2">
        <section className="panel" aria-labelledby="list-t" data-tour="lista">
          <div className="list-head">
            <h2 id="list-t">LANÇAMENTOS</h2>
            <div className="month-nav mono" role="group" aria-label="Mês">
              <button type="button" className="chip" onClick={() => setMonth(addMonths(month, -1))} aria-label="Mês anterior">‹</button>
              <span aria-live="polite">{fmtMonthLong(month)}</span>
              <button type="button" className="chip" onClick={() => setMonth(addMonths(month, 1))} aria-label="Próximo mês">›</button>
              {!isCurrentMonth && <button type="button" className="chip" onClick={() => setMonth(today.slice(0, 7))}>hoje</button>}
            </div>
          </div>

          <div className="filters mono" data-tour="filtros">
            <div className="seg" role="group" aria-label="Tipo">
              {KINDS.map(([k, l]) => (
                <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{l}</button>
              ))}
            </div>
            <label className="sel">
              <span className="sr">Conta</span>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">todas as contas</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            <label className="search">
              <span className="label">/</span>
              <span className="sr">Buscar na descrição</span>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="buscar" spellCheck={false} />
            </label>
          </div>

          {loadError ? (
            <p className="err" role="alert">{loadError}</p>
          ) : !page ? (
            <p className="label mono">$ carregando…</p>
          ) : page.items.length === 0 ? (
            <p className="label mono empty">
              {debouncedQ || kind || accountId ? 'Nada com esses filtros.' : `Nenhum lançamento em ${fmtMonthLong(month)}. Use a barra acima.`}
            </p>
          ) : (
            <div className="table-wrap" aria-busy={loading}>
              <table className="t tx">
                <thead>
                  <tr><th>DATA</th><th>DESCRIÇÃO</th><th className="hide-s">CATEGORIA</th><th className="hide-s">CONTA</th><th className="r">VALOR</th><th><span className="sr">Ações</span></th></tr>
                </thead>
                <tbody>
                  {page.items.map((t) =>
                    editing === t.id ? (
                      <EditRow key={t.id} t={t} categories={categories} accounts={accounts} onCancel={() => setEditing(null)} onSaved={async () => { setEditing(null); await afterChange([t.id]); }} />
                    ) : (
                      <tr key={t.id} className={fresh.has(t.id) ? 'new' : ''}>
                        <td className="label">{fmtDay(t.date)}</td>
                        <td style={{ color: 'var(--strong)' }}>
                          {t.description}
                          {t.installment && <span className="tag">{t.installment.number}/{t.installment.count}</span>}
                          {t.recurring && <span className="tag dim" title={t.source === 'RECURRING' ? 'lançada sozinha pelo job de contas fixas' : 'conta fixa'}>fixa</span>}
                          {t.invoiceMonth && <span className="tag dim">fatura {fmtMonth(t.invoiceMonth)}</span>}
                        </td>
                        <td className="hide-s" style={{ color: 'var(--muted)' }}>{t.category?.name ?? (t.kind === 'TRANSFER' ? 'transferência' : '—')}</td>
                        <td className="hide-s" style={{ color: 'var(--muted)' }}>{t.account.name}</td>
                        <td className={`r ${t.amountCents > 0 ? 'gain' : ''}`}>{t.amountCents > 0 ? '+' : ''}{formatPlain(t.amountCents)}</td>
                        <td className="r acts">
                          {t.kind !== 'TRANSFER' && <button type="button" className="act" onClick={() => setEditing(t.id)} aria-label={`Editar ${t.description}`}>editar</button>}
                          <button type="button" className="act del" onClick={() => remove(t)} aria-label={`Excluir ${t.description}`}>excluir</button>
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
              {page.nextCursor && <button type="button" className="btn ghost more" onClick={loadMore}>carregar mais</button>}
            </div>
          )}
        </section>

        <aside className="side">
          <section className="panel" aria-labelledby="sum-t">
            <h2 id="sum-t">RESUMO · {fmtMonth(month).toUpperCase()}</h2>
            <div className="kv"><span className="label">ENTRADAS</span><span className="gain">+{formatPlain(page?.totals.incomeCents ?? 0)}</span></div>
            <div className="kv"><span className="label">SAÍDAS</span><span>−{formatPlain(page?.totals.expenseCents ?? 0)}</span></div>
            <div className="kv"><span className="label">RESULTADO</span><b className={(page?.totals.netCents ?? 0) < 0 ? 'over' : ''}>{formatPlain(page?.totals.netCents ?? 0)}</b></div>
            <div className="kv" style={{ borderBottom: 0 }}><span className="label">LANÇAMENTOS</span><span>{page?.totals.count ?? 0}</span></div>
          </section>

          <section className="panel" aria-labelledby="acc-t" data-tour="contas">
            <h2 id="acc-t">CONTAS · SALDO AGORA</h2>
            {accounts.map((a) => (
              <div className="kv" key={a.id}>
                <span>{a.name}{a.aliases.length > 0 && <span className="label"> · {a.aliases[0]}</span>}</span>
                <span className={a.balanceCents < 0 ? 'over' : ''}>
                  {formatPlain(a.balanceCents)}
                  {a.availableCents !== null && <span className="label block">livre {formatPlain(a.availableCents)}</span>}
                </span>
              </div>
            ))}
          </section>

          <TransferForm accounts={accounts} today={today} onDone={(ids) => { setToast({ msg: 'transferência feita' }); afterChange(ids); }} />
        </aside>
      </div>

      {toast && (
        <div className="toast mono" role="status">
          <span>{toast.msg}</span>
          {toast.undoId && <button type="button" className="act" onClick={() => undo(toast.undoId!)}>desfazer</button>}
        </div>
      )}
    </>
  );
}

/** Barra de comando: prévia local (mesmo parser da API) com as contas e categorias reais. */
function CommandBar(props: { accounts: api.Account[]; categories: api.Category[]; today: string; onSaved: (items: api.Transaction[]) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ctx = useMemo(() => buildCommandContext({ accounts: props.accounts, categories: props.categories, today: props.today }), [props.accounts, props.categories, props.today]);
  const p = parseCommand(text, ctx);
  const empty = !text.trim();
  const account = props.accounts.find((a) => a.id === p.accountId);
  const card = account?.kind === 'CREDIT_CARD';

  const schedule = p.ok && p.installments > 1 && p.amountCents
    ? installmentSchedule(p.amountCents, p.installments, card ? invoiceMonthFor(p.date, account.closingDay ?? 1) : p.date.slice(0, 7))
    : [];

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!p.ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      const items = await api.runCommand(text);
      setText('');
      props.onSaved(items);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="cmd-t" style={{ borderBottom: '1px solid var(--grid)' }} data-tour="comando">
      <h2 id="cmd-t">NOVO LANÇAMENTO</h2>
      <form className="cmd" onSubmit={submit}>
        <label>
          <span className="gain">&gt;</span>
          <span className="sr">Comando de lançamento</span>
          <input value={text} onChange={(e) => { setText(e.target.value); setError(null); }} placeholder="descrição valor categoria [conta] [12x] [ontem]" aria-describedby="cmd-help" autoComplete="off" spellCheck={false} />
        </label>
        <button type="submit" className="btn" disabled={!p.ok || busy}>{busy ? 'GRAVANDO…' : 'LANÇAR ↵'}</button>
      </form>

      <div id="cmd-help" className="parsed" aria-live="polite">
        {error ? (
          <span className="over">{error}</span>
        ) : empty ? (
          <span><span className="label">DIGITE</span> descrição, valor e categoria; o resto é opcional</span>
        ) : (
          <>
            <span><span className="label">TIPO</span> {p.kind === 'INCOME' ? 'receita' : 'despesa'}</span>
            <span><span className="label">DESCRIÇÃO</span> <span className={p.description ? '' : 'warn'}>{p.description || '?'}</span></span>
            <span><span className="label">VALOR</span> <span className={p.amountCents ? '' : 'warn'}>{p.amountCents ? formatPlain(p.amountCents) : '?'}</span></span>
            <span><span className="label">CATEGORIA</span> <span className={p.categoryGuessed ? 'warn' : ''}>{p.categoryName ?? '—'}</span></span>
            <span><span className="label">CONTA</span> {p.accountName ?? '—'}</span>
            <span><span className="label">DATA</span> {p.date.split('-').reverse().join('/')}</span>
            {!p.ok && <span><span className="label">FALTA</span> <span className="warn">{p.issues.map((i) => ISSUE_MESSAGES[i]).join(', ')}</span></span>}
          </>
        )}
      </div>

      {schedule.length > 0 && (
        <div className="mono" style={{ fontSize: 12 }}>
          <div className="segs" aria-hidden="true">{schedule.map((s) => <span key={s.number} style={{ animationDelay: `${s.number * 30}ms` }} />)}</div>
          <p className="label" style={{ margin: '8px 0 0' }}>
            {p.installments}× de {formatPlain(schedule[1].amountCents)}
            {schedule[0].amountCents !== schedule[1].amountCents && ` (+${formatPlain(schedule[0].amountCents - schedule[1].amountCents)} na 1ª)`}
            {card
              ? ` · faturas de ${fmtMonth(schedule[0].invoiceMonth)} a ${fmtMonth(schedule[schedule.length - 1].invoiceMonth)}`
              : ` · de ${fmtMonth(schedule[0].invoiceMonth)} a ${fmtMonth(schedule[schedule.length - 1].invoiceMonth)}`}
          </p>
        </div>
      )}

      <div className="chips">
        <span className="label">exemplos:</span>
        {EXAMPLES.map((e) => <button key={e} type="button" className="chip" onClick={() => { setText(e); setError(null); }}>{e}</button>)}
      </div>
    </section>
  );
}

/** Edição na própria linha. Parcela: só descrição e categoria (a API aplica no parcelamento todo). */
function EditRow(props: { t: api.Transaction; categories: api.Category[]; accounts: api.Account[]; onCancel: () => void; onSaved: () => void }) {
  const { t } = props;
  const locked = Boolean(t.installment);
  const [description, setDescription] = useState(t.description);
  const [amount, setAmount] = useState(formatPlain(Math.abs(t.amountCents)));
  const [categoryId, setCategoryId] = useState(t.category?.id ?? '');
  const [date, setDate] = useState(t.date);
  const [accountId, setAccountId] = useState(t.account.id);
  const [error, setError] = useState<string | null>(null);
  const cats = props.categories.filter((c) => c.kind === t.kind);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);

  async function save() {
    const patch: api.TxPatch = {};
    if (description.trim() !== t.description) patch.description = description.trim();
    if ((categoryId || null) !== (t.category?.id ?? null)) patch.categoryId = categoryId || null;
    if (!locked) {
      const cents = parseBRL(amount);
      if (cents === null || cents <= 0) return setError('valor inválido');
      if (cents !== Math.abs(t.amountCents)) patch.amountCents = cents;
      if (date !== t.date) patch.date = date;
      if (accountId !== t.account.id) patch.accountId = accountId;
    }
    if (Object.keys(patch).length === 0) return props.onCancel();
    try {
      await api.updateTransaction(t.id, patch);
      props.onSaved();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Escape') props.onCancel();
    if (e.key === 'Enter') save();
  };

  return (
    <tr className="editing" onKeyDown={keys}>
      <td>
        <input className="inl" type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={locked} aria-label="Data" />
      </td>
      <td>
        <input ref={first} className="inl" value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Descrição" />
        {locked && <span className="label block">vale para as {t.installment!.count} parcelas; valor e data: exclua e lance de novo</span>}
        {error && <span className="err block" role="alert">{error}</span>}
      </td>
      <td className="hide-s">
        <select className="inl" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Categoria">
          <option value="">sem categoria</option>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </td>
      <td className="hide-s">
        <select className="inl" value={accountId} onChange={(e) => setAccountId(e.target.value)} disabled={locked} aria-label="Conta">
          {props.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </td>
      <td className="r">
        <input className="inl r" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={locked} inputMode="decimal" aria-label="Valor" />
      </td>
      <td className="r acts">
        <button type="button" className="act ok" onClick={save}>salvar</button>
        <button type="button" className="act" onClick={props.onCancel}>cancelar</button>
      </td>
    </tr>
  );
}

function TransferForm(props: { accounts: api.Account[]; today: string; onDone: (ids: string[]) => void }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!from && props.accounts[0]) setFrom(props.accounts[0].id);
    if (!to && props.accounts[1]) setTo(props.accounts[1].id);
  }, [props.accounts, from, to]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const cents = parseBRL(amount);
    if (!cents || cents <= 0) return setError('informe o valor');
    setBusy(true);
    setError(null);
    try {
      const items = await api.transfer({ fromAccountId: from, toAccountId: to, amountCents: cents, date: props.today });
      setAmount('');
      props.onDone(items.map((i) => i.id));
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  if (props.accounts.length < 2) return null;
  return (
    <section className="panel" aria-labelledby="tr-t" data-tour="transferir">
      <h2 id="tr-t">TRANSFERIR</h2>
      <form className="transfer mono" onSubmit={submit}>
        <label><span className="label">DE</span>
          <select value={from} onChange={(e) => setFrom(e.target.value)}>{props.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        </label>
        <label><span className="label">PARA</span>
          <select value={to} onChange={(e) => setTo(e.target.value)}>{props.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        </label>
        <label><span className="label">VALOR</span>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" inputMode="decimal" />
        </label>
        {error && <p className="err" role="alert">{error}</p>}
        <button type="submit" className="btn ghost" disabled={busy}>{busy ? 'transferindo…' : 'transferir hoje'}</button>
      </form>
    </section>
  );
}
