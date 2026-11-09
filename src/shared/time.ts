import type { TimeSlot } from './types.ts';

/** Ghana uses GMT all year (no daylight saving), so UTC hours are local hours. */
export function slotFor(date: Date): TimeSlot {
  const h = date.getUTCHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 21) return 'evening';
  return 'night';
}

export function dayFor(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return dayFor(d);
}

export function lastNDays(n: number, today = dayFor(new Date())): string[] {
  return Array.from({ length: n }, (_, i) => addDays(today, i - (n - 1)));
}

export function randomId(prefix = ''): string {
  const bytes = new Uint8Array(9);
  globalThis.crypto.getRandomValues(bytes);
  return prefix + [...bytes].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14);
}
