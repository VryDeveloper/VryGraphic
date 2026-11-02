import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { formatPlain, parseBRL } from '@vrygraphic/shared';
import * as api from '../lib/api';
import { fmtDay } from '../lib/format';

const KIND_LABEL: Record<api.Account['kind'], string> = {
  CHECKING: 'Conta corrente',
  SAVINGS: 'Poupança',
  CREDIT_CARD: 'Cartão de crédito',
  INVESTMENT: 'Investimento',
  CASH: 'Dinheiro',
};
const errMsg = (e: unknown) => {
  const err = e as api.ApiError;
  return err.fields ? Object.values(err.fields).join(' · ') : err.message ?? 'Algo deu errado';
};
/** Valor com sinal opcional: "-1.200,00" (ou "−1.200,00", como a tela mostra) = −120000 centavos. */
function parseSigned(text: string): number | null {
  const neg = /^\s*[-−]/.test(text);
  const v = parseBRL(text.replace(/^\s*[-−]/, ''));
  return v === null ? null : neg ? -v : v;
}
const cleanAliases = (t: string) => t.split(/[,\s]+/).map((a) => a.trim().toLowerCase()).filter(Boolean);

export function Contas() {
  const [accounts, setAccounts] = useState<api.Account[] | null>(null);
  const [categories, setCategories] = useState<api.Category[]>([]);
  const [fixed, setFixed] = useState<api.Recurrence[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [a, c, r] = await Promise.all([api.accounts(), api.categories(), api.recurrences()]);
    setAccounts(a);
    setCategories(c);
    setFixed(r);
  }, []);

  useEffect(() => {
    load().catch((e) => setToast(errMsg(e)));
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  /** Roda uma ação, recarrega tudo e avisa; erro da API vira aviso. */
  const act = useCallback(
    async (fn: () => Promise<unknown>, ok: string) => {
      try {
        await fn();
        await load();
        setToast(ok);
        return true;
      } catch (e) {
        setToast(errMsg(e));
        return false;
      }
    },
    [load],
  );

  return (
    <>
      <div className="page-head">
        <h1>Contas · categorias e contas fixas</h1>
        <span className="mono label hide-s">o que o comando e os relatórios usam</span>
      </div>
      {!accounts ? (
        <p className="label mono" style={{ padding: 18 }}>$ carregando…</p>
      ) : (
        <div className="g">
          <AccountsPanel accounts={accounts} act={act} />
          <CategoriesPanel categories={categories} act={act} />
          <FixedPanel items={fixed} accounts={accounts} categories={categories} act={act} />
        </div>
      )}
      {toast && <div className="toast mono" role="status">{toast}</div>}
    </>
  );
}

type Act = (fn: () => Promise<unknown>, ok: string) => Promise<boolean>;

// ───────────────────────── contas ─────────────────────────

function AccountsPanel({ accounts, act }: { accounts: api.Account[]; act: Act }) {
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  return (
    <section className="panel s3" aria-labelledby="ac-t" data-tour="contas-lista">
      <div className="ph">
        <h2 id="ac-t">CONTAS</h2>
        <button type="button" className="act link" onClick={() => setEditing(editing === 'new' ? null : 'new')}>{editing === 'new' ? 'cancelar' : '+ nova conta'}</button>
      </div>
      {editing === 'new' && (
        <AccountForm onCancel={() => setEditing(null)} onSave={async (input) => (await act(() => api.createAccount(input), `conta "${input.name}" criada`)) && setEditing(null)} />
      )}
      <div className="table-wrap">
        <table className="t accounts">
          <thead>
            <tr><th>NOME</th><th className="hide-s">TIPO</th><th className="hide-s">APELIDOS</th><th className="r">SALDO</th><th className="r hide-s">CARTÃO</th><th><span className="sr">Ações</span></th></tr>
          </thead>
          <tbody>
            {accounts.map((a) =>
              editing === a.id ? (
                <tr key={a.id} className="editing">
                  <td colSpan={6}>
                    <AccountForm account={a} onCancel={() => setEditing(null)} onSave={async (input) => (await act(() => api.updateAccount(a.id, input), 'conta salva')) && setEditing(null)} />
                  </td>
                </tr>
              ) : (
                <tr key={a.id}>
                  <td style={{ color: 'var(--strong)' }}>{a.name}</td>
                  <td className="label hide-s">{KIND_LABEL[a.kind]}</td>
                  <td className="hide-s">{a.aliases.length ? a.aliases.map((x) => <span key={x} className="tag dim">{x}</span>) : <span className="label">—</span>}</td>
                  <td className={`r ${a.balanceCents < 0 ? 'over' : ''}`}>{formatPlain(a.balanceCents)}</td>
                  <td className="r label hide-s">
                    {a.kind === 'CREDIT_CARD' ? `livre ${formatPlain(a.availableCents ?? 0)} · fecha ${a.closingDay} · vence ${a.dueDay}` : '—'}
                  </td>
                  <td className="r acts">
                    <button type="button" className="act" onClick={() => setEditing(a.id)} aria-label={`Editar ${a.name}`}>editar</button>
                    <button
                      type="button"
                      className="act del"
                      aria-label={`Excluir ${a.name}`}
                      onClick={() => {
                        if (window.confirm(`Excluir a conta "${a.name}"? Os lançamentos antigos continuam no histórico.`)) act(() => api.deleteAccount(a.id), `conta "${a.name}" excluída`);
                      }}
                    >
                      excluir
                    </button>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      <p className="note">Apelidos são o que você digita no comando: "uber 23 transporte <b>nu</b>" lança no cartão com apelido "nu". Excluir uma conta não apaga o histórico.</p>
    </section>
  );
}

function AccountForm(props: { account?: api.Account; onSave: (input: api.AccountInput) => Promise<unknown>; onCancel: () => void }) {
  const a = props.account;
  const [name, setName] = useState(a?.name ?? '');
  const [kind, setKind] = useState<api.Account['kind']>(a?.kind ?? 'CHECKING');
  const [opening, setOpening] = useState(a ? formatPlain(a.openingBalanceCents) : '');
  const [aliases, setAliases] = useState(a?.aliases.join(', ') ?? '');
  const [limit, setLimit] = useState(a?.creditLimitCents ? formatPlain(a.creditLimitCents) : '');
  const [closing, setClosing] = useState(String(a?.closingDay ?? 5));
  const [due, setDue] = useState(String(a?.dueDay ?? 12));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const card = kind === 'CREDIT_CARD';
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const openingCents = opening.trim() ? parseSigned(opening) : 0;
    if (openingCents === null) return setError('saldo inicial inválido');
    const input: api.AccountInput = { name: name.trim(), aliases: cleanAliases(aliases), openingBalanceCents: openingCents };
    if (!a) input.kind = kind;
    if (card) {
      const l = limit.trim() ? parseBRL(limit) : null;
      if (limit.trim() && !l) return setError('limite inválido');
      Object.assign(input, { creditLimitCents: l, closingDay: Number(closing), dueDay: Number(due) });
    }
    setBusy(true);
    setError(null);
    await props.onSave(input);
    setBusy(false);
  }

  return (
    <form className="mono acc-form" onSubmit={submit} onKeyDown={(e: KeyboardEvent) => e.key === 'Escape' && props.onCancel()}>
      <label><span className="label">NOME</span><input ref={first} className="inl" value={name} onChange={(e) => setName(e.target.value)} placeholder="Conta Inter" required maxLength={60} /></label>
      <label>
        <span className="label">TIPO</span>
        <select className="inl" value={kind} onChange={(e) => setKind(e.target.value as api.Account['kind'])} disabled={Boolean(a)} title={a ? 'o tipo não muda depois de criada' : undefined}>
          {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </label>
      <label><span className="label">SALDO INICIAL</span><input className="inl r" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder={card ? '0,00 (ou -fatura atual)' : '0,00'} inputMode="decimal" /></label>
      <label><span className="label">APELIDOS</span><input className="inl" value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="inter, conta2" /></label>
      {card && (
        <>
          <label><span className="label">LIMITE</span><input className="inl r" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="5.000,00" inputMode="decimal" /></label>
          <label><span className="label">FECHA DIA</span><input className="inl r" type="number" min={1} max={31} value={closing} onChange={(e) => setClosing(e.target.value)} /></label>
          <label><span className="label">VENCE DIA</span><input className="inl r" type="number" min={1} max={31} value={due} onChange={(e) => setDue(e.target.value)} /></label>
        </>
      )}
      <div className="form-actions">
        {error && <span className="err">{error}</span>}
        <button type="button" className="act" onClick={props.onCancel}>cancelar</button>
        <button type="submit" className="btn sm" disabled={busy}>{busy ? 'salvando…' : a ? 'salvar' : 'criar conta'}</button>
      </div>
    </form>
  );
}

// ───────────────────────── categorias ─────────────────────────

function CategoriesPanel({ categories, act }: { categories: api.Category[]; act: Act }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'EXPENSE' | 'INCOME'>('EXPENSE');
  const [renaming, setRenaming] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (await act(() => api.createCategory(name.trim(), kind), `categoria "${name.trim()}" criada`)) setName('');
  }

  const group = (k: 'EXPENSE' | 'INCOME') => categories.filter((c) => c.kind === k);

  return (
    <aside className="panel" aria-labelledby="cat-t" data-tour="categorias">
      <h2 id="cat-t">CATEGORIAS</h2>
      {(['EXPENSE', 'INCOME'] as const).map((k) => (
        <div key={k} className="cat-group">
          <p className="label mono">{k === 'EXPENSE' ? 'DESPESAS' : 'RECEITAS'}</p>
          <ul className="cats mono">
            {group(k).map((c) => (
              <li key={c.id}>
                {renaming === c.id ? (
                  <RenameInput
                    initial={c.name}
                    onDone={async (v) => {
                      setRenaming(null);
                      if (v && v !== c.name) await act(() => api.renameCategory(c.id, v), `renomeada para "${v}"`);
                    }}
                  />
                ) : (
                  <button type="button" className="cellbtn" onClick={() => setRenaming(c.id)} aria-label={`Renomear ${c.name}`}>{c.name}</button>
                )}
                <span className="label" title="lançamentos nesta categoria">{c.transactionCount}</span>
                <button
                  type="button"
                  className="act del"
                  aria-label={`Excluir ${c.name}`}
                  onClick={() => {
                    if (window.confirm(`Excluir "${c.name}"? Os ${c.transactionCount} lançamentos continuam, e o orçamento dela sai.`)) act(() => api.deleteCategory(c.id), `categoria "${c.name}" excluída`);
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <form className="cat-add mono" onSubmit={add}>
        <input className="inl" value={name} onChange={(e) => setName(e.target.value)} placeholder="nova categoria" maxLength={40} aria-label="Nome da nova categoria" />
        <select className="inl" value={kind} onChange={(e) => setKind(e.target.value as 'EXPENSE' | 'INCOME')} aria-label="Tipo">
          <option value="EXPENSE">despesa</option>
          <option value="INCOME">receita</option>
        </select>
        <button type="submit" className="btn ghost sm">+</button>
      </form>
      <p className="note">Clique no nome para renomear. No comando, as 3 primeiras letras já bastam: "alim" vira Alimentação.</p>
    </aside>
  );
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (v: string | null) => void }) {
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      className="inl"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onDone(v.trim())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') onDone(null);
      }}
      maxLength={40}
      aria-label="Novo nome"
    />
  );
}

// ───────────────────────── contas fixas ─────────────────────────

function FixedPanel(props: { items: api.Recurrence[]; accounts: api.Account[]; categories: api.Category[]; act: Act }) {
  const { items, act } = props;
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const monthly = items.filter((i) => i.active).reduce((s, i) => s + (i.kind === 'EXPENSE' ? -i.amountCents : i.amountCents), 0);

  return (
    <section className="panel s4" aria-labelledby="fx-t" data-tour="fixas">
      <div className="ph">
        <h2 id="fx-t">CONTAS FIXAS</h2>
        <div className="ph-r mono">
          <span className="label hide-s">lançadas sozinhas no dia · saldo fixo do mês </span>
          <span className={monthly < 0 ? 'over' : 'gain'}>{monthly > 0 ? '+' : ''}{formatPlain(monthly)}</span>
          <button type="button" className="act link" style={{ marginLeft: 14 }} onClick={() => setEditing(editing === 'new' ? null : 'new')}>{editing === 'new' ? 'cancelar' : '+ nova conta fixa'}</button>
        </div>
      </div>
      {editing === 'new' && (
        <FixedForm accounts={props.accounts} categories={props.categories} onCancel={() => setEditing(null)} onSave={async (input) => (await act(() => api.createRecurrence(input), `"${input.description}" agendada`)) && setEditing(null)} />
      )}
      {items.length === 0 && editing !== 'new' ? (
        <p className="label mono empty">Nenhuma conta fixa. Cadastre aluguel, assinaturas ou o salário e elas entram sozinhas todo mês.</p>
      ) : (
        <div className="table-wrap">
          <table className="t fixed">
            <thead>
              <tr><th>DIA</th><th>DESCRIÇÃO</th><th className="hide-s">CATEGORIA</th><th className="hide-s">CONTA</th><th className="r">VALOR</th><th className="r hide-s">PRÓXIMA</th><th className="r hide-s">LANÇADA</th><th>ATIVA</th><th><span className="sr">Ações</span></th></tr>
            </thead>
            <tbody>
              {items.map((r) =>
                editing === r.id ? (
                  <tr key={r.id} className="editing">
                    <td colSpan={9}>
                      <FixedForm item={r} accounts={props.accounts} categories={props.categories} onCancel={() => setEditing(null)} onSave={async (input) => (await act(() => api.updateRecurrence(r.id, input), 'conta fixa salva')) && setEditing(null)} />
                    </td>
                  </tr>
                ) : (
                  <tr key={r.id} className={r.active ? '' : 'paused'}>
                    <td className="label">{String(r.dayOfMonth).padStart(2, '0')}</td>
                    <td style={{ color: 'var(--strong)' }}>{r.description}</td>
                    <td className="hide-s" style={{ color: 'var(--muted)' }}>{r.category.name}</td>
                    <td className="hide-s" style={{ color: 'var(--muted)' }}>{r.account.name}</td>
                    <td className={`r ${r.kind === 'INCOME' ? 'gain' : ''}`}>{r.kind === 'INCOME' ? '+' : '−'}{formatPlain(r.amountCents)}</td>
                    <td className="r label hide-s">{r.active ? fmtDay(r.nextRunOn) : 'pausada'}</td>
                    <td className="r label hide-s">{r.launched}×</td>
                    <td>
                      <button type="button" role="switch" aria-checked={r.active} className="switch" aria-label={`${r.active ? 'Pausar' : 'Reativar'} ${r.description}`} onClick={() => act(() => api.updateRecurrence(r.id, { active: !r.active }), r.active ? `"${r.description}" pausada` : `"${r.description}" reativada`)}>
                        <span />
                      </button>
                    </td>
                    <td className="r acts">
                      <button type="button" className="act" onClick={() => setEditing(r.id)} aria-label={`Editar ${r.description}`}>editar</button>
                      <button
                        type="button"
                        className="act del"
                        aria-label={`Excluir ${r.description}`}
                        onClick={() => {
                          if (window.confirm(`Excluir "${r.description}"? O que já foi lançado continua no histórico.`)) act(() => api.deleteRecurrence(r.id), `"${r.description}" excluída`);
                        }}
                      >
                        excluir
                      </button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
      <p className="note">O job roda a cada hora e lança no dia certo (dia 31 em fevereiro vira dia 28). Se o servidor ficar parado, ele lança os meses atrasados quando voltar.</p>
    </section>
  );
}

function FixedForm(props: { item?: api.Recurrence; accounts: api.Account[]; categories: api.Category[]; onSave: (input: api.RecurrenceInput) => Promise<unknown>; onCancel: () => void }) {
  const r = props.item;
  const [kind, setKind] = useState<'EXPENSE' | 'INCOME'>(r?.kind ?? 'EXPENSE');
  const [description, setDescription] = useState(r?.description ?? '');
  const [amount, setAmount] = useState(r ? formatPlain(r.amountCents) : '');
  const [day, setDay] = useState(String(r?.dayOfMonth ?? 10));
  const cats = props.categories.filter((c) => c.kind === kind);
  const [categoryId, setCategoryId] = useState(r?.category.id ?? cats[0]?.id ?? '');
  const [accountId, setAccountId] = useState(r?.account.id ?? props.accounts[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);

  useEffect(() => {
    if (!cats.some((c) => c.id === categoryId)) setCategoryId(cats[0]?.id ?? '');
  }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e: FormEvent) {
    e.preventDefault();
    const cents = parseBRL(amount);
    if (!cents || cents <= 0) return setError('valor inválido');
    const input: api.RecurrenceInput = { description: description.trim(), amountCents: cents, accountId, categoryId, dayOfMonth: Number(day) };
    if (!r) input.kind = kind;
    setBusy(true);
    setError(null);
    await props.onSave(input);
    setBusy(false);
  }

  return (
    <form className="mono acc-form" onSubmit={submit} onKeyDown={(e: KeyboardEvent) => e.key === 'Escape' && props.onCancel()}>
      <label>
        <span className="label">TIPO</span>
        <select className="inl" value={kind} onChange={(e) => setKind(e.target.value as 'EXPENSE' | 'INCOME')} disabled={Boolean(r)}>
          <option value="EXPENSE">despesa</option>
          <option value="INCOME">receita</option>
        </select>
      </label>
      <label><span className="label">DESCRIÇÃO</span><input ref={first} className="inl" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Aluguel" required maxLength={80} /></label>
      <label><span className="label">VALOR</span><input className="inl r" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1.850,00" inputMode="decimal" /></label>
      <label><span className="label">DIA</span><input className="inl r" type="number" min={1} max={31} value={day} onChange={(e) => setDay(e.target.value)} /></label>
      <label>
        <span className="label">CATEGORIA</span>
        <select className="inl" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </label>
      <label>
        <span className="label">CONTA</span>
        <select className="inl" value={accountId} onChange={(e) => setAccountId(e.target.value)}>{props.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
      </label>
      <div className="form-actions">
        {error && <span className="err">{error}</span>}
        <button type="button" className="act" onClick={props.onCancel}>cancelar</button>
        <button type="submit" className="btn sm" disabled={busy}>{busy ? 'salvando…' : r ? 'salvar' : 'agendar'}</button>
      </div>
    </form>
  );
}
