import { DistKind, GraphNode, Param, ParamUncertainty } from './types';

export type { DistKind, ParamUncertainty };

export const DIST_OPTIONS: { id: DistKind; label: string; help: string }[] = [
  { id: 'none', label: 'Nominal only', help: 'Use the typed value' },
  { id: 'normal', label: 'Normal', help: 'Spread is σ' },
  { id: 'uniform', label: 'Uniform', help: '± spread' },
  { id: 'percent', label: 'Percent', help: 'σ as % of nominal' },
  { id: 'lognormal', label: 'Lognormal', help: 'Median = nominal' },
];

/** Assign a new stable seed when a distribution is first created/enabled. */
export function newUncertaintySeed(): number {
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return (buf[0] >>> 0) || 1;
  }
  return ((Math.random() * 0xffffffff) >>> 0) || 1;
}

/** Mix parameter seed with simulation index into a 32-bit RNG seed. */
export function mixSeed(paramSeed: number, run: number): number {
  let h = (paramSeed >>> 0) ^ Math.imul(run | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Mulberry32 — deterministic U[0,1). */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller using two uniforms from the same stream. */
function randn(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Draw one sample for a parameter.
 * Run 0 (and kind `none`) always returns the nominal value.
 */
export function drawNumeric(nominal: number, unc: ParamUncertainty | undefined, run: number): number {
  if (!unc || unc.kind === 'none' || !(run > 0) || !Number.isFinite(nominal)) return nominal;
  const rng = mulberry32(mixSeed(unc.seed, run));
  const spread = Number.isFinite(unc.spread) ? Math.abs(unc.spread) : 0;
  switch (unc.kind) {
    case 'normal':
      return nominal + spread * randn(rng);
    case 'uniform':
      return nominal + (rng() * 2 - 1) * spread;
    case 'percent': {
      const sigma = Math.abs(nominal) * (spread / 100);
      return nominal + sigma * randn(rng);
    }
    case 'lognormal': {
      if (!(nominal > 0)) return nominal;
      // median = nominal ⇒ μ = ln(nominal)
      return Math.exp(Math.log(nominal) + spread * randn(rng));
    }
    default:
      return nominal;
  }
}

export function effectiveParameters(
  parameters: Record<string, Param>,
  uncertainty: Record<string, ParamUncertainty> | undefined,
  run: number
): Record<string, Param> {
  if (!(run > 0) || !uncertainty) return parameters;
  const out: Record<string, Param> = { ...parameters };
  for (const [key, unc] of Object.entries(uncertainty)) {
    if (!unc || unc.kind === 'none') continue;
    const raw = parameters[key];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    out[key] = drawNumeric(raw, unc, run);
  }
  return out;
}

/** Apply Monte Carlo draws to a graph. Run 0 leaves parameters untouched. */
export function applyMonteCarlo(nodes: GraphNode[], run: number): GraphNode[] {
  if (!(run > 0)) return nodes;
  return nodes.map((node) => ({
    ...node,
    parameters: effectiveParameters(node.parameters, node.uncertainty, run),
  }));
}

export function describeDraw(unc: ParamUncertainty | undefined, nominal: number, run: number): string {
  if (!unc || unc.kind === 'none') return 'nominal';
  if (!(run > 0)) return `run 0 → nominal (${formatNum(nominal)})`;
  const drawn = drawNumeric(nominal, unc, run);
  return `run ${run} → ${formatNum(drawn)}`;
}

/** Count parameters that have an active (non-`none`) distribution. */
export function countUncertainParams(nodes: GraphNode[]): number {
  let n = 0;
  for (const node of nodes) {
    if (!node.uncertainty) continue;
    for (const unc of Object.values(node.uncertainty)) {
      if (unc && unc.kind !== 'none') n++;
    }
  }
  return n;
}

/**
 * Approximate relative σ (σ/|μ|) implied by a parameter’s distribution about its nominal.
 * Used as a first-order proxy when the quantity of interest is not yet simulated.
 */
export function relativeSigma(nominal: number, unc: ParamUncertainty): number {
  if (!unc || unc.kind === 'none' || !Number.isFinite(nominal)) return 0;
  const spread = Math.abs(unc.spread);
  const absNom = Math.abs(nominal);
  switch (unc.kind) {
    case 'normal':
      return absNom > 1e-12 ? spread / absNom : spread;
    case 'uniform':
      // Var = (2a)²/12 = a²/3 ⇒ σ = a/√3 for half-width a
      return absNom > 1e-12 ? spread / Math.sqrt(3) / absNom : spread / Math.sqrt(3);
    case 'percent':
      return spread / 100;
    case 'lognormal':
      // CV = sqrt(e^{σ²} − 1) for underlying Normal σ
      return Math.sqrt(Math.exp(spread * spread) - 1);
    default:
      return 0;
  }
}

/**
 * First-order uncorrelated RSS of relative σs → proxy output CV.
 * More uncertain parameters (or larger spreads) increase CV and thus N.
 */
export function proxyOutputCv(nodes: GraphNode[]): { params: number; cv: number } {
  let ss = 0;
  let params = 0;
  for (const node of nodes) {
    if (!node.uncertainty) continue;
    for (const [key, unc] of Object.entries(node.uncertainty)) {
      if (!unc || unc.kind === 'none') continue;
      const raw = node.parameters[key];
      if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
      const r = relativeSigma(raw, unc);
      if (!(r > 0)) continue;
      ss += r * r;
      params++;
    }
  }
  return { params, cv: Math.sqrt(ss) };
}

/** Two-sided normal z for confidence level in (0,1), e.g. 0.95 → ≈1.96. */
export function normalZ(confidence: number): number {
  const c = Math.min(0.999, Math.max(0.5, confidence));
  // Abramoitz-Stegun style rational approx for erfcinv on the upper tail
  const p = (1 - c) / 2;
  if (p <= 0) return 8;
  // Beasley-Springer/Moro-ish inverse-norm for common levels; exact for 90/95/99
  if (Math.abs(c - 0.9) < 1e-9) return 1.6448536269514722;
  if (Math.abs(c - 0.95) < 1e-9) return 1.959963984540054;
  if (Math.abs(c - 0.99) < 1e-9) return 2.5758293035489004;
  // Fallback: Hastings approximation for Φ⁻¹(1-p)
  const t = Math.sqrt(-2 * Math.log(p));
  const z =
    t -
    (2.515517 + 0.802853 * t + 0.010328 * t * t) /
      (1 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t * t * t);
  return z;
}

export interface McStatsOptions {
  /** Two-sided confidence for intervals (default 0.95). */
  confidence?: number;
  /** Target relative half-width for the mean, ε in |μ̂−μ| ≤ ε|μ| (default 0.05). */
  relError?: number;
  /** Tail quantile of interest, e.g. 0.95 (default 0.95). */
  tailQuantile?: number;
  /** Absolute error on the empirical CDF / exceedance probability (default 0.02). */
  tailCdfError?: number;
  /** Pilot base size M for Saltelli-style screening N=M(2p+2) (default from mean N). */
  saltelliBase?: number;
}

export interface McRunRecommendation {
  /** Number of distributed parameters. */
  params: number;
  /** Proxy output CV from RSS of relative σs. */
  cv: number;
  confidence: number;
  relError: number;
  z: number;
  /** Pilot / SE check (about ¼ of mean N, ≥ 30). */
  explore: number;
  /** CLT mean sample size N=(z·CV/ε)². */
  mean: number;
  /** Tail/quantile sample size from binomial CDF error + order-stat floor. */
  tails: number;
  /** Saltelli first-order screening budget M(2p+2). */
  screening: number;
  /** Primary suggestion (mean tier). */
  recommended: number;
  summary: string;
  detail: string;
}

function ceilPos(n: number, floor = 1): number {
  if (!Number.isFinite(n) || n <= 0) return floor;
  return Math.max(floor, Math.ceil(n));
}

/**
 * Statistically grounded Monte Carlo run counts (distinct runs 1…N; run 0 = nominal).
 *
 * - **Mean**: CLT / normal CI → N ≥ (z_{α/2} · CV / ε)² with CV from RSS of per-param relative σ
 * - **Tails**: estimating F at quantile q within absolute error δ → N ≥ z² q(1−q)/δ²,
 *   and at least ~50 samples beyond q → N ≥ 50/(1−q)
 * - **Screening**: Saltelli-style N = M(2p+2) with M ≈ mean N (main-effect UQ)
 * - **Explore**: max(30, mean/4) pilot before refining CV
 */
export function recommendMcRuns(nodesOrParamCount: GraphNode[] | number, opts: McStatsOptions = {}): McRunRecommendation {
  const confidence = opts.confidence ?? 0.95;
  const relError = opts.relError ?? 0.05;
  const tailQuantile = opts.tailQuantile ?? 0.95;
  const tailCdfError = opts.tailCdfError ?? 0.02;
  const z = normalZ(confidence);

  const fromNodes = Array.isArray(nodesOrParamCount);
  const { params, cv: rawCv } = fromNodes
    ? proxyOutputCv(nodesOrParamCount)
    : { params: Math.max(0, Math.floor(nodesOrParamCount as number)), cv: 0 };

  // If only a count is known (tests / no spreads), use a mild default CV ∝ √p
  // so dimension still enters the CLT formula.
  const cv = rawCv > 1e-12 ? rawCv : params > 0 ? 0.1 * Math.sqrt(params) : 0;

  if (params <= 0) {
    return {
      params: 0,
      cv: 0,
      confidence,
      relError,
      z,
      explore: 0,
      mean: 0,
      tails: 0,
      screening: 0,
      recommended: 0,
      summary: 'No uncertain parameters yet.',
      detail: 'Add a distribution on a parameter to enable Monte Carlo.',
    };
  }

  const eps = Math.max(1e-6, relError);
  const mean = ceilPos((z * Math.max(cv, 1e-6) / eps) ** 2, 30);
  const q = Math.min(0.999, Math.max(0.5, tailQuantile));
  const delta = Math.max(1e-4, tailCdfError);
  const nCdf = (z * z * q * (1 - q)) / (delta * delta);
  const nOrder = 50 / Math.max(1e-6, 1 - q);
  const tails = ceilPos(Math.max(nCdf, nOrder), mean);
  const M = opts.saltelliBase ?? mean;
  const screening = ceilPos(M * (2 * params + 2), mean);
  const explore = ceilPos(mean / 4, 30);

  return {
    params,
    cv,
    confidence,
    relError,
    z,
    explore,
    mean,
    tails,
    screening,
    recommended: mean,
    summary: `${params} uncertain parameter${params === 1 ? '' : 's'} — try about ${mean} runs for the mean.`,
    detail: 'More runs tighten means and tails.',
  };
}

function formatNum(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e4)) return value.toExponential(3);
  return String(Number(value.toPrecision(6)));
}
