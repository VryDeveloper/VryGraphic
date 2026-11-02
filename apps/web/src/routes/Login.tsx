import { useState, type FormEvent } from 'react';
import * as api from '../lib/api';

export function Login({ onLogin }: { onLogin: (u: api.User) => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<api.User>) {
    setBusy(true);
    setError(null);
    try {
      onLogin(await fn());
    } catch (e) {
      const err = e as api.ApiError;
      setError(err.fields ? Object.values(err.fields).join(' · ') : err.message);
    } finally {
      setBusy(false);
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(() => (mode === 'login' ? api.login(email, password) : api.register(name, email, password)));
  };

  return (
    <div className="login">
      <header>VRYGRAPHIC</header>
      <section>
        <h1>Seu mês, lido como um terminal.</h1>
        <p className="lead">
          VryGraphic é um controle financeiro pessoal. Cada lançamento vira saldo diário, alocação do salário, alertas de orçamento e
          previsão de metas, calculados no banco de dados.
        </p>
      </section>
      <section>
        <form onSubmit={submit} aria-labelledby="form-t">
          <h2 id="form-t" style={{ margin: 0, fontSize: 22 }}>{mode === 'login' ? 'Entrar' : 'Criar conta'}</h2>
          <button type="button" className="btn" disabled={busy} onClick={() => run(() => api.login('demo@vrygraphic.dev', 'demo12345'))}>
            Entrar na demonstração ↵
          </button>
          <p className="label" style={{ margin: 0, textAlign: 'center' }}>Usuário criado pelo comando de seed.</p>
          {mode === 'signup' && (
            <label className="field">Nome<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
          )}
          <label className="field">E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
          <label className="field">
            Senha
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} aria-describedby="pw" />
          </label>
          <p id="pw" className="label" style={{ margin: '-6px 0 0' }}>Pelo menos 8 caracteres.</p>
          {error && <p className="err" role="alert">{error}</p>}
          <button type="submit" className="btn ghost" disabled={busy}>{mode === 'login' ? 'Entrar com e-mail' : 'Criar conta'}</button>
          <p style={{ margin: 0, textAlign: 'center', color: '#a9b6af' }}>
            {mode === 'login' ? 'Ainda não tem conta? ' : 'Já tem conta? '}
            <button type="button" className="chip" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
              {mode === 'login' ? 'Criar conta' : 'Entrar'}
            </button>
          </p>
        </form>
      </section>
    </div>
  );
}
