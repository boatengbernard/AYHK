import { CATALOG } from '../shared/catalog.ts';
import { sampleData } from '../shared/sample.ts';
import { summarize, type Summary } from '../shared/summary.ts';
import { dayFor, randomId } from '../shared/time.ts';
import { makeToken } from '../shared/tokens.ts';
import type { Kiosk, PilotRequest, TokenBatch } from '../shared/types.ts';

export interface Api {
  mode: 'live' | 'sample';
  summary(days: number, region: string): Promise<Summary>;
  kiosks(): Promise<Kiosk[]>;
  addKiosk(k: { id: string; name: string; region: string; district: string; siteType: string }): Promise<Kiosk>;
  resolveAlert(id: string): Promise<void>;
  batches(): Promise<TokenBatch[]>;
  createBatch(b: { sponsor: string; kind: 'token' | 'voucher'; count: number; expiresOn: string; items: string[] }): Promise<TokenBatch>;
  pilotRequests(): Promise<PilotRequest[]>;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function liveApi(baseUrl: string, key: string): Api {
  const base = baseUrl.replace(/\/$/, '');
  const call = async <T,>(method: string, path: string, body?: unknown): Promise<T> => {
    let r: Response;
    try {
      r = await fetch(`${base}/api${path}`, {
        method,
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, 'Can’t reach the AYHK server. Check the address and your connection.');
    }
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    if (!r.ok) throw new ApiError(r.status, j.error ?? `Server error ${r.status}`);
    return j as T;
  };
  return {
    mode: 'live',
    summary: (days, region) => call('GET', `/summary?days=${days}&region=${encodeURIComponent(region)}`),
    kiosks: () => call('GET', '/kiosks'),
    addKiosk: (k) => call('POST', '/kiosks', k),
    resolveAlert: (id) => call('POST', `/alerts/${encodeURIComponent(id)}/resolve`),
    batches: () => call('GET', '/batches'),
    createBatch: (b) => call('POST', '/batches', b),
    pilotRequests: () => call('GET', '/pilot-requests'),
  };
}

/** Runs entirely in the browser on clearly labelled sample data. Changes last until the page reloads. */
export function sampleApi(): Api {
  const d = { ...sampleData(), pilotRequests: [] as PilotRequest[] };
  return {
    mode: 'sample',
    summary: async (days, region) => summarize(d, { days, region: region || undefined }),
    kiosks: async () => d.kiosks,
    addKiosk: async (k) => {
      const id = k.id.trim().toUpperCase();
      if (!/^[A-Z0-9-]{2,12}$/.test(id)) throw new ApiError(400, 'Kiosk ID must be 2–12 letters, numbers or dashes.');
      if (d.kiosks.some((x) => x.id === id)) throw new ApiError(409, `Kiosk ${id} already exists.`);
      const kiosk: Kiosk = {
        id,
        name: k.name || `Kiosk ${id}`,
        region: k.region,
        district: k.district || undefined,
        siteType: k.siteType as Kiosk['siteType'],
        capacity: Object.fromEntries(CATALOG.map((c) => [c.id, 30])),
      };
      d.kiosks.push(kiosk);
      return kiosk;
    },
    resolveAlert: async (id) => {
      const a = d.alerts.find((x) => x.id === id);
      if (a) a.resolvedAt = new Date().toISOString();
    },
    batches: async () => d.batches,
    createBatch: async (b) => {
      if (!b.sponsor.trim()) throw new ApiError(400, 'Enter the sponsor’s name.');
      if (!(b.count >= 1 && b.count <= 5000)) throw new ApiError(400, 'Create between 1 and 5,000 codes at a time.');
      if (!b.expiresOn || b.expiresOn <= dayFor(new Date())) throw new ApiError(400, 'Choose an expiry date in the future.');
      const batch: TokenBatch = {
        id: randomId('b_'),
        sponsor: b.sponsor.trim(),
        kind: b.kind,
        createdOn: dayFor(new Date()),
        expiresOn: b.expiresOn,
        items: b.items,
        codes: Array.from({ length: b.count }, () => ({ code: makeToken() })),
      };
      d.batches.push(batch);
      return batch;
    },
    pilotRequests: async () => d.pilotRequests,
  };
}
