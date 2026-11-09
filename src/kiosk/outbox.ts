import type { Alert, SyncPayload, VendEvent } from '../shared/types.ts';
import { config } from './config.ts';

/**
 * Records wait here until the server confirms them, so nothing is lost in a
 * power cut or when 4G and Wi-Fi are both down. Stored on the kiosk only.
 */
interface Outbox {
  events: VendEvent[];
  alerts: Omit<Alert, 'kioskId'>[];
  redemptions: { code: string; day: string }[];
}

const KEY = 'ayhk-outbox-v1';

function read(): Outbox {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Outbox;
  } catch {
    /* storage unavailable */
  }
  return { events: [], alerts: [], redemptions: [] };
}

function write(o: Outbox) {
  try {
    localStorage.setItem(KEY, JSON.stringify(o));
  } catch {
    /* storage unavailable */
  }
}

export const outbox = {
  add(patch: Partial<Outbox>) {
    if (config.demo) return;
    const o = read();
    write({
      events: [...o.events, ...(patch.events ?? [])],
      alerts: [...o.alerts, ...(patch.alerts ?? [])],
      redemptions: [...o.redemptions, ...(patch.redemptions ?? [])],
    });
  },
  size() {
    const o = read();
    return o.events.length + o.alerts.length + o.redemptions.length;
  },
  async sync(status: SyncPayload['status']): Promise<'ok' | 'offline' | 'error'> {
    if (config.demo) return 'ok';
    const o = read();
    const payload: SyncPayload = { events: o.events, alerts: o.alerts, redemptions: o.redemptions, status };
    try {
      const r = await fetch(`${config.apiUrl}/api/kiosks/${encodeURIComponent(config.kioskId)}/sync`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.kioskKey}` },
        body: JSON.stringify(payload),
      });
      if (!r.ok) return 'error';
      // Remove exactly what was sent; anything added meanwhile stays queued.
      const now = read();
      const sentE = new Set(o.events.map((e) => e.id));
      const sentA = new Set(o.alerts.map((a) => a.id));
      write({
        events: now.events.filter((e) => !sentE.has(e.id)),
        alerts: now.alerts.filter((a) => !sentA.has(a.id)),
        redemptions: now.redemptions.slice(o.redemptions.length),
      });
      return 'ok';
    } catch {
      return 'offline';
    }
  },
};

export async function redeemOnline(code: string, item: string): Promise<string | null> {
  if (config.demo) return null;
  try {
    const r = await fetch(`${config.apiUrl}/api/kiosks/${encodeURIComponent(config.kioskId)}/redeem`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.kioskKey}` },
      body: JSON.stringify({ code, item }),
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return null;
    return ((await r.json()) as { result: string }).result;
  } catch {
    return null; // offline: the caller falls back to the offline check
  }
}
