import type { CatalogItem, PayType, TimeSlot } from './types.ts';

/**
 * Pilot catalogue. Prices are EXAMPLES: confirm the final product list and
 * prices with your health partners before deployment.
 */
export const CATALOG: CatalogItem[] = [
  { id: 'condoms', name: 'Condoms', note: 'Pack of 3', pricePesewas: 500 },
  { id: 'pregnancy-test', name: 'Pregnancy test', note: 'Single test', pricePesewas: 1000 },
  { id: 'pads', name: 'Sanitary pads', note: 'Pack of 8', pricePesewas: 1500 },
];

export const itemName = (id: string) => CATALOG.find((c) => c.id === id)?.name ?? id;

export const PAY_LABEL: Record<PayType, string> = {
  momo: 'Mobile money',
  token: 'Sponsored token',
  voucher: 'Clinic voucher',
};

export const SLOT_LABEL: Record<TimeSlot, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  night: 'Night',
};

export const SLOT_HOURS: Record<TimeSlot, string> = {
  morning: '05:00–11:59',
  afternoon: '12:00–16:59',
  evening: '17:00–20:59',
  night: '21:00–04:59',
};

export function cedis(pesewas: number): string {
  return `GH₵${(pesewas / 100).toFixed(2)}`;
}

/** Health tips shown after a vend. Review with your health partners. */
export const TIPS: Record<string, string[]> = {
  condoms: [
    'Check the expiry date and use a new condom every time.',
    'Condoms protect against both pregnancy and most STIs when used every time.',
  ],
  'pregnancy-test': [
    'For the clearest result, test with your first urine of the morning.',
    'If the result is unclear, test again in a few days or visit a clinic.',
  ],
  pads: [
    'Change pads every 4 to 6 hours to stay comfortable and healthy.',
    'Severe period pain is not something you have to live with. A clinic can help.',
  ],
};

export const GENERAL_TIP = 'Free and confidential advice is available at youth-friendly health clinics.';
