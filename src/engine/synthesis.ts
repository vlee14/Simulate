import { eigenvalues } from './eig';
import { clone, matVec, solve, zeros } from './linalg';
import { linearizeBlock } from './linearize';
import { controllabilityRank } from './stability';
import { Param } from './types';

export interface PidGains {
  Kp: number;
  Ki: number;
  Kd: number;
  Tf: number;
  note: string;
}

export interface PolePlacementResult {
  K: number[];
  polesDesired: { real: number; imag: number }[];
  polesClosed: { real: number; imag: number }[];
  note: string;
}

/** Parse poles like "-2", "-1±3j", "-2+3i -2-3i". */
export function parsePoleList(raw: string): { real: number; imag: number }[] {
  const text = String(raw || '').trim();
  if (!text) return [];
  const out: { real: number; imag: number }[] = [];
  const pair = /([+-]?\d*\.?\d+)\s*[±]\s*(\d*\.?\d+)\s*[ji]/gi;
  let m: RegExpExecArray | null;
  const used = new Set<string>();
  while ((m = pair.exec(text))) {
    const re = Number(m[1]);
    const im = Number(m[2]);
    if (!Number.isFinite(re) || !Number.isFinite(im)) continue;
    out.push({ real: re, imag: im }, { real: re, imag: -im });
    used.add(m[0]);
  }
  const rest = text
    .replace(pair, ' ')
    .split(/[\s,;]+/)
    .filter(Boolean);
  for (const tok of rest) {
    const v = Number(tok.replace(/j$/i, ''));
    if (Number.isFinite(v)) out.push({ real: v, imag: 0 });
  }
  return out;
}

