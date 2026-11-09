import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CATALOG, GENERAL_TIP, TIPS, cedis } from '../shared/catalog.ts';
import { dayFor, randomId, slotFor } from '../shared/time.ts';
import { isWellFormed, normaliseToken } from '../shared/tokens.ts';
import type { PayType, VendEvent } from '../shared/types.ts';
import { config } from './config.ts';
import { BridgeHardware, SimHardware, type Hardware } from './hardware.ts';
import { outbox, redeemOnline } from './outbox.ts';
import { en as t } from './strings.ts';

type Screen = 'attract' | 'choose' | 'pay' | 'momo' | 'code' | 'dispensing' | 'done' | 'fault';

const hardware: Hardware = config.hardware === 'bridge' ? new BridgeHardware(config.bridgeUrl) : new SimHardware();

const STOCK_KEY = 'ayhk-stock-v1';
function loadStock(): Record<string, number> {
  if (!config.demo) {
    try {
      const raw = localStorage.getItem(STOCK_KEY);
      if (raw) return { ...config.capacity, ...JSON.parse(raw) };
    } catch {
      /* fall through */
    }
  }
  return { ...config.capacity };
}

function useHardwareState() {
  const [s, setS] = useState(hardware.state());
  useEffect(() => hardware.subscribe(() => setS({ ...hardware.state() })), []);
  return s;
}

const reference = () => String(Math.floor(1000 + Math.random() * 9000));

