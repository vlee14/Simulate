import { Eigenvalue } from './eig';
import { FreqPoint } from './stability';

/** Lightweight per-run payload from the MC campaign (no full StabilityReport). */
export interface McRunSample {
  run: number;
  closedStable: boolean;
  spectralAbscissa: number;
  polesClosed: Eigenvalue[];
  /** Packed frequency response: re,im,magDb,phaseDeg per ω (length 4*W) or empty. */
  freqFlat: Float64Array | number[];
  gainMarginDb: number | null;
  phaseMarginDeg: number | null;
  /** Row-major A (n*n) for optional WebGPU Bode pass. */
  Aflat?: Float64Array | number[];
  /** B column (n). */
  Bflat?: Float64Array | number[];
  n?: number;
}

export interface PercentileBand {
  /** Shared x (ω or sample index). */
  x: number[];
  p05: number[];
  p25: number[];
  p50: number[];
  p75: number[];
  p95: number[];
}

export interface McCampaignStats {
  total: number;
  ok: number;
  stableCount: number;
  stableFraction: number;
  alphaP50: number | null;
  alphaP95: number | null;
  gmP50: number | null;
  pmP50: number | null;
  /** Closed-loop pole cloud (all runs). */
  poleCloud: { real: number; imag: number }[];
  bodeMag: PercentileBand | null;
  bodePhase: PercentileBand | null;
  nyquistRe: PercentileBand | null;
  nyquistIm: PercentileBand | null;
  backend: 'cpu' | 'webgpu' | 'hybrid';
  elapsedMs: number;
  /** Runs kept for grey line overlay (subset of campaign). */
  overlayRuns: number[];
  /** Optional dense line pack for WebGL (magDb curves): overlay or all. */
  linePack?: {
    kind: 'bode-mag' | 'bode-phase' | 'nyquist';
    runs: number[];
    /** Interleaved polylines: for each run, W points as x,y pairs then NaN break. */
    xy: Float32Array;
    pointsPerRun: number;
  };
}

export const MC_CAMPAIGN_MAX = 10_000;
export const MC_OVERLAY_DEFAULT = 96;
export const MC_OVERLAY_MAX = 256;

export function clampCampaignSize(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MC_CAMPAIGN_MAX, Math.max(1, Math.round(n)));
}

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const t = Math.min(1, Math.max(0, p)) * (sorted.length - 1);
  const i = Math.floor(t);
  const f = t - i;
  const a = sorted[i];
  const b = sorted[Math.min(sorted.length - 1, i + 1)];
  return a + (b - a) * f;
}

function colPercentiles(cols: number[][], x: number[]): PercentileBand | null {
  if (!cols.length || !cols[0]?.length) return null;
  const W = cols[0].length;
  const band: PercentileBand = { x: x.slice(), p05: [], p25: [], p50: [], p75: [], p95: [] };
  for (let j = 0; j < W; j++) {
    const col: number[] = [];
    for (let i = 0; i < cols.length; i++) {
      const v = cols[i][j];
      if (Number.isFinite(v)) col.push(v);
    }
    col.sort((a, b) => a - b);
    if (!col.length) {
      band.p05.push(NaN);
      band.p25.push(NaN);
      band.p50.push(NaN);
      band.p75.push(NaN);
      band.p95.push(NaN);
      continue;
    }
    band.p05.push(percentile(col, 0.05));
    band.p25.push(percentile(col, 0.25));
    band.p50.push(percentile(col, 0.5));
    band.p75.push(percentile(col, 0.75));
    band.p95.push(percentile(col, 0.95));
  }
  return band;
}

/** Deterministic subset of run indices in 1…N for grey overlays. */
export function pickOverlayRuns(total: number, overlayCount: number, selectedRun = 0): number[] {
  const n = Math.min(Math.max(0, overlayCount), Math.max(0, total));
  if (n <= 0 || total <= 0) return [];
  if (n >= total) return Array.from({ length: total }, (_, i) => i + 1);
  const out: number[] = [];
  const used = new Set<number>();
  if (selectedRun > 0 && selectedRun <= total) {
    out.push(selectedRun);
    used.add(selectedRun);
  }
  for (let i = 0; i < n && out.length < n; i++) {
    const run = 1 + Math.floor(((i + 0.5) * total) / n);
    const r = Math.min(total, Math.max(1, run));
    if (!used.has(r)) {
      used.add(r);
      out.push(r);
    }
  }
  let guard = 1;
  while (out.length < n && guard <= total) {
    if (!used.has(guard)) {
      used.add(guard);
      out.push(guard);
    }
    guard++;
  }
  return out.sort((a, b) => a - b);
}

