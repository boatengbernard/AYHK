/**
 * Sponsored token codes, e.g. AYHK-7KQM-2H9F.
 *
 * 8 characters from an alphabet without look-alikes (no 0/O, 1/I/L), the last
 * one a check character so a mistyped or misread code is caught at the kiosk,
 * even when it is offline. A code says nothing about who receives it.
 */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // 31 characters

function checkChar(body: string): string {
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum += (ALPHABET.indexOf(body[i]) + 1) * (i + 1);
  return ALPHABET[sum % ALPHABET.length];
}

export function makeToken(): string {
  const bytes = new Uint8Array(7);
  globalThis.crypto.getRandomValues(bytes);
  const body = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  const full = body + checkChar(body);
  return `AYHK-${full.slice(0, 4)}-${full.slice(4)}`;
}

/** Uppercases, strips spaces and dashes, and restores the canonical AYHK-XXXX-XXXX form. */
export function normaliseToken(input: string): string {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^AYHK/, '');
  if (raw.length !== 8) return input.trim().toUpperCase();
  return `AYHK-${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export function isWellFormed(code: string): boolean {
  const m = /^AYHK-([2-9A-HJKMNP-Z]{4})-([2-9A-HJKMNP-Z]{4})$/.exec(code);
  if (!m) return false;
  const full = m[1] + m[2];
  return checkChar(full.slice(0, 7)) === full[7];
}
