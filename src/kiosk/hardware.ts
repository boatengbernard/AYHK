/**
 * Everything the kiosk software needs from the machine. Two implementations:
 *
 * - SimHardware: runs in any browser, for development, demos and training.
 *   The technician panel drives it (door, temperature, jams, payments).
 * - BridgeHardware: talks to a small local service on the Raspberry Pi
 *   (default http://localhost:8787) that drives the motors, sensors and NFC
 *   reader over GPIO. See docs/HARDWARE.md for the endpoints it expects.
 */

export type DispenseResult = 'dropped' | 'jammed';
export type PaymentResult = 'paid' | 'declined' | 'cancelled';

export interface HardwareState {
  temperatureC: number | null;
  doorOpen: boolean;
}

export interface Hardware {
  readonly kind: 'sim' | 'bridge';
  state(): HardwareState;
  subscribe(fn: () => void): () => void;
  dispense(item: string): Promise<DispenseResult>;
  /** Waits for mobile money to confirm the payment for this one-time reference. */
  awaitPayment(amountPesewas: number, reference: string, signal: AbortSignal): Promise<PaymentResult>;
}

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((res, rej) => {
    const t = setTimeout(res, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      rej(new DOMException('aborted', 'AbortError'));
    });
  });

export class SimHardware implements Hardware {
  readonly kind = 'sim' as const;
  temperatureC = 23.2;
  doorOpen = false;
  jamNext = false;
  declineNext = false;
  autoPayMs = 3500;
  private listeners = new Set<() => void>();

  state(): HardwareState {
    return { temperatureC: this.temperatureC, doorOpen: this.doorOpen };
  }
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  set(patch: Partial<Pick<SimHardware, 'temperatureC' | 'doorOpen' | 'jamNext' | 'declineNext'>>) {
    Object.assign(this, patch);
    this.listeners.forEach((l) => l());
  }
  async dispense(): Promise<DispenseResult> {
    await wait(2200);
    if (this.jamNext) {
      this.set({ jamNext: false });
      return 'jammed';
    }
    return 'dropped';
  }
  async awaitPayment(_amount: number, _reference: string, signal: AbortSignal): Promise<PaymentResult> {
    try {
      await wait(this.autoPayMs, signal);
    } catch {
      return 'cancelled';
    }
    if (this.declineNext) {
      this.set({ declineNext: false });
      return 'declined';
    }
    return 'paid';
  }
}

export class BridgeHardware implements Hardware {
  readonly kind = 'bridge' as const;
  private current: HardwareState = { temperatureC: null, doorOpen: false };
  private listeners = new Set<() => void>();
  private base: string;

  constructor(base = 'http://localhost:8787') {
    this.base = base;
    setInterval(() => void this.poll(), 5000);
    void this.poll();
  }
  private async poll() {
    try {
      const r = await fetch(`${this.base}/sensors`);
      const s = (await r.json()) as HardwareState;
      if (s.temperatureC !== this.current.temperatureC || s.doorOpen !== this.current.doorOpen) {
        this.current = s;
        this.listeners.forEach((l) => l());
      }
    } catch {
      /* bridge not reachable; keep last known state */
    }
  }
  state() {
    return this.current;
  }
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  async dispense(item: string): Promise<DispenseResult> {
    try {
      const r = await fetch(`${this.base}/dispense`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ item }) });
      const j = (await r.json()) as { result: DispenseResult };
      return j.result === 'dropped' ? 'dropped' : 'jammed';
    } catch {
      return 'jammed';
    }
  }
  async awaitPayment(amountPesewas: number, reference: string, signal: AbortSignal): Promise<PaymentResult> {
    try {
      const r = await fetch(`${this.base}/payment`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amountPesewas, reference }),
        signal,
      });
      const j = (await r.json()) as { result: PaymentResult };
      return j.result;
    } catch {
      return signal.aborted ? 'cancelled' : 'declined';
    }
  }
}
