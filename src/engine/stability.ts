import { eigenvalues, Eigenvalue, spectralAbscissa } from './eig';
import { formatPole } from './lqr';
import { clone, matVec, rank, zeros } from './linalg';
import { AnalysisOption } from './types';

export type { AnalysisOption };

export const ALL_ANALYSIS_OPTIONS: { id: AnalysisOption; label: string; help: string }[] = [
  { id: 'poles', label: 'Eigenvalues', help: 'Open- and closed-loop poles' },
  { id: 'ctrb', label: 'Controllability', help: 'Controllability matrix rank' },
  { id: 'damping', label: 'Damping & ωₙ', help: 'ζ and natural frequency of complex poles' },
  { id: 'margins', label: 'Gain / phase margins', help: 'SISO margins of L(s)=K(sI−A)⁻¹B' },
  { id: 'polemap', label: 'Pole map', help: 's-plane sketch of open vs closed poles' },
  { id: 'bode', label: 'Bode plot', help: '|L| and ∠L vs frequency' },
  { id: 'nyquist', label: 'Nyquist plot', help: 'Im(L) vs Re(L) with −1 point' },
  { id: 'nichols', label: 'Nichols chart', help: '|L| dB vs phase' },
  { id: 'rlocus', label: 'Root locus', help: 'Closed-loop poles as gain ρ scales K' },
];

export interface FreqPoint {
  w: number;
  re: number;
  im: number;
  mag: number;
  magDb: number;
  phaseDeg: number;
}

export interface RootLocusBranch {
  /** Pole index tracked across gain samples. */
  points: { rho: number; real: number; imag: number }[];
}

export interface PoleMode {
  real: number;
  imag: number;
  wn: number;
  zeta: number;
  label: string;
}

export interface MarginResult {
  gainMarginDb: number | null;
  phaseMarginDeg: number | null;
  gainCrossoverRad: number | null;
  phaseCrossoverRad: number | null;
  note: string;
}

export interface StabilityReport {
  n: number;
  polesOpen: Eigenvalue[];
  polesClosed: Eigenvalue[];
  openStable: boolean;
  closedStable: boolean;
  spectralAbscissaOpen: number;
  spectralAbscissaClosed: number;
  settlingEstimate: number | null;
  controllable: boolean;
  controllabilityRank: number;
  modes: PoleMode[];
  margins: MarginResult | null;
  freq: FreqPoint[];
  rootLocus: RootLocusBranch[];
  summary: string[];
}

function closedLoop(A: number[][], B: number[][], K: number[]): number[][] {
  const Acl = clone(A);
  for (let i = 0; i < A.length; i++) {
    for (let j = 0; j < A.length; j++) Acl[i][j] -= (B[i]?.[0] ?? 0) * (K[j] ?? 0);
  }
  return Acl;
}

export function controllabilityRank(A: number[][], B: number[][]): number {
  const n = A.length;
  const cols: number[][] = [];
  let col = B.map((row) => row[0] ?? 0);
  for (let k = 0; k < n; k++) {
    cols.push(col);
    col = matVec(A, col);
  }
  const C = zeros(n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) C[i][j] = cols[j][i];
  }
  return rank(C, 1e-7);
}

function poleModes(poles: Eigenvalue[]): PoleMode[] {
  const modes: PoleMode[] = [];
  const used = new Set<number>();
  for (let i = 0; i < poles.length; i++) {
    if (used.has(i)) continue;
    const p = poles[i];
    if (Math.abs(p.imag) < 1e-8) {
      used.add(i);
      const wn = Math.abs(p.real);
      modes.push({
        real: p.real,
        imag: 0,
        wn,
        zeta: p.real < 0 ? 1 : p.real > 0 ? -1 : 0,
        label: formatPole(p),
      });
      continue;
    }
    let pair = -1;
    for (let j = i + 1; j < poles.length; j++) {
      if (used.has(j)) continue;
      if (Math.abs(poles[j].real - p.real) < 1e-5 && Math.abs(poles[j].imag + p.imag) < 1e-5) {
        pair = j;
        break;
      }
    }
    used.add(i);
    if (pair >= 0) used.add(pair);
    const wn = Math.hypot(p.real, p.imag);
    const zeta = wn > 1e-12 ? -p.real / wn : 0;
    modes.push({
      real: p.real,
      imag: Math.abs(p.imag),
      wn,
      zeta,
      label: formatPole({ real: p.real, imag: Math.abs(p.imag) }),
    });
  }
  return modes.sort((a, b) => b.real - a.real);
}

