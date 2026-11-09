import { useCallback, useEffect, useState } from 'react';
import { CATALOG, PAY_LABEL, SLOT_HOURS, SLOT_LABEL, itemName } from '../shared/catalog.ts';
import { suppress } from '../shared/privacy.ts';
import { REGIONS } from '../shared/regions.ts';
import type { Summary } from '../shared/summary.ts';
import { addDays, dayFor } from '../shared/time.ts';
import type { Alert, AlertKind, Kiosk, PayType, PilotRequest, TimeSlot, TokenBatch } from '../shared/types.ts';
import { ApiError, liveApi, sampleApi, type Api } from './api.ts';
import { BarChart, HBars } from './charts.tsx';

type Tab = 'overview' | 'kiosks' | 'alerts' | 'tokens' | 'requests';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'kiosks', label: 'Kiosks' },
  { key: 'alerts', label: 'Alerts' },
  { key: 'tokens', label: 'Tokens & vouchers' },
  { key: 'requests', label: 'Pilot requests' },
];

const SESSION = 'ayhk-dashboard-session';

export default function Dashboard() {
  const [api, setApi] = useState<Api | null>(() => {
    try {
      const s = JSON.parse(sessionStorage.getItem(SESSION) ?? 'null') as { url: string; key: string } | null;
      if (s) return liveApi(s.url, s.key);
    } catch {
      /* no saved session */
    }
    return new URLSearchParams(location.search).get('sample') === '1' ? sampleApi() : null;
  });

  if (!api) return <SignIn onReady={setApi} />;
  return (
    <Shell
      api={api}
      onSignOut={() => {
        try {
          sessionStorage.removeItem(SESSION);
        } catch {
          /* ignore */
        }
        setApi(null);
      }}
    />
  );
}

