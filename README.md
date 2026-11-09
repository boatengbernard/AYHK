# AYHK · Anonymous Youth Health Kiosk

AYHK is a solar-powered kiosk that gives young people across Ghana private access to condoms, pregnancy tests and sanitary pads. **No name, phone number or face is ever recorded.**

This repository contains the whole system:

| Part | Path | What it does |
|---|---|---|
| **Website** | `/` (`index.html`, `src/site/`) | Public page with a live kiosk demo and a pilot request form that saves to the server |
| **Kiosk app** | `/kiosk/` (`src/kiosk/`) | The touchscreen software for the Raspberry Pi 7″ display (800×480) |
| **Partner dashboard** | `/dashboard/` (`src/dashboard/`) | Stock, alerts, anonymous demand by region, sponsored tokens and pilot requests |
| **Server** | `server/` | A small API and JSON data store. It serves all three apps |
| **Shared core** | `src/shared/` | Data model, privacy rules, token codes, Ghana's 16 regions, reporting maths |

## Privacy, in code

- A vend records only **item, payment type, kiosk, day and time slot** (morning, afternoon, evening or night). See `src/shared/types.ts`.
- The server rebuilds every incoming record from that allowed list (`sanitizeEvent` in `src/shared/privacy.ts`). Any extra field a client sends, such as a phone number or exact timestamp, is dropped before storage. Tests check this.
- Sponsored token codes (`AYHK-XXXX-XXXX`) carry no information about who receives them. A check character catches typos, even when the kiosk is offline.
- Exported totals show counts under 5 as `<5`.
- The kiosk has an **Exit** button on every screen. It resets itself after 45 seconds without a touch, and 20 seconds after a vend.

## The kiosk app

The flow is:

1. Touch to start.
2. Choose an item.
3. Choose how to pay: mobile money, a sponsored token or a clinic voucher.
4. The item dispenses and a health tip appears.
5. The screen resets.

Other behaviour:

- **Offline first.** Records wait in an outbox on the kiosk and sync every 30 seconds. Nothing is lost in a power cut or when 4G and Wi-Fi are both down.
- **Tokens:** checked with the server when online. When offline, a well-formed code is accepted, and a reuse is flagged to the dashboard at the next sync.
- **Alerts:** door opened outside a restock visit (tamper), temperature outside 15–25 °C, low stock (≤ 20%), and an item that didn't drop. The dashboard raises an "offline" alert after 2 hours without contact.
- **Technician panel:** tap the AYHK logo 5 times within 3 seconds, or open `/kiosk/?tech=1`. It shows stock and sync status, records a restock visit, and drives the simulator.
- **Hardware:** `src/kiosk/hardware.ts` defines what the software needs from the machine.
  - `SimHardware` runs in any browser.
  - `BridgeHardware` talks to a local service on the Pi. See [docs/HARDWARE.md](docs/HARDWARE.md).
- **Languages:** all text is in `src/kiosk/strings.ts`. English is included. Add Twi, Ewe, Ga, Dagbani, Hausa and others with native speakers.

## Run it

Needs Node.js 22.18 or newer, which runs the TypeScript server directly.

```bash
npm install
npm run build
npm run server:sample   # server with clearly labelled sample data on http://localhost:8080
```

Then open:

- Website: http://localhost:8080/
- Kiosk: http://localhost:8080/kiosk/ (add `?tech=1` for the technician panel)
- Dashboard: http://localhost:8080/dashboard/ (sign in with `dev-partner-key`, or choose "Explore with sample data")

For development with hot reload, run `npm run server` in one terminal and `npm run dev` in another. Vite forwards `/api` to the server.

```bash
npm test        # privacy, tokens, server and reporting tests
npm run lint
```

## Deploy

1. Copy `.env.example` to `.env` and set real values. **Always set `AYHK_PARTNER_KEY` and `AYHK_KIOSK_KEY`**: without them the server uses development keys and prints a warning.
2. `npm run build`, then `npm start` on any Node host, for example Render, Railway, Fly.io or a small VPS. Keep `server/data/` on a persistent disk and back it up.
3. In the dashboard, **Add a kiosk** for each machine. Its ID (for example `GA-014`) goes into that kiosk's `VITE_KIOSK_ID`.
4. On each Raspberry Pi, build the kiosk with that kiosk's settings (`VITE_KIOSK_ID`, `VITE_API_URL`, `VITE_KIOSK_KEY`, `VITE_HARDWARE=bridge`). Open `/kiosk/` in Chromium kiosk mode:

```bash
chromium-browser --kiosk --noerrdialogs --disable-pinch --overscroll-history-navigation=0 http://localhost:8080/kiosk/
```

## Before a public launch

- **Product list and prices:** `src/shared/catalog.ts` uses example prices. Confirm both with your health partners.
- **Health tips:** in `src/shared/catalog.ts`. Have them reviewed by a health professional.
- **Mobile money:** the kiosk shows a one-time reference and waits for confirmation from the hardware bridge. Real payments need a provider integration, such as MTN MoMo API, Hubtel or Paystack, that confirms the payment by reference. Set `VITE_MOMO_MERCHANT_ID` to show MoMoPay details.
- **Partner access:** there is one partner key today. Give each partner organisation its own login before sharing the dashboard widely.
- **Website contact:** set `VITE_CONTACT_EMAIL` and `VITE_RESPONSE_PROMISE`. The line stays hidden until you do.
- **Scale:** the JSON file store suits a pilot of a few dozen kiosks. Move to Postgres for a national rollout.
- **Approvals:** regulatory and ethics review with the relevant Ghanaian authorities, as the website FAQ says.
