import { CATALOG } from './catalog.ts';
import type { PayType, TimeSlot, VendEvent } from './types.ts';

const PAYS: PayType[] = ['momo', 'token', 'voucher'];
const SLOTS: TimeSlot[] = ['morning', 'afternoon', 'evening', 'night'];

/**
 * Rebuilds a vend from only the allowed fields. Anything else a client sends
 * (a phone number, a timestamp, a device id) is dropped, never stored.
 * Returns null when the event is malformed.
 */
export function sanitizeEvent(raw: unknown, kioskId: string, itemIds = CATALOG.map((c) => c.id)): VendEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !/^[a-z0-9_-]{6,40}$/i.test(r.id)) return null;
  if (typeof r.item !== 'string' || !itemIds.includes(r.item)) return null;
  if (!PAYS.includes(r.pay as PayType)) return null;
  if (!SLOTS.includes(r.slot as TimeSlot)) return null;
  if (typeof r.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.day)) return null;
  return { id: r.id, kioskId, item: r.item, pay: r.pay as PayType, day: r.day, slot: r.slot as TimeSlot };
}

/** Small-number suppression: counts below this are shown as "<5" in shared reports. */
export const SUPPRESS_BELOW = 5;

export function suppress(n: number): string {
  return n > 0 && n < SUPPRESS_BELOW ? `<${SUPPRESS_BELOW}` : String(n);
}
