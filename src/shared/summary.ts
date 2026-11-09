import { CATALOG } from './catalog.ts';
import { lastNDays } from './time.ts';
import type { Alert, Kiosk, KioskStatus, PayType, TimeSlot, TokenBatch, VendEvent } from './types.ts';

export interface SummaryFilter {
  days: number; // look-back window
  region?: string; // empty = nationwide
  today?: string; // for tests
}

export interface KioskRow {
  kiosk: Kiosk;
  status?: KioskStatus;
  vends: number;
  lowStock: string[]; // item ids at or below 20% of capacity
  online: boolean;
}

export interface Summary {
  days: string[];
  total: number;
  sponsoredShare: number; // 0..1, token + voucher
  byDay: number[];
  byItem: { item: string; count: number }[];
  bySlot: Record<TimeSlot, number>;
  byPay: Record<PayType, number>;
  byRegion: { region: string; count: number; kiosks: number }[];
  kiosks: KioskRow[];
  openAlerts: Alert[];
  tokens: { issued: number; redeemed: number };
}

const OFFLINE_AFTER_MS = 2 * 60 * 60 * 1000;

export function summarize(
  input: { events: VendEvent[]; kiosks: Kiosk[]; statuses: KioskStatus[]; alerts: Alert[]; batches: TokenBatch[] },
  filter: SummaryFilter,
  now = Date.now(),
): Summary {
  const days = lastNDays(filter.days, filter.today);
  const daySet = new Set(days);
  const kiosks = input.kiosks.filter((k) => !filter.region || k.region === filter.region);
  const kioskIds = new Set(kiosks.map((k) => k.id));
  const events = input.events.filter((e) => daySet.has(e.day) && kioskIds.has(e.kioskId));

  const byDay = days.map((d) => events.filter((e) => e.day === d).length);
  const byItem = CATALOG.map((c) => ({ item: c.id, count: events.filter((e) => e.item === c.id).length }));
  const bySlot: Record<TimeSlot, number> = { morning: 0, afternoon: 0, evening: 0, night: 0 };
  const byPay: Record<PayType, number> = { momo: 0, token: 0, voucher: 0 };
  const perKiosk = new Map<string, number>();
  for (const e of events) {
    bySlot[e.slot]++;
    byPay[e.pay]++;
    perKiosk.set(e.kioskId, (perKiosk.get(e.kioskId) ?? 0) + 1);
  }

  const regionMap = new Map<string, { count: number; kiosks: number }>();
  for (const k of kiosks) {
    const r = regionMap.get(k.region) ?? { count: 0, kiosks: 0 };
    r.kiosks++;
    r.count += perKiosk.get(k.id) ?? 0;
    regionMap.set(k.region, r);
  }

  const rows: KioskRow[] = kiosks.map((kiosk) => {
    const status = input.statuses.find((s) => s.kioskId === kiosk.id);
    const lowStock = Object.entries(kiosk.capacity)
      .filter(([item, cap]) => (status?.stock[item] ?? 0) <= Math.max(1, Math.floor(cap * 0.2)))
      .map(([item]) => item);
    return {
      kiosk,
      status,
      vends: perKiosk.get(kiosk.id) ?? 0,
      lowStock: status ? lowStock : [],
      online: Boolean(status && now - new Date(status.lastSeen).getTime() < OFFLINE_AFTER_MS),
    };
  });

  const batches = input.batches;
  const issued = batches.reduce((n, b) => n + b.codes.length, 0);
  const redeemed = batches.reduce((n, b) => n + b.codes.filter((c) => c.usedOn).length, 0);

  return {
    days,
    total: events.length,
    sponsoredShare: events.length ? (byPay.token + byPay.voucher) / events.length : 0,
    byDay,
    byItem,
    bySlot,
    byPay,
    byRegion: [...regionMap.entries()].map(([region, v]) => ({ region, ...v })).sort((a, b) => b.count - a.count),
    kiosks: rows.sort((a, b) => Number(a.online) - Number(b.online) || b.lowStock.length - a.lowStock.length || b.vends - a.vends),
    openAlerts: input.alerts
      .filter((a) => !a.resolvedAt && kioskIds.has(a.kioskId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    tokens: { issued, redeemed },
  };
}