/** Companion-form Ackermann placement for SISO (A,B) → K such that eig(A−BK)=poles. */
export function placePolesSiso(A: number[][], B: number[][], poles: { real: number; imag: number }[]): PolePlacementResult {
  const n = A.length;
  if (n === 0) throw new Error('Empty plant');
  if (controllabilityRank(A, B) < n) throw new Error('Plant is not fully controllable — cannot place poles.');
  if (poles.length < n) throw new Error(`Need ${n} closed-loop poles (got ${poles.length}).`);
  const desired = poles.slice(0, n);

  // Controllability matrix C = [B AB … A^{n-1}B]
  const ctrb = zeros(n);
  let col = B.map((row) => row[0] ?? 0);
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < n; i++) ctrb[i][k] = col[i];
    col = matVec(A, col);
  }
  const ctrbInv = (() => {
    const I = zeros(n);
    for (let i = 0; i < n; i++) I[i][i] = 1;
    const cols: number[][] = [];
    for (let j = 0; j < n; j++) {
      const x = solve(ctrb, I.map((row) => row[j]));
      if (!x) throw new Error('Controllability matrix is singular.');
      cols.push(x);
    }
    const out = zeros(n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) out[i][j] = cols[j][i];
    return out;
  })();

  // Desired characteristic polynomial coeffs for ∏(s−p) = s^n + a_{n-1}s^{n-1}+…+a0
  // Build via successive multiplication for real coeffs (complex pairs conjugate).
  let poly = [1]; // highest power first
  for (const p of desired) {
    // (s - (re+jim)) factor; for imag≠0 we expect conjugate already listed — multiply linear if imag=0 else quadratic once
    if (Math.abs(p.imag) < 1e-10) {
      poly = mulPoly(poly, [1, -p.real]);
    } else if (p.imag > 0) {
      // s^2 - 2re s + (re^2+im^2)
      poly = mulPoly(poly, [1, -2 * p.real, p.real * p.real + p.imag * p.imag]);
    }
  }
  while (poly.length < n + 1) poly.push(0);
  if (poly.length > n + 1) poly = poly.slice(0, n + 1);
  // poly = [1, α_{n-1}, …, α0]
  const alpha = poly.slice(1); // length n

  // Open-loop char poly via Leverrier or eigen — use coefficients from charpoly via Leverrier
  const aOpen = charPolyCoeffs(A); // [1, a_{n-1}, …, a0]
  const a = aOpen.slice(1);

  // τ^T = e_n^T * C^{-1}
  const en = new Array(n).fill(0);
  en[n - 1] = 1;
  const tau = matVec(ctrbInv, en); // actually need en^T * inv = row; use inv^T * en
  // ctrbInv is C^{-1}; want last row of C^{-1}: e_n^T C^{-1}
  const tauRow = new Array(n).fill(0);
  for (let j = 0; j < n; j++) tauRow[j] = ctrbInv[n - 1][j];

  // K = (α - a)^T * Φ where Φ stacks tau, tau A, …
  // Classic Ackermann: K = e_n^T C^{-1} φ(A) with φ desired char poly.
  let phi = zeros(n); // will accumulate as matrix
  // φ(A) = A^n + α_{n-1} A^{n-1} + … + α0 I
  let Apow = eye(n);
  let phiM = scaleMat(Apow, poly[n] ?? 0); // α0 * I — poly highest first: poly[n]=a0
  // Actually poly = [1, α_{n-1}, ..., α0], so A^n + α_{n-1}A^{n-1}+...+α0 I
  phiM = zeros(n);
  Apow = eye(n);
  for (let k = n; k >= 0; k--) {
    const coef = poly[n - k] ?? 0; // for k=n → A^n coef 1 = poly[0]
    // iterate differently:
  }
  // Rebuild φ(A)
  phiM = zeros(n);
  Apow = eye(n);
  for (let pwr = 0; pwr <= n; pwr++) {
    const coef = poly[n - pwr]; // pwr=0 → α0 = poly[n]
    phiM = addMat(phiM, scaleMat(Apow, coef));
    if (pwr < n) Apow = mulMat(Apow, A);
  }
  // K = e_n^T C^{-1} φ(A)
  const row = new Array(n).fill(0);
  for (let j = 0; j < n; j++) {
    let s = 0;
    for (let k = 0; k < n; k++) s += ctrbInv[n - 1][k] * phiM[k][j];
    row[j] = s;
  }
  void a;
  void tau;
  void tauRow;
  void alpha;

  const Acl = clone(A);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) Acl[i][j] -= (B[i]?.[0] ?? 0) * row[j];
  const polesClosed = eigenvalues(Acl);
  return {
    K: row,
    polesDesired: desired,
    polesClosed,
    note: 'Ackermann pole placement (SISO). Wrote state-feedback gains for roles k0…',
  };
}

function eye(n: number): number[][] {
  const I = zeros(n);
  for (let i = 0; i < n; i++) I[i][i] = 1;
  return I;
}
function mulMat(A: number[][], B: number[][]): number[][] {
  const n = A.length;
  const m = B[0].length;
  const p = B.length;
  const C = zeros(n, m);
  for (let i = 0; i < n; i++) for (let k = 0; k < p; k++) for (let j = 0; j < m; j++) C[i][j] += A[i][k] * B[k][j];
  return C;
}
function addMat(A: number[][], B: number[][]): number[][] {
  return A.map((row, i) => row.map((v, j) => v + B[i][j]));
}
function scaleMat(A: number[][], s: number): number[][] {
  return A.map((row) => row.map((v) => v * s));
}
function mulPoly(a: number[], b: number[]): number[] {
  const out = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
  return out;
}
function charPolyCoeffs(A: number[][]): number[] {
  // Leverrier algorithm → [1, c_{n-1}, …, c0] for det(sI−A)=s^n+c_{n-1}s^{n-1}+…+c0
  const n = A.length;
  let Ak = eye(n);
  const coeffs = [1];
  let M = eye(n);
  for (let k = 1; k <= n; k++) {
    Ak = mulMat(A, M);
    let tr = 0;
    for (let i = 0; i < n; i++) tr += Ak[i][i];
    const ck = -tr / k;
    coeffs.push(ck);
    M = addMat(Ak, scaleMat(eye(n), ck));
  }
  return coeffs;
}

