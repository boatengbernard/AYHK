import { PAY_LABEL, SLOT_LABEL, itemName } from '../shared/catalog.ts';
import { REGIONS } from '../shared/regions.ts';
import type { PayType, TimeSlot } from '../shared/types.ts';
import './site.css';

/** Set these before launch. An empty value hides the line. */
const CONTACT_EMAIL = import.meta.env.VITE_CONTACT_EMAIL ?? '';
const RESPONSE_PROMISE = import.meta.env.VITE_RESPONSE_PROMISE ?? '';
const API = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- Contact line ----------
if (CONTACT_EMAIL) {
  const el = $('contact');
  el.hidden = false;
  el.textContent = `Or email us: ${CONTACT_EMAIL}${RESPONSE_PROMISE ? ` · ${RESPONSE_PROMISE}` : ''}`;
}

// ---------- Kiosk demo receipt ----------
window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || e.data?.type !== 'ayhk-vend') return;
  const ev = e.data.event as { item: string; pay: PayType; kiosk: string; slot: TimeSlot };
  $('r-item').textContent = itemName(ev.item);
  $('r-pay').textContent = PAY_LABEL[ev.pay];
  $('r-kiosk').textContent = `Kiosk ${ev.kiosk}`;
  $('r-slot').textContent = SLOT_LABEL[ev.slot];
});

// ---------- Partner tabs ----------
const TABS = [
  { name: 'Schools', title: 'Care that fits the school day', body: 'Give students confidential access on campus, and fund tokens so cost never decides who gets protected.', cta: 'Plan a campus pilot', list: ['Sponsor tokens', 'See anonymous demand', 'No student data held'] },
  { name: 'Clinics & NGOs', title: 'Reach people before they reach the clinic', body: 'Extend your outreach with a kiosk that is open when the clinic is closed, in towns and districts far from the nearest pharmacy.', cta: 'Talk to us about outreach', list: ['Voucher codes', 'Stock visibility', 'Programme reporting'] },
  { name: 'Health services', title: 'Demand you can finally see', body: 'A live dashboard shows which items move, where and when, region by region, with no personal data to protect or lose.', cta: 'See the dashboard', list: ['Trends by region and item', 'Restock alerts', 'Tamper alerts'] },
  { name: 'Researchers', title: 'Evidence from the ground up', body: 'Anonymous, aggregated usage data opens a clear view of youth health needs across Ghana, designed with universities and research partners in mind.', cta: 'Propose a study', list: ['Aggregated data', 'Small counts suppressed', 'Open to collaboration'] },
];
let tab = 0;
function paintTabs() {
  const wrap = $('tabs');
  wrap.replaceChildren(
    ...TABS.map((t, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(i === tab));
      b.className = i === tab ? 'on' : '';
      b.textContent = t.name;
      b.onclick = () => {
        tab = i;
        paintTabs();
      };
      return b;
    }),
  );
  const t = TABS[tab];
  $('tab-title').textContent = t.title;
  $('tab-body').textContent = t.body;
  $('tab-cta').textContent = t.cta;
  $('tab-list').replaceChildren(
    ...t.list.map((x) => {
      const d = document.createElement('div');
      d.textContent = x;
      return d;
    }),
  );
}
paintTabs();

// ---------- Pilot request form ----------
const region = $<HTMLSelectElement>('f-region');
for (const r of REGIONS) region.append(new Option(r, r));

const form = $<HTMLFormElement>('pilot-form');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
  const error = $('form-error');
  if (!data.name.trim() || !data.organisation.trim()) return void (error.textContent = 'Enter your name and organisation.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())) return void (error.textContent = 'Enter a valid email so we can reply.');
  error.textContent = '';
  const btn = $<HTMLButtonElement>('f-submit');
  btn.disabled = true;
  btn.textContent = 'Sending…';
  try {
    const r = await fetch(`${API}/api/pilot-requests`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    if (!r.ok) throw new Error(j.error ?? 'The request didn’t go through.');
    form.hidden = true;
    $('sent').hidden = false;
    $('sent-title').textContent = `Thank you, ${data.name.trim().split(' ')[0]}.`;
    $('sent-body').textContent = `Your request for ${data.organisation.trim()} is in. We'll write to ${data.email.trim()} with next steps.`;
  } catch (err) {
    error.textContent = `${(err as Error).message === 'Failed to fetch' ? 'We couldn’t reach the server.' : (err as Error).message} Please try again in a moment.`;
    btn.disabled = false;
    btn.textContent = 'Request my pilot walkthrough';
  }
});
