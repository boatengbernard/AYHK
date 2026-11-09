import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../server/app.ts';
import { Store } from '../server/db.ts';
import { sanitizeEvent, suppress } from '../src/shared/privacy.ts';
import { summarize } from '../src/shared/summary.ts';
import { slotFor } from '../src/shared/time.ts';
import { isWellFormed, makeToken, normaliseToken } from '../src/shared/tokens.ts';

describe('privacy', () => {
  it('keeps only the allowed fields of a vend', () => {
    const e = sanitizeEvent(
      { id: 'abc123xyz', item: 'condoms', pay: 'momo', day: '2026-11-09', slot: 'evening', phone: '0244000000', timestamp: '2026-11-09T19:04:11Z', kioskId: 'SPOOF' },
      'K01',
    );
    expect(e).toEqual({ id: 'abc123xyz', kioskId: 'K01', item: 'condoms', pay: 'momo', day: '2026-11-09', slot: 'evening' });
    expect(JSON.stringify(e)).not.toContain('0244');
  });

  it('rejects malformed vends', () => {
    expect(sanitizeEvent({ id: 'abc123xyz', item: 'unknown', pay: 'momo', day: '2026-11-09', slot: 'evening' }, 'K01')).toBeNull();
    expect(sanitizeEvent({ id: 'abc123xyz', item: 'condoms', pay: 'card', day: '2026-11-09', slot: 'evening' }, 'K01')).toBeNull();
    expect(sanitizeEvent('nope', 'K01')).toBeNull();
  });

  it('suppresses small counts', () => {
    expect(suppress(0)).toBe('0');
    expect(suppress(3)).toBe('<5');
    expect(suppress(5)).toBe('5');
  });

  it('maps hours to rough time slots (Ghana time = GMT)', () => {
    expect(slotFor(new Date('2026-11-09T07:30:00Z'))).toBe('morning');
    expect(slotFor(new Date('2026-11-09T13:00:00Z'))).toBe('afternoon');
    expect(slotFor(new Date('2026-11-09T19:59:00Z'))).toBe('evening');
    expect(slotFor(new Date('2026-11-09T02:00:00Z'))).toBe('night');
  });
});

describe('tokens', () => {
  it('generates well-formed codes', () => {
    for (let i = 0; i < 200; i++) expect(isWellFormed(makeToken())).toBe(true);
  });
  it('catches a single mistyped character', () => {
    const code = makeToken();
    const swapped = code.slice(0, 5) + (code[5] === 'A' ? 'B' : 'A') + code.slice(6);
    expect(isWellFormed(swapped)).toBe(false);
  });
  it('normalises how people type codes', () => {
    const code = makeToken();
    expect(normaliseToken(code.toLowerCase().replace(/-/g, ' '))).toBe(code);
    expect(normaliseToken(code.slice(5).replace('-', ''))).toBe(code);
  });
});

function setup() {
  const store = new Store(join(mkdtempSync(join(tmpdir(), 'ayhk-')), 'db.json'));
  const app = createApp(store, { partner: 'p', kiosk: 'k' });
  const call = (method: string, path: string, body?: unknown, key?: string) =>
    app({ method, path, query: new URL(`http://x${path}`).searchParams, headers: key ? { authorization: `Bearer ${key}` } : {}, body });
  return { store, call };
}

