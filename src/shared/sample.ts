import { CATALOG } from './catalog.ts';
import { addDays, dayFor } from './time.ts';
import { makeToken } from './tokens.ts';
import type { Alert, Kiosk, KioskStatus, PayType, TimeSlot, TokenBatch, VendEvent } from './types.ts';

/**
 * SAMPLE DATA for demos and development. Every kiosk name says "Sample" so it
 * can never be mistaken for real figures.
 */

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const cap = { condoms: 40, 'pregnancy-test': 20, pads: 30 };

export const SAMPLE_KIOSKS: Kiosk[] = [
  { id: 'K01', name: 'Sample kiosk · University campus', region: 'Ashanti', siteType: 'university', capacity: cap },
  { id: 'K02', name: 'Sample kiosk · Senior high school', region: 'Greater Accra', siteType: 'school', capacity: cap },
  { id: 'K03', name: 'Sample kiosk · Youth centre', region: 'Northern', siteType: 'community', capacity: cap },
  { id: 'K04', name: 'Sample kiosk · District clinic', region: 'Volta', siteType: 'clinic', capacity: cap },
  { id: 'K05', name: 'Sample kiosk · Technical university', region: 'Western', siteType: 'university', capacity: cap },
  { id: 'K06', name: 'Sample kiosk · Community centre', region: 'Upper East', siteType: 'community', capacity: cap },
];

export function sampleData(today = dayFor(new Date()), now = Date.now()) {
  const rand = rng(42);
  const slots: TimeSlot[] = ['morning', 'afternoon', 'evening', 'night'];
  const slotWeight = [0.18, 0.32, 0.38, 0.12];
  const itemWeight = [0.55, 0.15, 0.3];
  const payWeight = [0.58, 0.32, 0.1];
  const pays: PayType[] = ['momo', 'token', 'voucher'];
  const pick = <T,>(xs: T[], ws: number[]) => {
    let r = rand();
    for (let i = 0; i < xs.length; i++) if ((r -= ws[i]) <= 0) return xs[i];
    return xs[xs.length - 1];
  };

  const events: VendEvent[] = [];
  SAMPLE_KIOSKS.forEach((k, ki) => {
    const busy = [9, 7, 4, 3, 5, 2][ki];
    for (let d = -59; d <= 0; d++) {
      const day = addDays(today, d);
      const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
      const n = Math.round(busy * (weekday === 0 || weekday === 6 ? 0.6 : 1) * (0.6 + rand() * 0.8));
      for (let i = 0; i < n; i++)
        events.push({
          id: `s${ki}${d}${i}`.replace('-', 'm'),
          kioskId: k.id,
          item: pick(CATALOG.map((c) => c.id), itemWeight),
          pay: pick(pays, payWeight),
          day,
          slot: pick(slots, slotWeight),
        });
    }
  });

  const iso = (minsAgo: number) => new Date(now - minsAgo * 60_000).toISOString();
  const statuses: KioskStatus[] = [
    { kioskId: 'K01', stock: { condoms: 31, 'pregnancy-test': 3, pads: 22 }, temperatureC: 23.4, doorOpen: false, lastSeen: iso(2) },
    { kioskId: 'K02', stock: { condoms: 12, 'pregnancy-test': 15, pads: 5 }, temperatureC: 24.1, doorOpen: false, lastSeen: iso(5) },
    { kioskId: 'K03', stock: { condoms: 36, 'pregnancy-test': 18, pads: 27 }, temperatureC: 26.8, doorOpen: false, lastSeen: iso(9) },
    { kioskId: 'K04', stock: { condoms: 28, 'pregnancy-test': 17, pads: 24 }, temperatureC: 22.0, doorOpen: false, lastSeen: iso(1) },
    { kioskId: 'K05', stock: { condoms: 20, 'pregnancy-test': 11, pads: 19 }, temperatureC: 23.0, doorOpen: false, lastSeen: iso(300) },
    { kioskId: 'K06', stock: { condoms: 39, 'pregnancy-test': 19, pads: 30 }, temperatureC: 21.7, doorOpen: false, lastSeen: iso(3) },
  ];

  const alerts: Alert[] = [
    { id: 'a1', kioskId: 'K03', kind: 'temperature', message: 'Temperature 26.8 °C is above the safe range (15–25 °C).', createdAt: iso(40) },
    { id: 'a2', kioskId: 'K01', kind: 'low-stock', message: 'Pregnancy tests are low (3 left).', createdAt: iso(180) },
    { id: 'a3', kioskId: 'K05', kind: 'offline', message: 'No contact for 5 hours.', createdAt: iso(180) },
    { id: 'a4', kioskId: 'K02', kind: 'tamper', message: 'Service door opened outside a restock visit.', createdAt: iso(2900), resolvedAt: iso(2800) },
  ];

  const mkBatch = (id: string, sponsor: string, kind: 'token' | 'voucher', count: number, used: number, created: number): TokenBatch => ({
    id,
    sponsor,
    kind,
    createdOn: addDays(today, -created),
    expiresOn: addDays(today, 180 - created),
    items: [],
    codes: Array.from({ length: count }, (_, i) => ({ code: makeToken(), usedOn: i < used ? addDays(today, -Math.floor(rand() * created)) : undefined })),
  });
  const batches: TokenBatch[] = [
    mkBatch('b1', 'Sample sponsor · School health fund', 'token', 200, 141, 45),
    mkBatch('b2', 'Sample sponsor · Youth NGO', 'token', 100, 38, 20),
    mkBatch('b3', 'Sample sponsor · District clinic', 'voucher', 60, 22, 30),
  ];

  return { kiosks: SAMPLE_KIOSKS, events, statuses, alerts, batches };
}