export default function Kiosk() {
  const [screen, setScreen] = useState<Screen>('attract');
  const [item, setItem] = useState('');
  const [pay, setPay] = useState<PayType>('momo');
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [checking, setChecking] = useState(false);
  const [momoRef, setMomoRef] = useState('');
  const [momoError, setMomoError] = useState(false);
  const [tip, setTip] = useState('');
  const [stock, setStock] = useState(loadStock);
  const [idleLeft, setIdleLeft] = useState<number | null>(null);
  const [serviceVisit, setServiceVisit] = useState(false);
  const [techOpen, setTechOpen] = useState(config.showTech);
  const [lastSync, setLastSync] = useState<string>('never');
  const hw = useHardwareState();
  const lastTouch = useRef(Date.now());
  const payAbort = useRef<AbortController | null>(null);
  const logoTaps = useRef<number[]>([]);
  const alerted = useRef<Record<string, number>>({});

  const selected = CATALOG.find((c) => c.id === item);

  // ---------- Persistence & alerts ----------
  useEffect(() => {
    if (config.demo) return;
    try {
      localStorage.setItem(STOCK_KEY, JSON.stringify(stock));
    } catch {
      /* ignore */
    }
  }, [stock]);

  const raise = useCallback((kind: 'tamper' | 'temperature' | 'low-stock' | 'dispense-fault', message: string, dedupeKey: string = kind, everyMs = 3_600_000) => {
    const last = alerted.current[dedupeKey] ?? 0;
    if (Date.now() - last < everyMs) return;
    alerted.current[dedupeKey] = Date.now();
    outbox.add({ alerts: [{ id: randomId('al_'), kind, message, createdAt: new Date().toISOString() }] });
  }, []);

  useEffect(() => {
    if (hw.doorOpen && !serviceVisit) raise('tamper', 'Service door opened outside a restock visit.', 'tamper', 600_000);
  }, [hw.doorOpen, serviceVisit, raise]);

  useEffect(() => {
    const { min, max } = config.safeTemperature;
    if (hw.temperatureC !== null && (hw.temperatureC < min || hw.temperatureC > max))
      raise('temperature', `Temperature ${hw.temperatureC.toFixed(1)} °C is outside the safe range (${min}–${max} °C).`);
  }, [hw.temperatureC, raise]);

  // ---------- Sync loop ----------
  const status = useMemo(() => ({ stock, temperatureC: hw.temperatureC, doorOpen: hw.doorOpen }), [stock, hw]);
  const statusRef = useRef(status);
  statusRef.current = status;
  const syncNow = useCallback(async () => {
    const r = await outbox.sync(statusRef.current);
    setLastSync(r === 'ok' ? new Date().toLocaleTimeString() : r === 'offline' ? 'offline, will retry' : 'server refused, will retry');
  }, []);
  useEffect(() => {
    void syncNow();
    const id = setInterval(() => void syncNow(), config.syncEverySeconds * 1000);
    return () => clearInterval(id);
  }, [syncNow]);

  // ---------- Reset & idle ----------
  const reset = useCallback(() => {
    payAbort.current?.abort();
    setScreen('attract');
    setItem('');
    setCode('');
    setCodeError('');
    setMomoError(false);
    setIdleLeft(null);
  }, []);

  useEffect(() => {
    const touch = () => {
      lastTouch.current = Date.now();
      setIdleLeft(null);
    };
    window.addEventListener('pointerdown', touch);
    window.addEventListener('input', touch);
    return () => {
      window.removeEventListener('pointerdown', touch);
      window.removeEventListener('input', touch);
    };
  }, []);

  useEffect(() => {
    if (screen === 'attract' || screen === 'dispensing') return;
    lastTouch.current = Date.now();
    const id = setInterval(() => {
      const idle = (Date.now() - lastTouch.current) / 1000;
      const limit = screen === 'done' || screen === 'fault' ? 20 : config.idleResetSeconds;
      if (idle >= limit) reset();
      else if (limit - idle <= 10 && screen !== 'done') setIdleLeft(Math.ceil(limit - idle));
    }, 500);
    return () => clearInterval(id);
  }, [screen, reset]);

  // ---------- Vend ----------
  const dispense = useCallback(
    async (paidWith: PayType, redemption?: { code: string; offline: boolean }) => {
      setScreen('dispensing');
      const result = await hardware.dispense(item);
      const now = new Date();
      if (result === 'jammed') {
        raise('dispense-fault', `${selected?.name ?? item} did not drop.`, `fault-${item}`, 600_000);
        setScreen('fault');
        return;
      }
      const event: VendEvent = { id: randomId('v_'), kioskId: config.kioskId, item, pay: paidWith, day: dayFor(now), slot: slotFor(now) };
      outbox.add({ events: [event], redemptions: redemption?.offline ? [{ code: redemption.code, day: event.day }] : [] });
      const left = Math.max(0, (stock[item] ?? 0) - 1);
      setStock((s) => ({ ...s, [item]: left }));
      const capacity = config.capacity[item] ?? 30;
      if (left <= Math.max(1, Math.floor(capacity * 0.2))) raise('low-stock', `${selected?.name ?? item} is low (${left} left).`, `low-${item}`, 86_400_000);
      const tips = TIPS[item] ?? [GENERAL_TIP];
      setTip(tips[Math.floor(Math.random() * tips.length)]);
      setScreen('done');
      if (config.demo) window.parent?.postMessage({ type: 'ayhk-vend', event: { item: event.item, pay: event.pay, kiosk: event.kioskId, slot: event.slot } }, '*');
      void syncNow();
    },
    [item, selected, stock, raise, syncNow],
  );

  const startMomo = useCallback(async () => {
    if (!selected) return;
    const ref = reference();
    setMomoRef(ref);
    setMomoError(false);
    setScreen('momo');
    payAbort.current?.abort();
    const ctrl = new AbortController();
    payAbort.current = ctrl;
    const r = await hardware.awaitPayment(selected.pricePesewas, ref, ctrl.signal);
    if (ctrl.signal.aborted || r === 'cancelled') return;
    if (r === 'paid') void dispense('momo');
    else setMomoError(true);
  }, [selected, dispense]);

  const submitCode = useCallback(async () => {
    const c = normaliseToken(code);
    if (!isWellFormed(c)) {
      setCodeError(t.codeInvalid);
      return;
    }
    setChecking(true);
    const online = await redeemOnline(c, item);
    setChecking(false);
    if (online === null) return void dispense(pay, { code: c, offline: !config.demo });
    const msg = { ok: '', invalid: t.codeInvalid, used: t.codeUsed, expired: t.codeExpired, 'not-allowed': t.codeNotAllowed }[online] ?? t.codeInvalid;
    if (msg) setCodeError(msg);
    else void dispense(pay, { code: c, offline: false });
  }, [code, item, pay, dispense]);

  const outOfService = (hw.doorOpen && !serviceVisit) || CATALOG.every((c) => (stock[c.id] ?? 0) <= 0);

  const onLogo = () => {
    const now = Date.now();
    logoTaps.current = [...logoTaps.current.filter((x) => now - x < 3000), now];
    if (logoTaps.current.length >= 5) {
      logoTaps.current = [];
      setTechOpen((v) => !v);
    }
  };

  return (
    <div className="kiosk">
      <header className="bar">
        <button className="logo" onClick={onLogo} aria-label="AYHK">
          <svg width="26" height="26" viewBox="0 0 28 28" aria-hidden="true">
            <rect x="3" y="2" width="22" height="24" rx="6" fill="none" stroke="currentColor" strokeWidth="2" />
            <circle cx="14" cy="11" r="3" fill="currentColor" />
            <rect x="8" y="18" width="12" height="3" rx="1.5" fill="currentColor" />
          </svg>
          AYHK
        </button>
        {config.demo && <span className="demo-pill">Demo</span>}
        {screen !== 'attract' && screen !== 'dispensing' && (
          <button className="exit" onClick={reset} aria-label={t.exitLabel}>
            ✕ {t.exit}
          </button>
        )}
      </header>

      <main className="screen">
        {outOfService && !techOpen ? (
          <section className="center">
            <h1>{t.outOfService}</h1>
            <p className="sub">{t.outOfServiceBody}</p>
          </section>
        ) : (
          <>
            {screen === 'attract' && (
              <section className="attract">
                <div>
                  <h1 className="big">{t.attractTitle}</h1>
                  <p className="sub">{t.attractBody}</p>
                </div>
                <button className="primary huge pulse" onClick={() => setScreen('choose')}>
                  {t.touchToStart}
                </button>
              </section>
            )}

            {screen === 'choose' && (
              <section className="step">
                <div className="step-head">
                  <span className="eyebrow">{t.chooseStep}</span>
                  <h1>{t.chooseTitle}</h1>
                </div>
                <div className="options three">
                  {CATALOG.map((c) => {
                    const out = (stock[c.id] ?? 0) <= 0;
                    return (
                      <button key={c.id} className={`option ${item === c.id ? 'on' : ''}`} disabled={out} aria-pressed={item === c.id} onClick={() => setItem(c.id)}>
                        <span className="opt-name">{c.name}</span>
                        <span className="opt-note">{out ? t.soldOut : c.note}</span>
                        <span className="opt-price">{cedis(c.pricePesewas)}</span>
                      </button>
                    );
                  })}
                </div>
                <button className="primary wide" disabled={!item} onClick={() => setScreen('pay')}>
                  {t.continue}
                </button>
              </section>
            )}

            {screen === 'pay' && selected && (
              <section className="step">
                <div className="step-head">
                  <span className="eyebrow">{t.payStep}</span>
                  <h1>{t.payTitle}</h1>
                  <p className="sub small">{t.paySubtitle}</p>
                </div>
                <div className="options three">
                  <button className="option" onClick={() => (setPay('momo'), void startMomo())}>
                    <span className="opt-name">{t.payMomo}</span>
                    <span className="opt-note">{t.payMomoNote}</span>
                    <span className="opt-price">{cedis(selected.pricePesewas)}</span>
                  </button>
                  <button className="option" onClick={() => (setPay('token'), setCode(''), setCodeError(''), setScreen('code'))}>
                    <span className="opt-name">{t.payToken}</span>
                    <span className="opt-note">{t.payTokenNote}</span>
                    <span className="opt-price">{t.free}</span>
                  </button>
                  <button className="option" onClick={() => (setPay('voucher'), setCode(''), setCodeError(''), setScreen('code'))}>
                    <span className="opt-name">{t.payVoucher}</span>
                    <span className="opt-note">{t.payVoucherNote}</span>
                    <span className="opt-price">{t.free}</span>
                  </button>
                </div>
                <button className="link" onClick={() => setScreen('choose')}>
                  ← {t.back}
                </button>
              </section>
            )}

            {screen === 'momo' && selected && (
              <section className="step">
                <div className="step-head">
                  <span className="eyebrow">Step 3 of 3</span>
                  <h1>
                    {t.momoTitle} · {cedis(selected.pricePesewas)}
                  </h1>
                </div>
                <div className="momo">
                  <div className="momo-tap">
                    <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
                      <rect x="16" y="6" width="24" height="44" rx="5" fill="none" stroke="currentColor" strokeWidth="3" />
                      <path d="M44 18c4 4 4 16 0 20M48 13c7 7 7 23 0 30" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                    <span>{t.momoTap}</span>
                  </div>
                  {config.merchantId && (
                    <>
                      <div className="momo-or">{t.momoOr}</div>
                      <dl className="momo-codes">
                        <div>
                          <dt>{t.momoMerchant}</dt>
                          <dd>{config.merchantId}</dd>
                        </div>
                        <div>
                          <dt>{t.momoReference}</dt>
                          <dd>{momoRef}</dd>
                        </div>
                      </dl>
                    </>
                  )}
                </div>
                {momoError ? (
                  <div className="row">
                    <p className="error">{t.momoDeclined}</p>
                    <button className="primary" onClick={() => void startMomo()}>
                      Try again
                    </button>
                  </div>
                ) : (
                  <p className="sub small waiting">{t.momoWaiting}</p>
                )}
                <button className="link" onClick={() => (payAbort.current?.abort(), setScreen('pay'))}>
                  ← {t.back}
                </button>
              </section>
            )}

            {screen === 'code' && (
              <section className="step">
                <div className="step-head">
                  <span className="eyebrow">Step 3 of 3</span>
                  <h1>{pay === 'voucher' ? t.codeTitleVoucher : t.codeTitleToken}</h1>
                  <p className="sub small">{t.codeHint}</p>
                </div>
                <form
                  className="code-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submitCode();
                  }}
                >
                  <label htmlFor="code" className="sr-only">
                    Code
                  </label>
                  <input
                    id="code"
                    value={code}
                    onChange={(e) => (setCode(e.target.value.toUpperCase()), setCodeError(''))}
                    placeholder="AYHK-XXXX-XXXX"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    autoFocus
                    maxLength={16}
                    aria-invalid={Boolean(codeError)}
                    aria-describedby="code-error"
                  />
                  <button className="primary" type="submit" disabled={code.replace(/[^A-Z0-9]/gi, '').length < 8 || checking}>
                    {checking ? t.checking : t.codeSubmit}
                  </button>
                </form>
                <p id="code-error" className="error" role="alert">
                  {codeError}
                </p>
                <button className="link" onClick={() => setScreen('pay')}>
                  ← {t.back}
                </button>
              </section>
            )}

            {screen === 'dispensing' && (
              <section className="center">
                <h1>{t.dispensing}</h1>
                <div className="progress">
                  <div className="progress-bar" />
                </div>
                <p className="sub">{t.takeItem}</p>
              </section>
            )}

            {screen === 'done' && (
              <section className="center done">
                <div className="check" aria-hidden="true">
                  <svg width="30" height="30" viewBox="0 0 28 28">
                    <path d="M6 14l5 5 11-11" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <h1>{t.doneTitle}</h1>
                <p className="sub">{t.doneBody}</p>
                <p className="tip">
                  <strong>{t.tipLabel}:</strong> {tip}
                </p>
                <button className="primary" onClick={reset}>
                  {t.finish}
                </button>
              </section>
            )}

            {screen === 'fault' && (
              <section className="center">
                <h1>{t.faultTitle}</h1>
                <p className="sub">{pay === 'momo' ? t.faultPaid : t.faultToken}</p>
                <button className="primary" onClick={reset}>
                  {t.finish}
                </button>
              </section>
            )}
          </>
        )}
      </main>

      {idleLeft !== null && (
        <div className="idle" role="alertdialog" aria-label={t.stillThere}>
          <div className="idle-card">
            <h2>{t.stillThere}</h2>
            <p>
              {t.stillThereBody} {idleLeft}s.
            </p>
            <button className="primary" onClick={() => setIdleLeft(null)}>
              {t.imHere}
            </button>
          </div>
        </div>
      )}

      {techOpen && (
        <TechPanel
          stock={stock}
          onRestock={() => setStock({ ...config.capacity })}
          serviceVisit={serviceVisit}
          setServiceVisit={setServiceVisit}
          lastSync={lastSync}
          onSync={() => void syncNow()}
          onClose={() => setTechOpen(false)}
        />
      )}
    </div>
  );
}

