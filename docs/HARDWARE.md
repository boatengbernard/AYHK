# Hardware bridge

The kiosk app never touches GPIO directly. On the Raspberry Pi, a small local service (the "bridge", in Python or Node) drives the hardware. With `VITE_HARDWARE=bridge`, the app talks to it over HTTP at `VITE_BRIDGE_URL` (default `http://localhost:8787`).

The bridge must provide three endpoints.

## `GET /sensors`

Polled every 5 seconds.

```json
{ "temperatureC": 23.4, "doorOpen": false }
```

- `temperatureC`: from the temperature sensor (for example a DS18B20). Use `null` if the sensor isn't reading.
- `doorOpen`: from the reed switch on the service door.

## `POST /dispense`

Body: `{ "item": "condoms" }`. Item IDs come from `src/shared/catalog.ts`.

1. Run the motor or solenoid for that item's slot.
2. Wait for the infrared slot sensor or the weight change to confirm the drop. Time out after about 10 seconds.
3. Respond with `{ "result": "dropped" }` or `{ "result": "jammed" }`.

## `POST /payment`

Body: `{ "amountPesewas": 500, "reference": "4821" }`.

Wait until the mobile-money payment for this reference is confirmed, either from the NFC reader flow or from your payment provider's callback. Then respond with `{ "result": "paid" }` or `{ "result": "declined" }`.

The app cancels the request if the person presses Back or Exit. Treat a closed connection as cancelled.

## Parts listed on the website

- Raspberry Pi 4 with the official 7″ touchscreen (800×480)
- 20 W solar panel, charge controller and 12 V 20 Ah battery
- One motor or solenoid per item slot, IR slot sensors, and a load cell under the tray
- Temperature sensor (safe range 15–25 °C)
- Reed switch on the service door
- NFC reader and a QR/barcode scanner. A USB scanner acts as a keyboard, and the token screen accepts typed input.
- 4G modem with Wi-Fi fallback