export function freqFlatToPoints(freqFlat: ArrayLike<number>, ws: number[]): FreqPoint[] {
  const W = ws.length;
  const points: FreqPoint[] = [];
  for (let i = 0; i < W; i++) {
    const re = freqFlat[i * 4];
    const im = freqFlat[i * 4 + 1];
    const magDb = freqFlat[i * 4 + 2];
    const phaseDeg = freqFlat[i * 4 + 3];
    if (!Number.isFinite(re) || !Number.isFinite(im)) continue;
    const mag = Math.hypot(re, im);
    points.push({ w: ws[i], re, im, mag, magDb, phaseDeg });
  }
  return points;
}

export function aggregateCampaign(
  samples: McRunSample[],
  ws: number[],
  opts: {
    overlayCount: number;
    selectedRun?: number;
    includeAllLines?: boolean;
    backend?: McCampaignStats['backend'];
    elapsedMs?: number;
  }
): McCampaignStats {
  const ok = samples.filter((s) => s.polesClosed?.length);
  const stableCount = ok.filter((s) => s.closedStable).length;
  const alphas = ok.map((s) => s.spectralAbscissa).filter(Number.isFinite).sort((a, b) => a - b);
  const gms = ok.map((s) => s.gainMarginDb).filter((v): v is number => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  const pms = ok.map((s) => s.phaseMarginDeg).filter((v): v is number => v != null && Number.isFinite(v)).sort((a, b) => a - b);

  const magCols: number[][] = [];
  const phCols: number[][] = [];
  const reCols: number[][] = [];
  const imCols: number[][] = [];
  const poleCloud: { real: number; imag: number }[] = [];
  for (const s of ok) {
    for (const p of s.polesClosed) poleCloud.push({ real: p.real, imag: p.imag });
    const flat = s.freqFlat;
    if (!flat || flat.length < ws.length * 4) continue;
    const mag: number[] = [];
    const ph: number[] = [];
    const re: number[] = [];
    const im: number[] = [];
    for (let i = 0; i < ws.length; i++) {
      re.push(flat[i * 4] as number);
      im.push(flat[i * 4 + 1] as number);
      mag.push(flat[i * 4 + 2] as number);
      ph.push(flat[i * 4 + 3] as number);
    }
    magCols.push(mag);
    phCols.push(ph);
    reCols.push(re);
    imCols.push(im);
  }

  const overlayRuns = pickOverlayRuns(ok.length ? Math.max(...ok.map((s) => s.run)) : 0, opts.overlayCount, opts.selectedRun ?? 0);
  // Prefer overlay by actual sample runs present
  const present = new Set(ok.map((s) => s.run));
  const overlayFiltered = overlayRuns.filter((r) => present.has(r));
  const lineRuns = opts.includeAllLines ? ok.map((s) => s.run) : overlayFiltered;

  let linePack: McCampaignStats['linePack'];
  if (lineRuns.length && magCols.length) {
    const byRun = new Map(ok.map((s) => [s.run, s]));
    const W = ws.length;
    const xy = new Float32Array(lineRuns.length * (W * 2 + 2));
    let o = 0;
    for (const run of lineRuns) {
      const s = byRun.get(run);
      const flat = s?.freqFlat;
      for (let i = 0; i < W; i++) {
        xy[o++] = Math.log10(Math.max(1e-12, ws[i]));
        xy[o++] = flat && flat.length >= (i + 1) * 4 ? (flat[i * 4 + 2] as number) : NaN;
      }
      xy[o++] = NaN;
      xy[o++] = NaN;
    }
    linePack = { kind: 'bode-mag', runs: lineRuns, xy, pointsPerRun: W };
  }

  return {
    total: samples.length,
    ok: ok.length,
    stableCount,
    stableFraction: ok.length ? stableCount / ok.length : 0,
    alphaP50: alphas.length ? percentile(alphas, 0.5) : null,
    alphaP95: alphas.length ? percentile(alphas, 0.95) : null,
    gmP50: gms.length ? percentile(gms, 0.5) : null,
    pmP50: pms.length ? percentile(pms, 0.5) : null,
    poleCloud,
    bodeMag: colPercentiles(magCols, ws.map((w) => Math.log10(w))),
    bodePhase: colPercentiles(phCols, ws.map((w) => Math.log10(w))),
    nyquistRe: colPercentiles(reCols, ws.map((_, i) => i)),
    nyquistIm: colPercentiles(imCols, ws.map((_, i) => i)),
    backend: opts.backend ?? 'cpu',
    elapsedMs: opts.elapsedMs ?? 0,
    overlayRuns: overlayFiltered,
    linePack,
  };
}
