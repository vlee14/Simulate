import { loopResponse, logspace } from './stability';

export interface PackedPlant {
  n: number;
  /** Row-major A, length n*n. */
  A: ArrayLike<number>;
  /** B column, length n. */
  B: ArrayLike<number>;
}

function unpackA(p: PackedPlant): number[][] {
  const { n, A } = p;
  const out: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out[i][j] = A[i * n + j] as number;
  return out;
}

function unpackB(p: PackedPlant): number[][] {
  const { n, B } = p;
  return Array.from({ length: n }, (_, i) => [B[i] as number]);
}

/**
 * CPU batched frequency response for many plants sharing K and ω grid.
 * Output layout per plant: [re, im, magDb, phaseDeg] * W (phase unwrapped along ω).
 */
export function frequencyResponseBatchCpu(
  plants: PackedPlant[],
  K: number[],
  ws: number[] = logspace(1e-3, 1e3, 96)
): Float64Array {
  const W = ws.length;
  const out = new Float64Array(plants.length * W * 4);
  if (!K.some((v) => Math.abs(v) > 1e-12)) return out;

  for (let p = 0; p < plants.length; p++) {
    const A = unpackA(plants[p]);
    const B = unpackB(plants[p]);
    let prevPhase: number | null = null;
    const base = p * W * 4;
    for (let i = 0; i < W; i++) {
      const L = loopResponse(A, B, K, ws[i]);
      const o = base + i * 4;
      if (!L) {
        out[o] = NaN;
        out[o + 1] = NaN;
        out[o + 2] = NaN;
        out[o + 3] = NaN;
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
  }
  return out;
}

export function packPlant(A: number[][], B: number[][]): PackedPlant {
  const n = A.length;
  const Af = new Float64Array(n * n);
  const Bf = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    Bf[i] = B[i]?.[0] ?? 0;
    for (let j = 0; j < n; j++) Af[i * n + j] = A[i][j];
  }
  return { n, A: Af, B: Bf };
}