/** Evaluate L(jw) = K (jw I − A)⁻¹ B for state-feedback return ratio. */
export function loopResponse(A: number[][], B: number[][], K: number[], w: number): { re: number; im: number } | null {
  const n = A.length;
  // (jwI − A)(xRe + j xIm) = B  ⇒
  // [ -A, -wI ] [xRe] = [B]
  // [  wI, -A ] [xIm]   [0]
  const R = zeros(2 * n);
  const rhs = new Array(2 * n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      R[i][j] = -A[i][j];
      R[i][n + j] = i === j ? -w : 0;
      R[n + i][j] = i === j ? w : 0;
      R[n + i][n + j] = -A[i][j];
    }
    rhs[i] = B[i]?.[0] ?? 0;
  }
  const Aug = R.map((row, i) => [...row, rhs[i]]);
  const m = 2 * n;
  for (let k = 0; k < m; k++) {
    let piv = k;
    for (let i = k + 1; i < m; i++) if (Math.abs(Aug[i][k]) > Math.abs(Aug[piv][k])) piv = i;
    if (Math.abs(Aug[piv][k]) < 1e-14) return null;
    if (piv !== k) {
      const tmp = Aug[k];
      Aug[k] = Aug[piv];
      Aug[piv] = tmp;
    }
    const diag = Aug[k][k];
    for (let j = k; j <= m; j++) Aug[k][j] /= diag;
    for (let i = 0; i < m; i++) {
      if (i === k) continue;
      const f = Aug[i][k];
      for (let j = k; j <= m; j++) Aug[i][j] -= f * Aug[k][j];
    }
  }
  let re = 0;
  let im = 0;
  for (let i = 0; i < n; i++) {
    re += (K[i] ?? 0) * Aug[i][m];
    im += (K[i] ?? 0) * Aug[n + i][m];
  }
  return { re, im };
}

export function logspace(wMin: number, wMax: number, n: number): number[] {
  const a = Math.log10(wMin);
  const b = Math.log10(wMax);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(Math.pow(10, a + ((b - a) * i) / Math.max(1, n - 1)));
  return out;
}

export function closedLoopMatrix(A: number[][], B: number[][], K: number[]): number[][] {
  return closedLoop(A, B, K);
}

/** Frequency response of return ratio L(jw)=K(jwI−A)⁻¹B with unwrapped phase. */
export function frequencyResponse(A: number[][], B: number[][], K: number[], n = 160): FreqPoint[] {
  if (!K.some((v) => Math.abs(v) > 1e-12)) return [];
  const ws = logspace(1e-3, 1e3, n);
  const points: FreqPoint[] = [];
  let prevPhase: number | null = null;
  for (const w of ws) {
    const L = loopResponse(A, B, K, w);
    if (!L) continue;
    const mag = Math.hypot(L.re, L.im);
    let phaseDeg = (Math.atan2(L.im, L.re) * 180) / Math.PI;
    if (prevPhase != null) {
      while (phaseDeg - prevPhase > 180) phaseDeg -= 360;
      while (phaseDeg - prevPhase < -180) phaseDeg += 360;
    }
    prevPhase = phaseDeg;
    points.push({
      w,
      re: L.re,
      im: L.im,
      mag,
      magDb: mag > 1e-16 ? 20 * Math.log10(mag) : -320,
      phaseDeg,
    });
  }
  return points;
}

export function loopMargins(A: number[][], B: number[][], K: number[], freq?: FreqPoint[]): MarginResult {
  if (!K.some((v) => Math.abs(v) > 1e-12)) {
    return {
      gainMarginDb: null,
      phaseMarginDeg: null,
      gainCrossoverRad: null,
      phaseCrossoverRad: null,
      note: 'No feedback gain — margins undefined.',
    };
  }
  const points = freq ?? frequencyResponse(A, B, K, 200);
  let gainCrossover: number | null = null;
  let phaseMargin: number | null = null;
  let phaseCrossover: number | null = null;
  let gainMarginDb: number | null = null;
  let prev: FreqPoint | null = null;

  for (const p of points) {
    if (prev) {
      if ((prev.mag - 1) * (p.mag - 1) <= 0 && prev.mag !== p.mag) {
        const t = (1 - prev.mag) / (p.mag - prev.mag);
        gainCrossover = prev.w + t * (p.w - prev.w);
        const ph = prev.phaseDeg + t * (p.phaseDeg - prev.phaseDeg);
        phaseMargin = 180 + ph;
      }
      const p0 = prev.phaseDeg;
      const p1 = p.phaseDeg;
      if ((p0 + 180) * (p1 + 180) <= 0 && Math.abs(p1 - p0) < 120) {
        const t = (-180 - p0) / (p1 - p0 || 1e-12);
        const magCross = prev.mag + t * (p.mag - prev.mag);
        if (magCross > 1e-12) {
          phaseCrossover = prev.w + t * (p.w - prev.w);
          gainMarginDb = -20 * Math.log10(magCross);
        }
      }
    }
    prev = p;
  }

  return {
    gainMarginDb,
    phaseMarginDeg: phaseMargin,
    gainCrossoverRad: gainCrossover,
    phaseCrossoverRad: phaseCrossover,
    note:
      gainCrossover == null && phaseCrossover == null
        ? 'No crossover found in 10⁻³…10³ rad/s — widen bandwidth or check gains.'
        : 'Margins from frequency sweep of return ratio L(jw)=K(jwI−A)⁻¹B.',
  };
}

