/** Nice linear tick values covering [min, max]. */
export function niceTicks(min: number, max: number, target = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  let lo = min;
  let hi = max;
  if (hi < lo) {
    const t = lo;
    lo = hi;
    hi = t;
  }
  if (hi - lo < 1e-15) {
    const pad = Math.max(1e-3, Math.abs(lo) * 0.1 || 1);
    lo -= pad;
    hi += pad;
  }
  const span = hi - lo;
  const rough = span / Math.max(2, target - 1);
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const err = rough / pow;
  const step = (err < 1.5 ? 1 : err < 3 ? 2 : err < 7 ? 5 : 10) * pow;
  const start = Math.ceil(lo / step - 1e-12) * step;
  const out: number[] = [];
  for (let v = start; v <= hi + step * 1e-9; v += step) {
    const x = Math.abs(v) < step * 1e-10 ? 0 : Number(v.toPrecision(12));
    out.push(x);
  }
  return out;
}

/** Decade tick positions in log10 space (e.g. −3…3 → log10 of ω). */
export function logDecadeTicks(logMin: number, logMax: number): number[] {
  const lo = Math.ceil(logMin - 1e-9);
  const hi = Math.floor(logMax + 1e-9);
  const out: number[] = [];
  for (let e = lo; e <= hi; e++) out.push(e);
  if (!out.length) out.push(Math.round(0.5 * (logMin + logMax)));
  return out;
}

export function formatTick(v: number, kind: 'plain' | 'log10' | 'deg' = 'plain'): string {
  if (kind === 'log10') {
    const w = Math.pow(10, v);
    if (w >= 1000 || w < 0.01) return `10${superscript(Math.round(v))}`;
    if (w >= 10) return String(Math.round(w));
    if (w >= 1) return w.toFixed(0);
    return w.toPrecision(2).replace(/\.?0+$/, '');
  }
  if (kind === 'deg') {
    const n = Math.round(v);
    return `${n}°`;
  }
  const a = Math.abs(v);
  if (a !== 0 && (a < 0.01 || a >= 1000)) return v.toExponential(0);
  if (Number.isInteger(v) || Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v));
  return String(Number(v.toPrecision(3)));
}

function superscript(n: number): string {
  const map: Record<string, string> = {
    '-': '⁻',
    '0': '⁰',
    '1': '¹',
    '2': '²',
    '3': '³',
    '4': '⁴',
    '5': '⁵',
    '6': '⁶',
    '7': '⁷',
    '8': '⁸',
    '9': '⁹',
  };
  return String(n)
    .split('')
    .map((c) => map[c] ?? c)
    .join('');
}

/**
 * Wrap phase into the classic Nichols window (−360°, 0°].
 * Continuous unwrapped Bode phase is folded so the chart stays readable.
 */
export function wrapNicholsPhase(phaseDeg: number): number {
  if (!Number.isFinite(phaseDeg)) return phaseDeg;
  let x = phaseDeg;
  while (x > 0) x -= 360;
  while (x <= -360) x += 360;
  return x;
}

/** Map a series through wrapNicholsPhase, splitting when the wrap jumps. */
export function nicholsPhaseSeries(
  pts: { phaseDeg: number; magDb: number }[]
): { phaseDeg: number; magDb: number }[][] {
  const segments: { phaseDeg: number; magDb: number }[][] = [];
  let cur: { phaseDeg: number; magDb: number }[] = [];
  let prev: number | null = null;
  for (const p of pts) {
    const ph = wrapNicholsPhase(p.phaseDeg);
    if (prev != null && Math.abs(ph - prev) > 180) {
      if (cur.length) segments.push(cur);
      cur = [];
    }
    cur.push({ phaseDeg: ph, magDb: p.magDb });
    prev = ph;
  }
  if (cur.length) segments.push(cur);
  return segments;
}
