import { eigenvalues } from './eig';
import { linearizeBlock } from './linearize';
import { applyMonteCarlo } from './montecarlo';
import { McRunSample } from './mcStats';
import { closedLoopMatrix, loopMargins, loopResponse, logspace } from './stability';
import { GraphNode, Param } from './types';
import { packPlant } from './freqBatch';

export interface McSampleJob {
  plantId: string;
  blockType: string;
  /** Nominal graph nodes (with uncertainty maps). */
  nodes: GraphNode[];
  xOp: number[];
  uOp: number[];
  /** Analysis time for scheduled plant parameters. */
  tOp?: number;
  K: number[];
  runStart: number;
  runEnd: number;
  /** Include packed A/B for a later WebGPU Bode pass. */
  keepAB?: boolean;
  /** If false, skip per-run frequency response (GPU/CPU batch later). */
  computeFreq?: boolean;
  nOmega?: number;
  /** Fired with how many runs finished in this range (1-based count). */
  onProgress?: (completedInRange: number, rangeTotal: number) => void;
  /** Progress cadence (default 32). */
  progressEvery?: number;
}

function marginsFromFlat(freqFlat: Float64Array | number[], ws: number[], K: number[]) {
  if (!K.some((v) => Math.abs(v) > 1e-12) || freqFlat.length < ws.length * 4) {
    return { gainMarginDb: null as number | null, phaseMarginDeg: null as number | null };
  }
  const points = [];
  for (let i = 0; i < ws.length; i++) {
    const re = freqFlat[i * 4] as number;
    const im = freqFlat[i * 4 + 1] as number;
    const magDb = freqFlat[i * 4 + 2] as number;
    const phaseDeg = freqFlat[i * 4 + 3] as number;
    if (!Number.isFinite(re)) continue;
    const mag = Math.hypot(re, im);
    points.push({ w: ws[i], re, im, mag, magDb, phaseDeg });
  }
  // Fake A,B unused when freq provided
  const m = loopMargins(
    [[0]],
    [[0]],
    K,
    points
  );
  return { gainMarginDb: m.gainMarginDb, phaseMarginDeg: m.phaseMarginDeg };
}

function fillFreq(A: number[][], B: number[][], K: number[], ws: number[]): Float64Array {
  const out = new Float64Array(ws.length * 4);
  let prevPhase: number | null = null;
  for (let i = 0; i < ws.length; i++) {
    const L = loopResponse(A, B, K, ws[i]);
    const o = i * 4;
    if (!L) {
      out[o] = out[o + 1] = out[o + 2] = out[o + 3] = NaN;
      continue;
    }
    const mag = Math.hypot(L.re, L.im);
    let phaseDeg = (Math.atan2(L.im, L.re) * 180) / Math.PI;
    if (prevPhase != null) {
      while (phaseDeg - prevPhase > 180) phaseDeg -= 360;
      while (phaseDeg - prevPhase < -180) phaseDeg += 360;
    }
    prevPhase = phaseDeg;
    out[o] = L.re;
    out[o + 1] = L.im;
    out[o + 2] = mag > 1e-16 ? 20 * Math.log10(mag) : -320;
    out[o + 3] = phaseDeg;
  }
  return out;
}

/** Process a contiguous run range for the Monte Carlo campaign. */
export function sampleMcRange(job: McSampleJob): McRunSample[] {
  const ws = logspace(1e-3, 1e3, job.nOmega ?? 96);
  const computeFreq = job.computeFreq !== false;
  const out: McRunSample[] = [];
  const rangeTotal = Math.max(0, job.runEnd - job.runStart + 1);
  const every = Math.max(1, job.progressEvery ?? 32);
  let completed = 0;
  for (let run = job.runStart; run <= job.runEnd; run++) {
    try {
      const nodes = applyMonteCarlo(job.nodes, run);
      const plant = nodes.find((n) => n.id === job.plantId);
      if (!plant) {
        completed++;
        if (job.onProgress && (completed % every === 0 || completed === rangeTotal)) job.onProgress(completed, rangeTotal);
        continue;
      }
      const { A, B } = linearizeBlock(
        plant.blockType,
        plant.parameters as Record<string, Param>,
        job.xOp,
        job.uOp,
        1e-6,
        job.tOp ?? 0
      );
      const B1 = B.map((row) => [row[0] ?? 0]);
      const Acl = closedLoopMatrix(A, B1, job.K);
      const polesClosed = eigenvalues(Acl);
      const closedStable = polesClosed.every((e) => e.real < -1e-7);
      const spectralAbscissa = polesClosed.reduce((m, e) => Math.max(m, e.real), -Infinity);
      const freqFlat = computeFreq ? fillFreq(A, B1, job.K, ws) : new Float64Array(0);
      const margins = computeFreq ? marginsFromFlat(freqFlat, ws, job.K) : { gainMarginDb: null, phaseMarginDeg: null };
      const packed = job.keepAB ? packPlant(A, B1) : null;
      out.push({
        run,
        closedStable,
        spectralAbscissa,
        polesClosed,
        freqFlat,
        gainMarginDb: margins.gainMarginDb,
        phaseMarginDeg: margins.phaseMarginDeg,
        Aflat: packed ? (packed.A instanceof Float64Array ? packed.A : Float64Array.from(packed.A as ArrayLike<number>)) : undefined,
        Bflat: packed ? (packed.B instanceof Float64Array ? packed.B : Float64Array.from(packed.B as ArrayLike<number>)) : undefined,
        n: A.length,
      });
    } catch {
      // skip failed linearizations
    }
    completed++;
    if (job.onProgress && (completed % every === 0 || completed === rangeTotal)) job.onProgress(completed, rangeTotal);
  }
  return out;
}