/** Root locus of A − ρ B K for ρ ∈ [0, ρMax]. */
export function rootLocus(A: number[][], B: number[][], K: number[], samples = 48, rhoMax = 3): RootLocusBranch[] {
  const n = A.length;
  if (!n || !K.some((v) => Math.abs(v) > 1e-12)) {
    return eigenvalues(A).map((p) => ({ points: [{ rho: 0, real: p.real, imag: p.imag }] }));
  }
  const branches: RootLocusBranch[] = Array.from({ length: n }, () => ({ points: [] }));
  let prev: Eigenvalue[] | null = null;
  for (let s = 0; s < samples; s++) {
    const rho = (rhoMax * s) / Math.max(1, samples - 1);
    const Acl = closedLoop(A, B, K.map((v) => v * rho));
    let poles = eigenvalues(Acl);
    if (prev) {
      // Greedy match to keep branch continuity
      const used = new Set<number>();
      const ordered: Eigenvalue[] = [];
      for (const p of prev) {
        let best = -1;
        let bestD = Infinity;
        for (let i = 0; i < poles.length; i++) {
          if (used.has(i)) continue;
          const d = Math.hypot(poles[i].real - p.real, poles[i].imag - p.imag);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
        if (best >= 0) {
          used.add(best);
          ordered.push(poles[best]);
        }
      }
      for (let i = 0; i < poles.length; i++) if (!used.has(i)) ordered.push(poles[i]);
      poles = ordered.slice(0, n);
    }
    prev = poles;
    for (let i = 0; i < n; i++) {
      const p = poles[i] ?? { real: 0, imag: 0 };
      branches[i].points.push({ rho, real: p.real, imag: p.imag });
    }
  }
  return branches;
}

export function analyzeStability(
  A: number[][],
  B: number[][],
  K: number[],
  options: AnalysisOption[] = ALL_ANALYSIS_OPTIONS.map((o) => o.id)
): StabilityReport {
  const want = new Set(options);
  const polesOpen = eigenvalues(A);
  const Acl = closedLoop(A, B, K);
  const polesClosed = eigenvalues(Acl);
  const openStable = polesOpen.every((e) => e.real < -1e-7);
  const closedStable = polesClosed.every((e) => e.real < -1e-7);
  const spectralAbscissaOpen = spectralAbscissa(A);
  const spectralAbscissaClosed = spectralAbscissa(Acl);
  const ctrbRank = want.has('ctrb') || want.has('poles') ? controllabilityRank(A, B) : 0;
  const controllable = ctrbRank >= A.length;
  const modes = want.has('damping') ? poleModes(polesClosed) : [];
  const needFreq = want.has('margins') || want.has('bode') || want.has('nyquist') || want.has('nichols');
  const freq = needFreq ? frequencyResponse(A, B, K) : [];
  const margins = want.has('margins') ? loopMargins(A, B, K, freq) : null;
  const locus = want.has('rlocus') ? rootLocus(A, B, K) : [];
  const sigma = -spectralAbscissaClosed;
  const settlingEstimate = closedStable && sigma > 1e-6 ? 4 / sigma : null;

  const summary: string[] = [];
  summary.push(openStable ? 'Open loop: asymptotically stable' : 'Open loop: unstable (or marginally stable)');
  summary.push(closedStable ? 'Closed loop: asymptotically stable' : 'Closed loop: unstable (or marginally stable)');
  summary.push(`Spectral abscissa α_cl = ${spectralAbscissaClosed.toFixed(4)} (need α < 0)`);
  if (settlingEstimate != null) summary.push(`≈4/|α| settling ~ ${settlingEstimate.toFixed(2)} s`);
  if (want.has('ctrb')) summary.push(controllable ? `Controllable (rank ${ctrbRank}/${A.length})` : `Not fully controllable (rank ${ctrbRank}/${A.length})`);
  if (margins) {
    const gm = margins.gainMarginDb == null ? '—' : `${margins.gainMarginDb.toFixed(1)} dB`;
    const pm = margins.phaseMarginDeg == null ? '—' : `${margins.phaseMarginDeg.toFixed(1)}°`;
    summary.push(`Margins: GM ${gm}, PM ${pm}`);
  }
  if (freq.length) summary.push(`Frequency response: ${freq.length} points`);
  if (locus.length) summary.push(`Root locus: ${locus.length} branches`);

  return {
    n: A.length,
    polesOpen,
    polesClosed,
    openStable,
    closedStable,
    spectralAbscissaOpen,
    spectralAbscissaClosed,
    settlingEstimate,
    controllable,
    controllabilityRank: ctrbRank,
    modes,
    margins,
    freq,
    rootLocus: locus,
    summary,
  };
}

/** Parse space/comma-separated numbers; pad/truncate to n. */
export function parseVector(raw: string, n: number, fill = 0): number[] {
  const parts = String(raw ?? '')
    .trim()
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map(Number);
  const out = new Array(n).fill(fill);
  for (let i = 0; i < n; i++) {
    const v = parts[i];
    out[i] = Number.isFinite(v) ? v : fill;
  }
  return out;
}

export function formatVector(values: number[]): string {
  return values
    .map((v) => {
      if (!Number.isFinite(v)) return '0';
      const abs = Math.abs(v);
      if (abs !== 0 && (abs < 1e-3 || abs >= 1e4)) return v.toExponential(3);
      return String(Number(v.toPrecision(6)));
    })
    .join(' ');
}