function TechPanel(props: {
  stock: Record<string, number>;
  onRestock: () => void;
  serviceVisit: boolean;
  setServiceVisit: (v: boolean) => void;
  lastSync: string;
  onSync: () => void;
  onClose: () => void;
}) {
  const hw = useHardwareState();
  const sim = hardware instanceof SimHardware ? hardware : null;
  const [, force] = useState(0);
  return (
    <aside className="tech" aria-label="Technician panel">
      <div className="tech-head">
        <strong>Technician · {config.kioskId}</strong>
        <button onClick={props.onClose}>Close</button>
      </div>
      <div className="tech-grid">
        <div>
          <h3>Stock</h3>
          {CATALOG.map((c) => (
            <div key={c.id} className="tech-row">
              <span>{c.name}</span>
              <b>
                {props.stock[c.id] ?? 0}/{config.capacity[c.id]}
              </b>
            </div>
          ))}
          <label className="tech-check">
            <input type="checkbox" checked={props.serviceVisit} onChange={(e) => props.setServiceVisit(e.target.checked)} /> Restock visit (door may open)
          </label>
          <button onClick={props.onRestock} disabled={!props.serviceVisit}>
            Mark as fully restocked
          </button>
        </div>
        <div>
          <h3>Machine</h3>
          <div className="tech-row">
            <span>Temperature</span>
            <b>{hw.temperatureC === null ? '—' : `${hw.temperatureC.toFixed(1)} °C`}</b>
          </div>
          <div className="tech-row">
            <span>Door</span>
            <b>{hw.doorOpen ? 'Open' : 'Closed'}</b>
          </div>
          <div className="tech-row">
            <span>Waiting to sync</span>
            <b>{outbox.size()}</b>
          </div>
          <div className="tech-row">
            <span>Last sync</span>
            <b>{props.lastSync}</b>
          </div>
          <button onClick={() => (props.onSync(), force((n) => n + 1))}>Sync now</button>
        </div>
        {sim && (
          <div>
            <h3>Simulator</h3>
            <button onClick={() => sim.set({ doorOpen: !sim.doorOpen })}>{hw.doorOpen ? 'Close door' : 'Open door'}</button>
            <button onClick={() => sim.set({ temperatureC: (sim.temperatureC ?? 23) > 25 ? 23.2 : 27.5 })}>{(hw.temperatureC ?? 0) > 25 ? 'Cool down' : 'Overheat'}</button>
            <button onClick={() => (sim.set({ jamNext: true }), force((n) => n + 1))}>{sim.jamNext ? 'Next vend will jam' : 'Jam next vend'}</button>
            <button onClick={() => (sim.set({ declineNext: true }), force((n) => n + 1))}>{sim.declineNext ? 'Next payment declines' : 'Decline next payment'}</button>
          </div>
        )}
      </div>
    </aside>
  );
}