/**
 * IMC / lambda-tuned PID for a plant linearized about an operating point.
 * Fits a second-order or FOPDT-ish response from A,B,C and returns parallel PID gains.
 */
export function tunePidImc(
  blockType: string,
  parameters: Record<string, Param>,
  opts: { x0?: number[]; u0?: number[]; lambda?: number } = {}
): PidGains {
  const { A, B } = linearizeBlock(blockType, parameters, opts.x0, opts.u0);
  const B1 = B.map((row) => [row[0] ?? 0]);
  // DC gain of C(sI−A)^{-1}B with C=[1 0 …] (first state as output proxy)
  const n = A.length;
  const C = new Array(n).fill(0);
  C[0] = 1;
  // Kdc ≈ -C A^{-1} B
  const AinvB = solve(A, B1.map((r) => r[0]));
  if (!AinvB) throw new Error('Plant is singular at the operating point — cannot tune PID.');
  const Kdc = -C.reduce((s, c, i) => s + c * AinvB[i], 0);
  if (!(Math.abs(Kdc) > 1e-9)) throw new Error('Plant DC gain is ~0 — pick another output/state.');

  // Dominant time constant from slowest stable pole
  const poles = eigenvalues(A);
  const stable = poles.filter((p) => p.real < 0);
  const tau = stable.length
    ? Math.max(...stable.map((p) => 1 / Math.max(1e-6, -p.real)))
    : 1;
  const lambda = Math.max(opts.lambda ?? 0.3 * tau, 0.05 * tau, 1e-3);
  // IMC series PI for first-order: Kc = τ/(Kdc λ), τi = τ → parallel Kp=Kc, Ki=Kc/τi
  const Kc = tau / (Kdc * lambda);
  const Kp = Kc;
  const Ki = Kc / tau;
  const Kd = 0.05 * Kc * tau;
  return {
    Kp,
    Ki,
    Kd,
    Tf: Math.max(0.02, 0.1 * lambda),
    note: `IMC-ish PID from DC gain=${Kdc.toFixed(3)}, τ≈${tau.toFixed(3)}, λ=${lambda.toFixed(3)}.`,
  };
}

/** Ziegler–Nichols from ultimate gain via relay-ish: scale K until A−kBC marginally stable (SISO). */
export function tunePidZn(
  blockType: string,
  parameters: Record<string, Param>,
  opts: { x0?: number[]; u0?: number[] } = {}
): PidGains {
  const { A, B } = linearizeBlock(blockType, parameters, opts.x0, opts.u0);
  const n = A.length;
  const C = new Array(n).fill(0);
  C[0] = 1;
  let Ku = 0;
  let wu = 1;
  for (let k = 0.01; k < 500; k *= 1.15) {
    const Acl = clone(A);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) Acl[i][j] -= (B[i]?.[0] ?? 0) * k * C[j];
    const poles = eigenvalues(Acl);
    const crossed = poles.some((p) => p.real > -1e-3 && Math.abs(p.imag) > 1e-3);
    const unstable = poles.some((p) => p.real > 1e-3);
    if (crossed || unstable) {
      Ku = k;
      const osc = poles.filter((p) => Math.abs(p.imag) > 1e-3).sort((a, b) => Math.abs(b.imag) - Math.abs(a.imag))[0];
      wu = osc ? Math.abs(osc.imag) : 1;
      break;
    }
  }
  if (!(Ku > 0)) throw new Error('Could not find an ultimate gain — try IMC tune instead.');
  const Pu = (2 * Math.PI) / Math.max(1e-6, wu);
  // Classic ZN PID
  const Kp = 0.6 * Ku;
  const Ki = (1.2 * Ku) / Pu;
  const Kd = (0.075 * Ku * Pu);
  return {
    Kp,
    Ki,
    Kd,
    Tf: Math.max(0.02, 0.05 * Pu),
    note: `Ziegler–Nichols PID from Ku≈${Ku.toFixed(3)}, Pu≈${Pu.toFixed(3)} s.`,
  };
}
