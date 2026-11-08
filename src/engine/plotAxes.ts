function niceStep(span: number, target: number): number {
  const rough = span / Math.max(2, target - 1);
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(rough, Number.MIN_VALUE))));
  const err = rough / pow;
  return (err < 1.5 ? 1 : err < 3 ? 2 : err < 7 ? 5 : 10) * pow;
}

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
  const step = niceStep(hi - lo, target);
  const start = Math.ceil(lo / step - 1e-12) * step;
  const out: number[] = [];
  for (let v = start; v <= hi + step * 1e-9; v += step) {
    const x = Math.abs(v) < step * 1e-10 ? 0 : Number(v.toPrecision(12));
    out.push(x);
  }
  return out;
}

/**
 * Expand a data range with padding and snap outward to nice tick edges.
 * Optional anchors (e.g. 0, −180) stay inside the window when nearby.
 */
export function niceBounds(
  min: number,
  max: number,
  opts: {
    padFrac?: number;
    minSpan?: number;
    targetTicks?: number;
    anchors?: number[];
    clamp?: { min?: number; max?: number };
  } = {}
): { min: number; max: number } {
  const padFrac = opts.padFrac ?? 0.1;
  const target = opts.targetTicks ?? 5;
  let lo = Number.isFinite(min) ? min : 0;
  let hi = Number.isFinite(max) ? max : 1;
  if (hi < lo) {
    const t = lo;
    lo = hi;
    hi = t;
  }
  const minSpan = opts.minSpan ?? 0;
  if (hi - lo < minSpan) {
    const mid = 0.5 * (hi + lo);
    lo = mid - 0.5 * minSpan;
    hi = mid + 0.5 * minSpan;
  }
  const pad = Math.max((hi - lo) * padFrac, Number.EPSILON);
  lo -= pad;
  hi += pad;
  for (const a of opts.anchors ?? []) {
    if (!Number.isFinite(a)) continue;
    // Pull in nearby reference lines without exploding empty space.
    if (a >= lo - (hi - lo) * 0.35 && a <= hi + (hi - lo) * 0.35) {
      lo = Math.min(lo, a);
      hi = Math.max(hi, a);
    }
  }
  if (opts.clamp) {
    if (opts.clamp.min != null) lo = Math.max(lo, opts.clamp.min);
    if (opts.clamp.max != null) hi = Math.min(hi, opts.clamp.max);
    if (hi <= lo) {
      const mid = 0.5 * ((opts.clamp.min ?? lo) + (opts.clamp.max ?? hi));
      lo = mid - 0.5 * Math.max(minSpan, 1);
      hi = mid + 0.5 * Math.max(minSpan, 1);
      if (opts.clamp.min != null) lo = Math.max(lo, opts.clamp.min);
      if (opts.clamp.max != null) hi = Math.min(hi, opts.clamp.max);
    }
  }
  const step = niceStep(Math.max(hi - lo, minSpan || 1e-6), target);
  lo = Math.floor(lo / step - 1e-12) * step;
  hi = Math.ceil(hi / step + 1e-12) * step;
  if (opts.clamp) {
    if (opts.clamp.min != null) lo = Math.max(lo, opts.clamp.min);
    if (opts.clamp.max != null) hi = Math.min(hi, opts.clamp.max);
  }
  return {
    min: Number(lo.toPrecision(12)),
    max: Number(hi.toPrecision(12)),
  };
}

/** Symmetric axis limit for Re/Im plots, robust to a few outliers. */
export function symmetricLimit(
  values: number[],
  opts: { padFrac?: number; floor?: number; ceil?: number; percentile?: number; include?: number[] } = {}
): number {
  const finite = values.filter((v) => Number.isFinite(v)).map((v) => Math.abs(v));
  for (const v of opts.include ?? []) if (Number.isFinite(v)) finite.push(Math.abs(v));
  if (!finite.length) return opts.floor ?? 1;
  finite.sort((a, b) => a - b);
  const pct = Math.min(1, Math.max(0.5, opts.percentile ?? 0.95));
  const idx = Math.min(finite.length - 1, Math.max(0, Math.floor(pct * (finite.length - 1))));
  let lim = finite[idx];
  // If the true max is only modestly larger, keep it so tips aren't clipped hard.
  const absMax = finite[finite.length - 1];
  if (absMax <= lim * 1.35) lim = absMax;
  lim *= 1 + (opts.padFrac ?? 0.12);
  lim = Math.max(lim, opts.floor ?? 1);
  if (opts.ceil != null) lim = Math.min(lim, opts.ceil);
  const step = niceStep(2 * lim, 5);
  lim = Math.ceil(lim / step - 1e-12) * step;
  if (opts.ceil != null) lim = Math.min(lim, opts.ceil);
  return Math.max(lim, opts.floor ?? 1);
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
 * Continuous unwrapped Bode phase is folded so the chart stays readable;
 * the critical point sits at −180°.
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

/** Axis window in plot-native units (Bode x is log₁₀ ω). */
export type ChartAxisBounds = {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
};

/** Apply optional manual overrides; keep a tiny span if the user inverts an axis. */
export function resolveAxisBounds(
  auto: ChartAxisBounds,
  override?: Partial<ChartAxisBounds> | null
): ChartAxisBounds {
  const pick = (key: keyof ChartAxisBounds) => {
    const v = override?.[key];
    return v != null && Number.isFinite(v) ? (v as number) : auto[key];
  };
  let xMin = pick('xMin');
  let xMax = pick('xMax');
  let yMin = pick('yMin');
  let yMax = pick('yMax');
  if (!(xMax > xMin)) {
    const mid = 0.5 * (xMin + xMax);
    const pad = Math.max(1e-6, Math.abs(mid) * 0.05 || 0.5);
    xMin = mid - pad;
    xMax = mid + pad;
  }
  if (!(yMax > yMin)) {
    const mid = 0.5 * (yMin + yMax);
    const pad = Math.max(1e-6, Math.abs(mid) * 0.05 || 0.5);
    yMin = mid - pad;
    yMax = mid + pad;
  }
  return { xMin, xMax, yMin, yMax };
}

export function boundsApproxEqual(a: ChartAxisBounds, b: ChartAxisBounds, eps = 1e-9): boolean {
  return (
    Math.abs(a.xMin - b.xMin) <= eps &&
    Math.abs(a.xMax - b.xMax) <= eps &&
    Math.abs(a.yMin - b.yMin) <= eps &&
    Math.abs(a.yMax - b.yMax) <= eps
  );
}
