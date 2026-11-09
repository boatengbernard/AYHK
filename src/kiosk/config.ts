import { CATALOG } from '../shared/catalog.ts';

const params = new URLSearchParams(location.search);
const env = import.meta.env;

/** Kiosk settings. Set with VITE_* variables at build time; demo URLs can override some. */
export const config = {
  kioskId: params.get('kiosk') ?? env.VITE_KIOSK_ID ?? 'K01',
  /** Base URL of the AYHK server. Empty = same site as the kiosk app. */
  apiUrl: (env.VITE_API_URL ?? '').replace(/\/$/, ''),
  kioskKey: env.VITE_KIOSK_KEY ?? 'dev-kiosk-key',
  hardware: (env.VITE_HARDWARE ?? 'sim') as 'sim' | 'bridge',
  bridgeUrl: env.VITE_BRIDGE_URL ?? 'http://localhost:8787',
  /** MoMoPay merchant ID shown on the payment screen. Empty = tap-to-pay only. */
  merchantId: env.VITE_MOMO_MERCHANT_ID ?? '',
  /** Website demo: nothing is synced or saved, and each vend is reported to the page around it. */
  demo: params.get('demo') === '1',
  showTech: params.get('tech') === '1',
  idleResetSeconds: 45,
  syncEverySeconds: 30,
  capacity: Object.fromEntries(CATALOG.map((c) => [c.id, 30])) as Record<string, number>,
  safeTemperature: { min: 15, max: 25 },
};