describe('server', () => {
  it('requires the right keys', () => {
    const { call } = setup();
    expect(call('GET', '/api/summary').status).toBe(401);
    expect(call('GET', '/api/summary', undefined, 'k').status).toBe(401);
    expect(call('GET', '/api/summary', undefined, 'p').status).toBe(200);
    expect(call('POST', '/api/kiosks/K01/sync', {}, 'p').status).toBe(401);
  });

  it('accepts a kiosk sync, stores only safe fields and dedupes', () => {
    const { store, call } = setup();
    expect(call('POST', '/api/kiosks', { id: 'k01', name: 'Test', region: 'Volta', siteType: 'school' }, 'p').status).toBe(200);
    const sync = {
      events: [
        { id: 'evt000001', item: 'pads', pay: 'token', day: '2026-11-09', slot: 'afternoon', name: 'Ama' },
        { id: 'evt000001', item: 'pads', pay: 'token', day: '2026-11-09', slot: 'afternoon' },
      ],
      alerts: [{ id: 'al1', kind: 'tamper', message: 'Door opened' }],
      redemptions: [],
      status: { stock: { condoms: 10, 'pregnancy-test': 2, pads: 4 }, temperatureC: 23.37, doorOpen: true },
    };
    const res = call('POST', '/api/kiosks/K01/sync', sync, 'k');
    expect(res.body).toEqual({ accepted: 1 });
    expect(store.data.events).toHaveLength(1);
    expect(JSON.stringify(store.data)).not.toContain('Ama');
    expect(store.data.statuses[0].temperatureC).toBe(23.4);
    expect(store.data.alerts[0].kind).toBe('tamper');
  });

  it('issues tokens that redeem exactly once', () => {
    const { call } = setup();
    call('POST', '/api/kiosks', { id: 'K01', region: 'Ashanti' }, 'p');
    const batch = call('POST', '/api/batches', { sponsor: 'Fund', count: 3, expiresOn: '2099-01-01' }, 'p').body as { codes: { code: string }[] };
    expect(batch.codes).toHaveLength(3);
    const code = batch.codes[0].code;
    expect(call('POST', '/api/kiosks/K01/redeem', { code, item: 'condoms' }, 'k').body).toEqual({ result: 'ok' });
    expect(call('POST', '/api/kiosks/K01/redeem', { code, item: 'condoms' }, 'k').body).toEqual({ result: 'used' });
    expect(call('POST', '/api/kiosks/K01/redeem', { code: 'AYHK-2222-2222', item: 'condoms' }, 'k').body).toEqual({ result: 'invalid' });
  });

  it('flags a token reused while a kiosk was offline', () => {
    const { store, call } = setup();
    call('POST', '/api/kiosks', { id: 'K01', region: 'Ashanti' }, 'p');
    const code = (call('POST', '/api/batches', { sponsor: 'Fund', count: 1, expiresOn: '2099-01-01' }, 'p').body as { codes: { code: string }[] }).codes[0].code;
    const status = { stock: {}, temperatureC: 22, doorOpen: false };
    call('POST', '/api/kiosks/K01/sync', { events: [], alerts: [], redemptions: [{ code, day: '2026-11-09' }, { code, day: '2026-11-09' }], status }, 'k');
    expect(store.data.alerts.some((a) => a.kind === 'token-reuse')).toBe(true);
  });

  it('saves pilot requests from the website', () => {
    const { call } = setup();
    expect(call('POST', '/api/pilot-requests', { name: 'A', organisation: 'B', email: 'bad' }).status).toBe(400);
    expect(call('POST', '/api/pilot-requests', { name: 'A', organisation: 'B', email: 'a@b.org', region: 'Oti' }).status).toBe(200);
    expect((call('GET', '/api/pilot-requests', undefined, 'p').body as unknown[]).length).toBe(1);
  });
});

describe('summary', () => {
  it('counts vends by item, slot, payment and region within the window', () => {
    const kiosks = [
      { id: 'A', name: 'A', region: 'Volta', siteType: 'school' as const, capacity: { condoms: 10 } },
      { id: 'B', name: 'B', region: 'Oti', siteType: 'school' as const, capacity: { condoms: 10 } },
    ];
    const ev = (id: string, kioskId: string, day: string, pay: 'momo' | 'token') => ({ id, kioskId, item: 'condoms', pay, day, slot: 'evening' as const });
    const s = summarize(
      { kiosks, events: [ev('1', 'A', '2026-11-09', 'momo'), ev('2', 'A', '2026-11-08', 'token'), ev('3', 'B', '2026-11-09', 'momo'), ev('4', 'A', '2026-10-01', 'momo')], statuses: [], alerts: [], batches: [] },
      { days: 7, today: '2026-11-09' },
    );
    expect(s.total).toBe(3);
    expect(s.sponsoredShare).toBeCloseTo(1 / 3);
    expect(s.byRegion[0]).toEqual({ region: 'Volta', count: 2, kiosks: 1 });
    const volta = summarize({ kiosks, events: [ev('1', 'A', '2026-11-09', 'momo'), ev('3', 'B', '2026-11-09', 'momo')], statuses: [], alerts: [], batches: [] }, { days: 7, region: 'Oti', today: '2026-11-09' });
    expect(volta.total).toBe(1);
  });
});
