export interface Sample {
  t: number;
  y: number;
}

export class RingBuffer {
  readonly t: Float64Array;
  readonly y: Float64Array;
  head = 0;
  count = 0;

  constructor(public capacity: number) {
    this.t = new Float64Array(capacity);
    this.y = new Float64Array(capacity);
  }

  push(t: number, y: number): void {
    this.t[this.head] = t;
    this.y[this.head] = Number.isFinite(y) ? y : 0;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }

  /** Oldest-first view of the last `count` samples. */
  forEach(fn: (t: number, y: number, index: number) => void): void {
    const start = this.count < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.count; i++) {
      const k = (start + i) % this.capacity;
      fn(this.t[k], this.y[k], i);
    }
  }

  /** Oldest-first sample. */
  at(index: number): { t: number; y: number } | null {
    if (index < 0 || index >= this.count) return null;
    const start = this.count < this.capacity ? 0 : this.head;
    const k = (start + index) % this.capacity;
    return { t: this.t[k], y: this.y[k] };
  }

  last(): { t: number; y: number } | null {
    if (this.count === 0) return null;
    const k = (this.head - 1 + this.capacity) % this.capacity;
    return { t: this.t[k], y: this.y[k] };
  }
}

export interface TrailPoint {
  x: number;
  y: number;
}

class TelemetryBus {
  series = new Map<string, RingBuffer>();
  latest = new Map<string, Record<string, number>>();
  trails = new Map<string, TrailPoint[]>();
  private listeners = new Set<() => void>();

  key(blockId: string, port: string): string {
    return `${blockId}:${port}`;
  }

  ensure(blockId: string, port: string, capacity: number): RingBuffer {
    const k = this.key(blockId, port);
    let ring = this.series.get(k);
    if (!ring || ring.capacity !== capacity) {
      ring = new RingBuffer(capacity);
      this.series.set(k, ring);
    }
    return ring;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  publish(): void {
    for (const fn of this.listeners) fn();
  }

  reset(): void {
    for (const ring of this.series.values()) ring.clear();
    this.latest.clear();
    this.trails.clear();
    this.publish();
  }
}

export const telemetry = new TelemetryBus();
