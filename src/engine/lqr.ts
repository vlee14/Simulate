import { c2d, clone, lyapunov, matVec, mul, rank, transpose, zeros } from './linalg';
import { eigenvalues, Eigenvalue, isHurwitz } from './eig';
import { linearizePendulum, PendulumParams } from './physics';

export interface LqrResult {
  K: number[];
  polesOpen: Eigenvalue[];
  polesClosed: Eigenvalue[];
  controllable: boolean;
  rank: number;
}

function closedLoop(A: number[][], B: number[][], K: number[]): number[][] {
  const Acl = clone(A);
  for (let i = 0; i < A.length; i++) {
    for (let j = 0; j < A.length; j++) Acl[i][j] -= B[i][0] * K[j];
  }
  return Acl;
}

function controllability(A: number[][], B: number[][]): { matrix: number[][]; rank: number } {
  const n = A.length;
  const cols: number[][] = [];
  let col = B.map((row) => row[0]);
  for (let k = 0; k < n; k++) {
    cols.push(col);
    col = matVec(A, col);
  }
  const C = zeros(n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) C[i][j] = cols[j][i];
  }
  return { matrix: C, rank: rank(C, 1e-7) };
}

/** Discrete algebraic Riccati recursion. Returns the gain of u = −K x. */
function discreteLqr(Ad: number[][], Bd: number[][], Q: number[][], R: number): number[] | null {
  const n = Ad.length;
  let P = zeros(n);
  let K = new Array(n).fill(0);
  for (let iter = 0; iter < 400; iter++) {
    const BT = transpose(Bd);
    const BTP = mul(BT, P);
    const S = R + mul(BTP, Bd)[0][0];
    if (!Number.isFinite(S) || Math.abs(S) < 1e-14) return null;
    const BTPad = mul(BTP, Ad)[0];
    const Knew = BTPad.map((v) => v / S);
    const AdT = transpose(Ad);
    const AdTP = mul(AdT, P);
    const AdTPAd = mul(AdTP, Ad);
    const AdTPB = mul(AdTP, Bd);
    const Pnext = zeros(n);
    let diff = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const v = AdTPAd[i][j] - AdTPB[i][0] * Knew[j] + Q[i][j];
        Pnext[i][j] = v;
        diff = Math.max(diff, Math.abs(v - P[i][j]));
      }
    }
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const v = 0.5 * (Pnext[i][j] + Pnext[j][i]);
        Pnext[i][j] = v;
        Pnext[j][i] = v;
      }
    }
    P = Pnext;
    K = Knew;
    if (diff < 1e-10) break;
  }
  return K;
}

function kleinman(A: number[][], B: number[][], Q: number[][], R: number, K0: number[]): number[] | null {
  let K = K0.slice();
  const n = A.length;
  for (let iter = 0; iter < 40; iter++) {
    const Acl = closedLoop(A, B, K);
    if (!isHurwitz(Acl, 1e-8)) return null;
    const Qbar = clone(Q);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) Qbar[i][j] += K[i] * R * K[j];
    }
    const P = lyapunov(Acl, Qbar);
    if (!P) return null;
    const BT = transpose(B);
    const BTP = mul(BT, P)[0];
    const Knew = BTP.map((v) => v / R);
    let diff = 0;
    for (let i = 0; i < n; i++) diff = Math.max(diff, Math.abs(Knew[i] - K[i]));
    K = Knew;
    if (diff < 1e-8) return K;
  }
  return K;
}

function stabilizingSeed(A: number[][], B: number[][], Q: number[][], R: number): number[] | null {
  const samples = [0.01, 0.005, 0.02, 0.002, 0.05];
  for (const Ts of samples) {
    const { Ad, Bd } = c2d(A, B, Ts);
    const Kd = discreteLqr(Ad, Bd, Q, R);
    if (!Kd) continue;
    if (isHurwitz(closedLoop(A, B, Kd), 1e-6)) return Kd;
  }
  return null;
}

export function lqr(A: number[][], B: number[][], Qdiag: number[], R: number): LqrResult {
  const n = A.length;
  if (B.length !== n || B[0]?.length !== 1) {
    throw new Error('LQR here expects a single input.');
  }
  if (!(R > 0)) throw new Error('Control weight R must be positive.');
  const Q = zeros(n);
  for (let i = 0; i < n; i++) {
    const q = Qdiag[i] ?? 0;
    if (q < 0) throw new Error('State weights must be non-negative.');
    Q[i][i] = q;
  }
  const ctrb = controllability(A, B);
  const polesOpen = eigenvalues(A);
  if (ctrb.rank < n) {
    return { K: new Array(n).fill(0), polesOpen, polesClosed: polesOpen, controllable: false, rank: ctrb.rank };
  }
  const seed = stabilizingSeed(A, B, Q, R);
  if (!seed) throw new Error('Could not find a stabilizing gain. Check that the plant is controllable.');
  const K = kleinman(A, B, Q, R, seed) ?? seed;
  const polesClosed = eigenvalues(closedLoop(A, B, K));
  if (!polesClosed.every((e) => e.real < -1e-6)) {
    throw new Error('LQR did not produce a stable closed loop.');
  }
  return { K, polesOpen, polesClosed, controllable: true, rank: ctrb.rank };
}

export function designPendulumLqr(params: PendulumParams, Qdiag: number[], R: number): LqrResult {
  const { A, B } = linearizePendulum(params);
  return lqr(A, B, Qdiag, R);
}

export function formatPole(e: Eigenvalue): string {
  const r = e.real;
  const im = e.imag;
  const rs = r.toFixed(3);
  if (Math.abs(im) < 1e-7) return rs;
  const sign = im >= 0 ? '+' : '−';
  return `${rs} ${sign} ${Math.abs(im).toFixed(3)}j`;
}