function SignIn({ onReady }: { onReady: (a: Api) => void }) {
  const [url, setUrl] = useState(import.meta.env.VITE_API_URL ?? '');
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const a = liveApi(url, key);
    try {
      await a.kiosks();
      try {
        sessionStorage.setItem(SESSION, JSON.stringify({ url, key }));
      } catch {
        /* ignore */
      }
      onReady(a);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? 'That partner key isn’t right. Check it with your AYHK administrator.' : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="signin">
      <div className="signin-card">
        <Brand />
        <h1>Partner dashboard</h1>
        <p className="muted">Stock, alerts and anonymous demand for every AYHK kiosk in Ghana. Totals only. No personal data exists to show.</p>
        <form onSubmit={submit} className="stack">
          <label className="field">
            <span>Server address</span>
            <input id="si-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Leave empty if the dashboard is on the same site" />
          </label>
          <label className="field">
            <span>Partner key</span>
            <input id="si-key" type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="current-password" />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="btn primary" disabled={!key || busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <div className="divider">or</div>
        <button className="btn ghost" onClick={() => onReady(sampleApi())}>
          Explore with sample data
        </button>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <span className="brand">
      <svg width="26" height="26" viewBox="0 0 28 28" aria-hidden="true">
        <rect x="3" y="2" width="22" height="24" rx="6" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="14" cy="11" r="3" fill="currentColor" />
        <rect x="8" y="18" width="12" height="3" rx="1.5" fill="currentColor" />
      </svg>
      AYHK
    </span>
  );
}

function Shell({ api, onSignOut }: { api: Api; onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [days, setDays] = useState(30);
  const [region, setRegion] = useState('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let live = true;
    api
      .summary(days, region)
      .then((s) => live && (setSummary(s), setError('')))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [api, days, region, version]);

  useEffect(() => {
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div className="app">
      <header className="top">
        <div className="top-inner">
          <Brand />
          <span className="top-title">Partner dashboard</span>
          {api.mode === 'sample' && <span className="pill">Sample data</span>}
          <button className="btn small ghost-dark" onClick={onSignOut}>
            {api.mode === 'sample' ? 'Leave sample' : 'Sign out'}
          </button>
        </div>
        <nav className="tabs" aria-label="Sections">
          {TABS.map((t) => (
            <button key={t.key} className={tab === t.key ? 'on' : ''} aria-current={tab === t.key ? 'page' : undefined} onClick={() => setTab(t.key)}>
              {t.label}
              {t.key === 'alerts' && summary && summary.openAlerts.length > 0 && <span className="count">{summary.openAlerts.length}</span>}
            </button>
          ))}
        </nav>
      </header>

      <main className="main">
        {(tab === 'overview' || tab === 'kiosks' || tab === 'alerts') && (
          <div className="filters">
            <label>
              <span>Region</span>
              <select id="f-region" value={region} onChange={(e) => setRegion(e.target.value)}>
                <option value="">All of Ghana</option>
                {REGIONS.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Period</span>
              <select id="f-days" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
              </select>
            </label>
            <button className="btn small ghost" onClick={refresh}>
              Refresh
            </button>
          </div>
        )}
        {error && (
          <p className="error banner" role="alert">
            {error}
          </p>
        )}
        {!summary && !error && <p className="muted">Loading…</p>}
        {summary && tab === 'overview' && <Overview s={summary} days={days} region={region} />}
        {summary && tab === 'kiosks' && <Kiosks api={api} s={summary} onChange={refresh} />}
        {summary && tab === 'alerts' && <Alerts api={api} alerts={summary.openAlerts} kiosks={summary.kiosks.map((k) => k.kiosk)} onChange={refresh} />}
        {tab === 'tokens' && <Tokens api={api} />}
        {tab === 'requests' && <Requests api={api} />}
      </main>
      <footer className="foot muted">
        AYHK records only item, payment type, kiosk, day and time slot. Counts under 5 are shown as “&lt;5” in exports.
      </footer>
    </div>
  );
}

const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const pct = (x: number) => `${Math.round(x * 100)}%`;

function Overview({ s, days, region }: { s: Summary; days: number; region: string }) {
  const online = s.kiosks.filter((k) => k.online).length;
  const slots: TimeSlot[] = ['morning', 'afternoon', 'evening', 'night'];
  const pays: PayType[] = ['momo', 'token', 'voucher'];

  const exportCsv = () => {
    const rows = [['region', 'kiosks', 'vends']];
    for (const r of s.byRegion) rows.push([r.region, String(r.kiosks), suppress(r.count)]);
    rows.push([]);
    rows.push(['item', 'vends']);
    for (const r of s.byItem) rows.push([itemName(r.item), suppress(r.count)]);
    rows.push([]);
    rows.push(['time slot', 'vends']);
    for (const sl of slots) rows.push([SLOT_LABEL[sl], suppress(s.bySlot[sl])]);
    download(`ayhk-summary-${region || 'ghana'}-${days}d-${dayFor(new Date())}.csv`, rows.map((r) => r.join(',')).join('\n'));
  };

  return (
    <div className="stack-lg">
      <section className="kpis">
        <Kpi label="Items dispensed" value={s.total.toLocaleString()} sub={`Last ${days} days`} />
        <Kpi label="Paid by sponsors" value={pct(s.sponsoredShare)} sub="Tokens and vouchers" />
        <Kpi label="Kiosks online" value={`${online} of ${s.kiosks.length}`} sub="Checked in within 2 hours" />
        <Kpi label="Open alerts" value={String(s.openAlerts.length)} sub={s.openAlerts.length ? 'Needs attention' : 'All clear'} />
        <Kpi label="Tokens redeemed" value={`${s.tokens.redeemed.toLocaleString()}`} sub={`of ${s.tokens.issued.toLocaleString()} issued`} />
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Items dispensed per day</h2>
          <button className="btn small ghost" onClick={exportCsv}>
            Export totals (CSV)
          </button>
        </div>
        <BarChart
          values={s.byDay}
          labels={s.days.map(fmtDay)}
          tickEvery={Math.ceil(s.days.length / 8)}
          format={(v) => `${v} item${v === 1 ? '' : 's'}`}
          ariaLabel={`Items dispensed per day over the last ${days} days`}
        />
      </section>

      <div className="grid3">
        <section className="card">
          <h2>By item</h2>
          <HBars rows={s.byItem.map((r) => ({ label: itemName(r.item), value: r.count }))} />
        </section>
        <section className="card">
          <h2>By time of day</h2>
          <HBars rows={slots.map((sl) => ({ label: `${SLOT_LABEL[sl]} · ${SLOT_HOURS[sl]}`, value: s.bySlot[sl] }))} />
        </section>
        <section className="card">
          <h2>By payment</h2>
          <HBars rows={pays.map((p) => ({ label: PAY_LABEL[p], value: s.byPay[p] }))} />
        </section>
      </div>

      <section className="card">
        <h2>By region</h2>
        {s.byRegion.length === 0 ? (
          <p className="muted">No kiosks in this region yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Region</th>
                  <th className="num">Kiosks</th>
                  <th className="num">Items dispensed</th>
                  <th className="num">Per kiosk per day</th>
                </tr>
              </thead>
              <tbody>
                {s.byRegion.map((r) => (
                  <tr key={r.region}>
                    <td>{r.region}</td>
                    <td className="num">{r.kiosks}</td>
                    <td className="num">{r.count.toLocaleString()}</td>
                    <td className="num">{(r.count / r.kiosks / days).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small">Regions without a kiosk yet don’t appear. Ghana has 16 regions; {s.byRegion.length} have at least one kiosk.</p>
      </section>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <strong className="kpi-value">{value}</strong>
      <span className="kpi-sub">{sub}</span>
    </div>
  );
}

const STATUS_ICON = {
  ok: (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="var(--good)" />
      <path d="M4.5 8.2l2.2 2.2 4.6-4.8" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  warn: (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1.5l7 12.5H1z" fill="var(--warning)" />
      <path d="M8 6v4M8 11.8v.2" stroke="#1b1300" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  bad: (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="var(--critical)" />
      <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
};

function Kiosks({ api, s, onChange }: { api: Api; s: Summary; onChange: () => void }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="stack-lg">
      <section className="card">
        <div className="card-head">
          <h2>Kiosks</h2>
          <button className="btn small primary" onClick={() => setAdding((v) => !v)}>
            {adding ? 'Cancel' : 'Add a kiosk'}
          </button>
        </div>
        {adding && <AddKiosk api={api} onDone={() => (setAdding(false), onChange())} />}
        {s.kiosks.length === 0 ? (
          <p className="muted">No kiosks yet. Add your first kiosk, then set its ID on the machine.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Kiosk</th>
                  <th>Region</th>
                  <th>Status</th>
                  <th className="num">Temp.</th>
                  {CATALOG.map((c) => (
                    <th key={c.id}>{c.name}</th>
                  ))}
                  <th className="num">Dispensed</th>
                </tr>
              </thead>
              <tbody>
                {s.kiosks.map((row) => {
                  const t = row.status?.temperatureC;
                  const hot = t !== null && t !== undefined && (t < 15 || t > 25);
                  return (
                    <tr key={row.kiosk.id}>
                      <td>
                        <strong>{row.kiosk.id}</strong>
                        <div className="muted small">{row.kiosk.name}</div>
                      </td>
                      <td>{row.kiosk.region}</td>
                      <td>
                        <span className="status">
                          {!row.status ? STATUS_ICON.warn : row.online ? STATUS_ICON.ok : STATUS_ICON.bad}
                          {!row.status ? 'Never connected' : row.online ? 'Online' : `Offline since ${new Date(row.status.lastSeen).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}`}
                        </span>
                      </td>
                      <td className="num">
                        <span className={`status ${hot ? 'hot' : ''}`}>
                          {hot && STATUS_ICON.warn}
                          {t === null || t === undefined ? '—' : `${t.toFixed(1)} °C`}
                        </span>
                      </td>
                      {CATALOG.map((c) => {
                        const n = row.status?.stock[c.id] ?? 0;
                        const cap = row.kiosk.capacity[c.id] ?? 30;
                        const low = row.lowStock.includes(c.id);
                        return (
                          <td key={c.id}>
                            <div className={`stock ${low ? 'low' : ''}`} title={`${n} of ${cap}`}>
                              <span className="stock-track">
                                <span className="stock-fill" style={{ width: `${Math.min(100, (n / cap) * 100)}%` }} />
                              </span>
                              <span className="stock-num">
                                {row.status ? n : '—'}
                                {low && ' · Low'}
                              </span>
                            </div>
                          </td>
                        );
                      })}
                      <td className="num">{row.vends.toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function AddKiosk({ api, onDone }: { api: Api; onDone: () => void }) {
  const [f, setF] = useState({ id: '', name: '', region: '', district: '', siteType: 'school' });
  const [error, setError] = useState('');
  return (
    <form
      className="inline-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!f.region) return setError('Choose the kiosk’s region.');
        try {
          await api.addKiosk(f);
          onDone();
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <label className="field">
        <span>Kiosk ID</span>
        <input id="ak-id" value={f.id} onChange={(e) => setF({ ...f, id: e.target.value.toUpperCase() })} placeholder="e.g. GA-014" maxLength={12} />
      </label>
      <label className="field">
        <span>Site name</span>
        <input id="ak-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} />
      </label>
      <label className="field">
        <span>Region</span>
        <select id="ak-region" value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })}>
          <option value="">Choose a region</option>
          {REGIONS.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>District (optional)</span>
        <input id="ak-district" value={f.district} onChange={(e) => setF({ ...f, district: e.target.value })} maxLength={60} />
      </label>
      <label className="field">
        <span>Site type</span>
        <select id="ak-type" value={f.siteType} onChange={(e) => setF({ ...f, siteType: e.target.value })}>
          <option value="school">School</option>
          <option value="university">University</option>
          <option value="clinic">Clinic</option>
          <option value="community">Community centre</option>
          <option value="other">Other</option>
        </select>
      </label>
      <div className="inline-actions">
        <button className="btn primary">Add kiosk</button>
        {error && (
          <span className="error" role="alert">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}

const ALERT_LABEL: Record<AlertKind, string> = {
  tamper: 'Tamper',
  temperature: 'Temperature',
  'low-stock': 'Low stock',
  'dispense-fault': 'Dispense fault',
  offline: 'Offline',
  'token-reuse': 'Token reused',
};
const ALERT_SEVERITY: Record<AlertKind, 'bad' | 'warn'> = {
  tamper: 'bad',
  temperature: 'warn',
  'low-stock': 'warn',
  'dispense-fault': 'bad',
  offline: 'bad',
  'token-reuse': 'warn',
};

function Alerts({ api, alerts, kiosks, onChange }: { api: Api; alerts: Alert[]; kiosks: Kiosk[]; onChange: () => void }) {
  if (alerts.length === 0)
    return (
      <section className="card empty">
        <span className="status">{STATUS_ICON.ok} No open alerts.</span>
        <p className="muted">Tamper, temperature, stock, offline and dispense alerts will appear here.</p>
      </section>
    );
  return (
    <section className="card">
      <h2>Open alerts</h2>
      <ul className="alerts">
        {alerts.map((a) => {
          const k = kiosks.find((x) => x.id === a.kioskId);
          return (
            <li key={a.id} className={`alert sev-${ALERT_SEVERITY[a.kind]}`}>
              <span className="status">
                {STATUS_ICON[ALERT_SEVERITY[a.kind]]}
                <strong>{ALERT_LABEL[a.kind]}</strong>
              </span>
              <div className="alert-body">
                <span>{a.message}</span>
                <span className="muted small">
                  {a.kioskId}
                  {k ? ` · ${k.name} · ${k.region}` : ''} · {new Date(a.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
              </div>
              <button className="btn small ghost" onClick={async () => (await api.resolveAlert(a.id), onChange())}>
                Mark resolved
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Tokens({ api }: { api: Api }) {
  const [batches, setBatches] = useState<TokenBatch[] | null>(null);
  const [f, setF] = useState({ sponsor: '', kind: 'token' as 'token' | 'voucher', count: 50, expiresOn: addDays(dayFor(new Date()), 180), items: [] as string[] });
  const [error, setError] = useState('');
  const [created, setCreated] = useState<TokenBatch | null>(null);
  const load = useCallback(() => void api.batches().then(setBatches).catch((e: Error) => setError(e.message)), [api]);
  useEffect(load, [load]);

  const csv = (b: TokenBatch) =>
    download(
      `ayhk-${b.kind}s-${b.sponsor.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${b.createdOn}.csv`,
      ['code,sponsor,type,expires', ...b.codes.map((c) => `${c.code},"${b.sponsor.replace(/"/g, '""')}",${b.kind},${b.expiresOn}`)].join('\n'),
    );

  return (
    <div className="stack-lg">
      <section className="card">
        <h2>Create sponsored codes</h2>
        <p className="muted">Each code dispenses one free item. Codes carry no information about who receives them, so print and hand them out freely.</p>
        <form
          className="inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setError('');
            try {
              const b = await api.createBatch(f);
              setCreated(b);
              load();
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          <label className="field">
            <span>Sponsor</span>
            <input id="tb-sponsor" value={f.sponsor} onChange={(e) => setF({ ...f, sponsor: e.target.value })} placeholder="School, clinic or NGO" maxLength={80} />
          </label>
          <label className="field">
            <span>Type</span>
            <select id="tb-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as 'token' | 'voucher' })}>
              <option value="token">Sponsored token</option>
              <option value="voucher">Clinic voucher</option>
            </select>
          </label>
          <label className="field">
            <span>How many</span>
            <input id="tb-count" type="number" min={1} max={5000} value={f.count} onChange={(e) => setF({ ...f, count: Number(e.target.value) })} />
          </label>
          <label className="field">
            <span>Expires on</span>
            <input id="tb-exp" type="date" value={f.expiresOn} onChange={(e) => setF({ ...f, expiresOn: e.target.value })} />
          </label>
          <fieldset className="field checks">
            <legend>Valid for</legend>
            {CATALOG.map((c) => (
              <label key={c.id}>
                <input
                  type="checkbox"
                  checked={f.items.length === 0 || f.items.includes(c.id)}
                  onChange={(e) => {
                    const all = f.items.length === 0 ? CATALOG.map((x) => x.id) : f.items;
                    const next = e.target.checked ? [...all, c.id] : all.filter((x) => x !== c.id);
                    setF({ ...f, items: next.length === CATALOG.length ? [] : next });
                  }}
                />
                {c.name}
              </label>
            ))}
          </fieldset>
          <div className="inline-actions">
            <button className="btn primary">Create codes</button>
            {error && (
              <span className="error" role="alert">
                {error}
              </span>
            )}
          </div>
        </form>
        {created && (
          <div className="created" role="status">
            <span>
              Created {created.codes.length} codes for {created.sponsor}.
            </span>
            <button className="btn small primary" onClick={() => csv(created)}>
              Download codes (CSV)
            </button>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Batches</h2>
        {!batches ? (
          <p className="muted">Loading…</p>
        ) : batches.length === 0 ? (
          <p className="muted">No codes yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Sponsor</th>
                  <th>Type</th>
                  <th>Created</th>
                  <th>Expires</th>
                  <th>Redeemed</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {[...batches].reverse().map((b) => {
                  const used = b.codes.filter((c) => c.usedOn).length;
                  return (
                    <tr key={b.id}>
                      <td>{b.sponsor}</td>
                      <td>{b.kind === 'voucher' ? 'Clinic voucher' : 'Sponsored token'}</td>
                      <td>{fmtDay(b.createdOn)}</td>
                      <td>{fmtDay(b.expiresOn)}</td>
                      <td>
                        <div className="stock">
                          <span className="stock-track">
                            <span className="stock-fill" style={{ width: `${(used / b.codes.length) * 100}%` }} />
                          </span>
                          <span className="stock-num">
                            {used} / {b.codes.length}
                          </span>
                        </div>
                      </td>
                      <td>
                        <button className="btn small ghost" onClick={() => csv(b)}>
                          Download
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Requests({ api }: { api: Api }) {
  const [rows, setRows] = useState<PilotRequest[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => void api.pilotRequests().then(setRows).catch((e: Error) => setError(e.message)), [api]);
  return (
    <section className="card">
      <h2>Pilot requests from the website</h2>
      {error && <p className="error">{error}</p>}
      {!rows ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">No requests yet. They arrive here when someone fills in “Bring AYHK to your campus” on the website.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Received</th>
                <th>Name</th>
                <th>Organisation</th>
                <th>Role</th>
                <th>Region</th>
                <th>Email</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.createdAt).toLocaleDateString()}</td>
                  <td>{r.name}</td>
                  <td>{r.organisation}</td>
                  <td>{r.role}</td>
                  <td>{r.region || '—'}</td>
                  <td className="selectable">{r.email}</td>
                  <td className="msg">{r.message || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
