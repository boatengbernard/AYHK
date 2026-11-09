import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Alert, Kiosk, KioskStatus, PilotRequest, TokenBatch, VendEvent } from '../src/shared/types.ts';

export interface Data {
  kiosks: Kiosk[];
  events: VendEvent[];
  statuses: KioskStatus[];
  alerts: Alert[];
  batches: TokenBatch[];
  pilotRequests: PilotRequest[];
}

const empty = (): Data => ({ kiosks: [], events: [], statuses: [], alerts: [], batches: [], pilotRequests: [] });

/**
 * A small JSON-file store, enough for a pilot of a few dozen kiosks.
 * Writes go to a temp file first and are renamed into place, so a power cut
 * mid-write cannot corrupt the data. Swap for Postgres when you scale.
 */
export class Store {
  data: Data;
  private file: string;
  private timer: NodeJS.Timeout | null = null;

  constructor(file: string, seed?: () => Data) {
    this.file = file;
    if (existsSync(file)) this.data = { ...empty(), ...JSON.parse(readFileSync(file, 'utf8')) };
    else {
      this.data = seed ? seed() : empty();
      this.flush();
    }
  }

  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 200);
  }

  flush() {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.file);
  }
}
