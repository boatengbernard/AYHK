/**
 * AYHK data model.
 *
 * The privacy rule is simple: nothing here can identify a person. A vend
 * records which item, how it was paid for, which kiosk, the day and a rough
 * time slot. No timestamps to the second, no phone numbers, no payment
 * references, no device or face data.
 */

export type ItemId = string;
export type PayType = 'momo' | 'token' | 'voucher';
export type TimeSlot = 'morning' | 'afternoon' | 'evening' | 'night';

export interface CatalogItem {
  id: ItemId;
  name: string;
  note: string;
  /** Price in Ghana pesewas (100 = GH₵1.00). Set per deployment. */
  pricePesewas: number;
}

/** One item leaving a kiosk. The only record of a person's visit. */
export interface VendEvent {
  id: string; // random, not derived from anything about the person
  kioskId: string;
  item: ItemId;
  pay: PayType;
  day: string; // YYYY-MM-DD
  slot: TimeSlot;
}

export type AlertKind = 'tamper' | 'temperature' | 'low-stock' | 'dispense-fault' | 'offline' | 'token-reuse';

export interface Alert {
  id: string;
  kioskId: string;
  kind: AlertKind;
  message: string;
  createdAt: string; // ISO; about the machine, never a person
  resolvedAt?: string;
}

export interface Kiosk {
  id: string;
  name: string;
  region: string;
  district?: string;
  siteType: 'school' | 'university' | 'clinic' | 'community' | 'other';
  /** Slots per item in the machine. */
  capacity: Record<ItemId, number>;
}

export interface KioskStatus {
  kioskId: string;
  stock: Record<ItemId, number>;
  temperatureC: number | null;
  doorOpen: boolean;
  lastSeen: string; // ISO, set by the server
}

export interface TokenCode {
  code: string;
  usedOn?: string; // YYYY-MM-DD, never which kiosk or time
}

export interface TokenBatch {
  id: string;
  sponsor: string;
  kind: 'token' | 'voucher';
  createdOn: string; // YYYY-MM-DD
  expiresOn: string; // YYYY-MM-DD
  items: ItemId[]; // empty = any item
  codes: TokenCode[];
}

export interface PilotRequest {
  id: string;
  name: string;
  organisation: string;
  email: string;
  role: string;
  region: string;
  message: string;
  createdAt: string;
}

/** What a kiosk sends when it syncs. */
export interface SyncPayload {
  events: VendEvent[];
  alerts: Omit<Alert, 'kioskId'>[];
  redemptions: { code: string; day: string }[];
  status: { stock: Record<ItemId, number>; temperatureC: number | null; doorOpen: boolean };
}

export type RedeemResult = 'ok' | 'invalid' | 'used' | 'expired' | 'not-allowed';
