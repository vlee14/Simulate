import { DistKind, GraphNode, Param, ParamUncertainty } from './types';

export type { DistKind, ParamUncertainty };

export const DIST_OPTIONS: { id: DistKind; label: string; help: string }[] = [
  { id: 'none', label: 'Nominal only', help: 'Always use the typed value' },
  { id: 'normal', label: 'Normal', help: 'N(nominal, σ) — spread is σ' },
  { id: 'uniform', label: 'Uniform', help: 'U(nominal±spread)' },
  { id: 'percent', label: 'Percent Normal', help: 'N(nominal, |nominal|·% / 100)' },
  { id: 'lognormal', label: 'Lognormal', help: 'Lognormal median=nominal, σ=spread' },
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

export interface McRunRecommendation {
  /** Number of distributed parameters. */
  params: number;
  /** Quick screening / smoke set (runs 1…N). */
  explore: number;
  /** Reasonable mean / variance estimate. */
  mean: number;
  /** Percentiles / tails / robust stats. */
  tails: number;
  /** Primary suggestion (mean tier). */
  recommended: number;
  summary: string;
  detail: string;
}

/**
 * Suggest how many distinct Monte Carlo runs (1…N) to execute.
 * Run 0 is always nominal and is not counted in N.
 *
 * Rules of thumb (UQ / DOE practice):
 * - explore ≈ max(10, 10·p)
 * - mean    ≈ max(100, 50·p)
 * - tails   ≈ max(500, 100·p)
 */
export function recommendMcRuns(paramCount: number): McRunRecommendation {
  const p = Math.max(0, Math.floor(paramCount));
  if (p <= 0) {
    return {
      params: 0,
      explore: 0,
      mean: 0,
      tails: 0,
      recommended: 0,
      summary: 'No distributed parameters — Monte Carlo runs are optional.',
      detail: 'Enable a distribution on numeric plant/sensor parameters to get a run-count recommendation.',
    };
  }
  const explore = Math.max(10, 10 * p);
  const mean = Math.max(100, 50 * p);
  const tails = Math.max(500, 100 * p);
  return {
    params: p,
    explore,
    mean,
    tails,
    recommended: mean,
    summary: `${p} uncertain parameter${p === 1 ? '' : 's'} → try ~${mean} runs (1…${mean}) for mean stats.`,
    detail:
      `Rules of thumb from p = ${p}: explore ≥ ${explore} (10p), ` +
      `mean/variance ≥ ${mean} (50p), tails/percentiles ≥ ${tails} (100p). ` +
      `Run 0 stays nominal and is not part of the campaign.`,
  };
}

function formatNum(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e4)) return value.toExponential(3);
  return String(Number(value.toPrecision(6)));
}
