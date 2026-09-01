import { useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { applyDecoyTheme, decoyTheme } from './theme';
import { decoyApi, type DecoyLead, type DecoyUser } from './api';
import './decoy.css';

applyDecoyTheme();

function LoginPage({ onOk }: { onOk: (u: DecoyUser) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch('/api-decoy/auth.php?action=beacon', { credentials: 'include' }).catch(() => {});
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await decoyApi.login(email.trim(), password);
      onOk(res.data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid email or password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="decoy-login">
      <div className="decoy-login-card">
        <div className="decoy-brand">
          <div className="decoy-logo" aria-hidden />
          <div>
            <h1>{decoyTheme.name}</h1>
            <p>CRM · Internal access</p>
          </div>
        </div>
        <form onSubmit={submit}>
          <label>
            Email
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error ? <div className="decoy-error">{error}</div> : null}
          <button type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}

function Dashboard({ user, onLogout }: { user: DecoyUser; onLogout: () => void }) {
  const [stats, setStats] = useState<{
    total: number;
    new: number;
    pipeline: number;
    enrolled: number;
    lost: number;
  } | null>(null);
  const [leads, setLeads] = useState<DecoyLead[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const pageSize = 50;

  async function load(p = page, q = search) {
    setLoading(true);
    try {
      const [d, l] = await Promise.all([
        decoyApi.dashboard(),
        decoyApi.leads({ limit: pageSize, offset: p * pageSize, search: q || undefined }),
      ]);
      setStats(d.data);
      setLeads(l.data || []);
      setTotal(l.total || 0);
    } catch {
      /* session expired */
      onLogout();
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(0, '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="decoy-shell">
      <aside className="decoy-nav">
        <div className="decoy-brand compact">
          <div className="decoy-logo" aria-hidden />
          <span>{decoyTheme.name}</span>
        </div>
        <nav>
          <a className="active" href="#leads">
            Leads
          </a>
        </nav>
        <div className="decoy-nav-foot">
          <div className="decoy-muted">{user.full_name}</div>
          <button type="button" className="link" onClick={() => void decoyApi.logout().then(onLogout)}>
            Sign out
          </button>
        </div>
      </aside>
      <main>
        <header className="decoy-top">
          <div>
            <h2>Leads Management</h2>
            <p className="decoy-muted">
              {stats ? `${stats.total.toLocaleString()} leads` : 'Loading…'} · Legacy workspace
            </p>
          </div>
          <a className="decoy-btn" href={decoyApi.exportUrl()}>
            Export Leads (CSV)
          </a>
        </header>

        {stats ? (
          <div className="decoy-stats">
            <div className="stat">
              <span>Total</span>
              <strong>{stats.total.toLocaleString()}</strong>
            </div>
            <div className="stat">
              <span>New</span>
              <strong>{stats.new.toLocaleString()}</strong>
            </div>
            <div className="stat">
              <span>Pipeline</span>
              <strong>{stats.pipeline.toLocaleString()}</strong>
            </div>
            <div className="stat">
              <span>Enrolled</span>
              <strong>{stats.enrolled.toLocaleString()}</strong>
            </div>
            <div className="stat">
              <span>Lost</span>
              <strong>{stats.lost.toLocaleString()}</strong>
            </div>
          </div>
        ) : null}

        <div className="decoy-toolbar">
          <input
            placeholder="Search leads…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setPage(0);
                void load(0, search);
              }
            }}
          />
          <button
            type="button"
            className="decoy-btn secondary"
            onClick={() => {
              setPage(0);
              void load(0, search);
            }}
          >
            Search
          </button>
        </div>

        <div className="decoy-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Source</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6}>Loading…</td>
                </tr>
              ) : leads.length === 0 ? (
                <tr>
                  <td colSpan={6}>No leads</td>
                </tr>
              ) : (
                leads.map((l) => (
                  <tr key={l.id}>
                    <td>{l.name}</td>
                    <td>{l.email}</td>
                    <td>{l.phone}</td>
                    <td>{l.source}</td>
                    <td>
                      <span className="pill">{l.status}</span>
                    </td>
                    <td>{String(l.created_at || '').slice(0, 10)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="decoy-pager">
          <button
            type="button"
            disabled={page <= 0}
            onClick={() => {
              const n = page - 1;
              setPage(n);
              void load(n, search);
            }}
          >
            Previous
          </button>
          <span className="decoy-muted">
            Page {page + 1} · {total.toLocaleString()} total
          </span>
          <button
            type="button"
            disabled={(page + 1) * pageSize >= total}
            onClick={() => {
              const n = page + 1;
              setPage(n);
              void load(n, search);
            }}
          >
            Next
          </button>
        </div>
      </main>
    </div>
  );
}

function App() {
  const [user, setUser] = useState<DecoyUser | null>(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    void decoyApi
      .me()
      .then((r) => setUser(r.data))
      .catch(() => setUser(null))
      .finally(() => setBooting(false));
  }, []);

  if (booting) {
    return <div className="decoy-boot">Loading…</div>;
  }
  if (!user) {
    return <LoginPage onOk={setUser} />;
  }
  return <Dashboard user={user} onLogout={() => setUser(null)} />;
}

createRoot(document.getElementById('root')!).render(<App />);
