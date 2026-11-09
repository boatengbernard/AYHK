import { CATALOG } from '../src/shared/catalog.ts';
import { sanitizeEvent } from '../src/shared/privacy.ts';
import { REGIONS } from '../src/shared/regions.ts';
import { summarize } from '../src/shared/summary.ts';
import { dayFor, randomId } from '../src/shared/time.ts';
import { isWellFormed, makeToken, normaliseToken } from '../src/shared/tokens.ts';
import type { Alert, AlertKind, Kiosk, RedeemResult, TokenBatch } from '../src/shared/types.ts';
import type { Store } from './db.ts';

export interface Keys {
  partner: string;
  kiosk: string;
}

export interface Req {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string | undefined>;
  body: unknown;
}

export interface Res {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

const ok = (body: unknown = { ok: true }): Res => ({ status: 200, body });
const err = (status: number, message: string): Res => ({ status, body: { error: message } });

const ALERT_KINDS: AlertKind[] = ['tamper', 'temperature', 'low-stock', 'dispense-fault', 'offline', 'token-reuse'];
const SITE_TYPES: Kiosk['siteType'][] = ['school', 'university', 'clinic', 'community', 'other'];
const MAX_EVENTS_PER_SYNC = 2000;

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function redeem(store: Store, code: string, item: string, day: string): RedeemResult {
  const c = normaliseToken(code);
  if (!isWellFormed(c)) return 'invalid';
  for (const b of store.data.batches) {
    const t = b.codes.find((x) => x.code === c);
    if (!t) continue;
    if (t.usedOn) return 'used';
    if (b.expiresOn < day) return 'expired';
    if (b.items.length && !b.items.includes(item)) return 'not-allowed';
    t.usedOn = day;
    store.save();
    return 'ok';
  }
  return 'invalid';
}

export function createApp(store: Store, keys: Keys) {
  const bearer = (r: Req) => r.headers['authorization']?.replace(/^Bearer\s+/i, '') ?? '';
  const isPartner = (r: Req) => bearer(r) === keys.partner;
  const isKiosk = (r: Req) => bearer(r) === keys.kiosk;

  return function handle(r: Req): Res {
    const d = store.data;
    const parts = r.path.replace(/^\/api\/?/, '').split('/').filter(Boolean);
    const route = `${r.method} /${parts.map((p, i) => (i > 0 && parts[i - 1] === 'kiosks' && parts.length > 2 ? ':id' : p)).join('/')}`;
    const body = (r.body ?? {}) as Record<string, unknown>;

    // ---------- Public ----------
    if (r.method === 'GET' && parts[0] === 'health') return ok({ ok: true, kiosks: d.kiosks.length });

    if (r.method === 'POST' && parts[0] === 'pilot-requests') {
      const req = {
        id: randomId('pr_'),
        name: str(body.name, 80),
        organisation: str(body.organisation, 120),
        email: str(body.email, 120),
        role: str(body.role, 60),
        region: str(body.region, 40),
        message: str(body.message, 1000),
        createdAt: new Date().toISOString(),
      };
      if (!req.name || !req.organisation || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(req.email))
        return err(400, 'Enter your name, organisation and a valid email.');
      if (req.region && !(REGIONS as readonly string[]).includes(req.region)) req.region = '';
      d.pilotRequests.push(req);
      store.save();
      return ok({ ok: true, id: req.id });
    }

    // ---------- Kiosk ----------
    if (route === 'POST /kiosks/:id/sync' || route === 'POST /kiosks/:id/redeem' || route === 'GET /kiosks/:id/config') {
      if (!isKiosk(r)) return err(401, 'Kiosk key required.');
      const kioskId = parts[1];
      const kiosk = d.kiosks.find((k) => k.id === kioskId);
      if (!kiosk) return err(404, `Unknown kiosk ${kioskId}. Add it in the dashboard first.`);

      if (parts[2] === 'config') return ok({ kiosk, catalog: CATALOG });

      if (parts[2] === 'redeem') {
        const result = redeem(store, str(body.code, 20), str(body.item, 40), dayFor(new Date()));
        return ok({ result });
      }

      // sync
      const events = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS_PER_SYNC) : [];
      const known = new Set(d.events.map((e) => e.id));
      let accepted = 0;
      for (const raw of events) {
        const e = sanitizeEvent(raw, kioskId, CATALOG.map((c) => c.id));
        if (e && !known.has(e.id)) {
          d.events.push(e);
          known.add(e.id);
          accepted++;
        }
      }

      // Offline redemptions: the kiosk accepted a well-formed code without the server.
      for (const raw of Array.isArray(body.redemptions) ? body.redemptions.slice(0, 500) : []) {
        const red = raw as { code?: unknown; day?: unknown };
        const day = typeof red.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(red.day) ? red.day : dayFor(new Date());
        const result = redeem(store, str(red.code, 20), '', day);
        if (result === 'used')
          d.alerts.push({ id: randomId('al_'), kioskId, kind: 'token-reuse', message: 'A sponsored token was used twice while the kiosk was offline.', createdAt: new Date().toISOString() });
      }

      for (const raw of Array.isArray(body.alerts) ? body.alerts.slice(0, 100) : []) {
        const a = raw as Partial<Alert>;
        if (!ALERT_KINDS.includes(a.kind as AlertKind)) continue;
        const id = typeof a.id === 'string' ? a.id.slice(0, 40) : randomId('al_');
        if (d.alerts.some((x) => x.id === id)) continue;
        d.alerts.push({ id, kioskId, kind: a.kind as AlertKind, message: str(a.message, 200), createdAt: new Date().toISOString() });
      }

      const s = (body.status ?? {}) as Record<string, unknown>;
      const stock: Record<string, number> = {};
      for (const c of CATALOG) {
        const v = (s.stock as Record<string, unknown> | undefined)?.[c.id];
        stock[c.id] = typeof v === 'number' && v >= 0 ? Math.floor(v) : 0;
      }
      const status = {
        kioskId,
        stock,
        temperatureC: typeof s.temperatureC === 'number' ? Math.round(s.temperatureC * 10) / 10 : null,
        doorOpen: s.doorOpen === true,
        lastSeen: new Date().toISOString(),
      };
      d.statuses = [...d.statuses.filter((x) => x.kioskId !== kioskId), status];
      // A kiosk that checks in clears its own "offline" alert.
      for (const a of d.alerts) if (a.kioskId === kioskId && a.kind === 'offline' && !a.resolvedAt) a.resolvedAt = new Date().toISOString();
      store.save();
      return ok({ accepted });
    }

    // ---------- Partner (dashboard) ----------
    if (!isPartner(r)) return err(401, 'Partner key required.');

    if (r.method === 'GET' && parts[0] === 'summary') {
      const days = Math.min(365, Math.max(1, Number(r.query.get('days')) || 30));
      const region = r.query.get('region') || undefined;
      raiseOfflineAlerts(store);
      return ok(summarize(d, { days, region }));
    }

    if (r.method === 'GET' && parts[0] === 'kiosks') return ok(d.kiosks);

    if (r.method === 'POST' && parts[0] === 'kiosks' && parts.length === 1) {
      const id = str(body.id, 12).toUpperCase();
      const region = str(body.region, 40);
      if (!/^[A-Z0-9-]{2,12}$/.test(id)) return err(400, 'Kiosk ID must be 2–12 letters, numbers or dashes.');
      if (d.kiosks.some((k) => k.id === id)) return err(409, `Kiosk ${id} already exists.`);
      if (!(REGIONS as readonly string[]).includes(region)) return err(400, 'Choose one of Ghana’s 16 regions.');
      const siteType = SITE_TYPES.includes(body.siteType as Kiosk['siteType']) ? (body.siteType as Kiosk['siteType']) : 'other';
      const capacity: Record<string, number> = {};
      for (const c of CATALOG) capacity[c.id] = 30;
      const kiosk: Kiosk = { id, name: str(body.name, 80) || `Kiosk ${id}`, region, district: str(body.district, 60) || undefined, siteType, capacity };
      d.kiosks.push(kiosk);
      store.save();
      return ok(kiosk);
    }

    if (r.method === 'POST' && parts[0] === 'alerts' && parts[2] === 'resolve') {
      const a = d.alerts.find((x) => x.id === parts[1]);
      if (!a) return err(404, 'Alert not found.');
      a.resolvedAt = new Date().toISOString();
      store.save();
      return ok(a);
    }

    if (r.method === 'GET' && parts[0] === 'batches') return ok(d.batches);

    if (r.method === 'POST' && parts[0] === 'batches') {
      const count = Math.floor(Number(body.count));
      const sponsor = str(body.sponsor, 80);
      const expiresOn = str(body.expiresOn, 10);
      if (!sponsor) return err(400, 'Enter the sponsor’s name.');
      if (!(count >= 1 && count <= 5000)) return err(400, 'Create between 1 and 5,000 codes at a time.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn) || expiresOn <= dayFor(new Date())) return err(400, 'Choose an expiry date in the future.');
      const items = Array.isArray(body.items) ? body.items.filter((x): x is string => CATALOG.some((c) => c.id === x)) : [];
      const codes = new Set<string>();
      const existing = new Set(d.batches.flatMap((b) => b.codes.map((c) => c.code)));
      while (codes.size < count) {
        const c = makeToken();
        if (!existing.has(c)) codes.add(c);
      }
      const batch: TokenBatch = {
        id: randomId('b_'),
        sponsor,
        kind: body.kind === 'voucher' ? 'voucher' : 'token',
        createdOn: dayFor(new Date()),
        expiresOn,
        items,
        codes: [...codes].map((code) => ({ code })),
      };
      d.batches.push(batch);
      store.save();
      return ok(batch);
    }

    if (r.method === 'GET' && parts[0] === 'pilot-requests') return ok([...d.pilotRequests].reverse());

    return err(404, 'Not found.');
  };
}

function raiseOfflineAlerts(store: Store) {
  const now = Date.now();
  for (const s of store.data.statuses) {
    const hours = (now - new Date(s.lastSeen).getTime()) / 3_600_000;
    const open = store.data.alerts.some((a) => a.kioskId === s.kioskId && a.kind === 'offline' && !a.resolvedAt);
    if (hours >= 2 && !open) {
      store.data.alerts.push({
        id: randomId('al_'),
        kioskId: s.kioskId,
        kind: 'offline',
        message: `No contact for ${Math.floor(hours)} hours.`,
        createdAt: new Date().toISOString(),
      });
      store.save();
    }
  }
}
