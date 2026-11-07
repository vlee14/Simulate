import { RingBuffer } from './telemetry';

export interface StepMetrics {
  riseTime: number | null;
  settlingTime: number | null;
  overshoot: number | null;
  steadyState: number | null;
  peak: number | null;
}

/** Approximate step-response metrics from a recorded ring buffer. */
export function stepResponseMetrics(ring: RingBuffer | undefined, settleBand = 0.02): StepMetrics {
  if (!ring || ring.count < 4) {
    return { riseTime: null, settlingTime: null, overshoot: null, steadyState: null, peak: null };
  }
  const samples: { t: number; y: number }[] = [];
  ring.forEach((t, y) => {
    if (Number.isFinite(t) && Number.isFinite(y)) samples.push({ t, y });
  });
  if (samples.length < 4) {
    return { riseTime: null, settlingTime: null, overshoot: null, steadyState: null, peak: null };
  }
  const y0 = samples[0].y;
  const steady = samples.slice(-Math.max(4, Math.floor(samples.length * 0.1))).reduce((s, p) => s + p.y, 0) /
    Math.max(1, Math.floor(samples.length * 0.1));
  const delta = steady - y0;
  if (Math.abs(delta) < 1e-9) {
    return { riseTime: null, settlingTime: null, overshoot: 0, steadyState: steady, peak: steady };
  }
  const lo = y0 + 0.1 * delta;
  const hi = y0 + 0.9 * delta;
  let t10: number | null = null;
  let t90: number | null = null;
  for (const sample of samples) {
    if (t10 === null && Math.sign(delta) * (sample.y - lo) >= 0) t10 = sample.t;
    if (t90 === null && Math.sign(delta) * (sample.y - hi) >= 0) t90 = sample.t;
  }
  let peak = y0;
  for (const sample of samples) {
    if (delta > 0 ? sample.y > peak : sample.y < peak) peak = sample.y;
  }
  const overshoot = ((peak - steady) / delta) * 100;
  const band = Math.abs(delta) * settleBand;
  let settling: number | null = null;
  for (let i = samples.length - 1; i >= 0; i--) {
    if (Math.abs(samples[i].y - steady) > band) {
      settling = i + 1 < samples.length ? samples[i + 1].t : samples[i].t;
      break;
    }
  }
  if (settling === null) settling = samples[0].t;
  return {
    riseTime: t10 !== null && t90 !== null ? t90 - t10 : null,
    settlingTime: settling - samples[0].t,
    overshoot: Number.isFinite(overshoot) ? overshoot : null,
    steadyState: steady,
    peak,
  };
}

export interface SweepPoint {
  value: number;
  metric: number;
}

/** Run offline simulations sweeping one numeric parameter. */
export function sweepParameter(
  run: (value: number) => number,
  values: number[]
): SweepPoint[] {
  return values.map((value) => ({ value, metric: run(value) }));
}
