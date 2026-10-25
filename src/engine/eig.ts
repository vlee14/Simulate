export interface Eigenvalue {
  real: number;
  imag: number;
}

function clone(A: number[][]): number[][] {
  return A.map((row) => row.slice());
}

/** Reduce A to upper Hessenberg form in place with Householder reflectors. */
function hessenberg(A: number[][]): void {
  const n = A.length;
  for (let k = 0; k < n - 2; k++) {
    let norm = 0;
    for (let i = k + 1; i < n; i++) norm += A[i][k] * A[i][k];
    norm = Math.sqrt(norm);
    if (norm < 1e-18) continue;
    const alpha = A[k + 1][k];
    const v: number[] = [];
    for (let i = k + 1; i < n; i++) v.push(A[i][k]);
    v[0] = alpha + (alpha >= 0 ? norm : -norm);
    let vnorm = 0;
    for (const vi of v) vnorm += vi * vi;
    if (vnorm < 1e-30) continue;
    const beta = 2 / vnorm;
    const len = v.length;
    for (let j = k; j < n; j++) {
      let tau = 0;
      for (let i = 0; i < len; i++) tau += v[i] * A[k + 1 + i][j];
      tau *= beta;
      for (let i = 0; i < len; i++) A[k + 1 + i][j] -= tau * v[i];
    }
    for (let i = 0; i < n; i++) {
      let tau = 0;
      for (let j = 0; j < len; j++) tau += A[i][k + 1 + j] * v[j];
      tau *= beta;
      for (let j = 0; j < len; j++) A[i][k + 1 + j] -= tau * v[j];
    }
  }
}

/** One explicit shifted QR step on the leading m×m Hessenberg block. */
function qrStep(H: number[][], m: number, shift: number): void {
  for (let i = 0; i < m; i++) H[i][i] -= shift;
  const cs = new Array<number>(Math.max(0, m - 1));
  const sn = new Array<number>(Math.max(0, m - 1));
  for (let k = 0; k < m - 1; k++) {
    const a = H[k][k];
    const b = H[k + 1][k];
    const r = Math.hypot(a, b) || 1e-30;
    const c = a / r;
    const s = b / r;
    cs[k] = c;
    sn[k] = s;
    for (let j = k; j < m; j++) {
      const h0 = H[k][j];
      const h1 = H[k + 1][j];
      H[k][j] = c * h0 + s * h1;
      H[k + 1][j] = -s * h0 + c * h1;
    }
    H[k + 1][k] = 0;
  }
  for (let k = 0; k < m - 1; k++) {
    const c = cs[k];
    const s = sn[k];
    for (let i = 0; i < m; i++) {
      const h0 = H[i][k];
      const h1 = H[i][k + 1];
      H[i][k] = c * h0 + s * h1;
      H[i][k + 1] = -s * h0 + c * h1;
    }
  }
  for (let i = 0; i < m; i++) H[i][i] += shift;
}

function wilkinson(H: number[][], m: number): number {
  const a = H[m - 2][m - 2];
  const b = H[m - 2][m - 1];
  const c = H[m - 1][m - 2];
  const d = H[m - 1][m - 1];
  const tr = a + d;
  const det = a * d - b * c;
  const disc = (tr * tr) / 4 - det;
  if (disc <= 0) return tr / 2;
  const root = Math.sqrt(disc);
  const e1 = tr / 2 + root;
  const e2 = tr / 2 - root;
  return Math.abs(e1 - d) < Math.abs(e2 - d) ? e1 : e2;
}

function quad(a: number, b: number, c: number, d: number): Eigenvalue[] {
  const tr = a + d;
  const det = a * d - b * c;
  const disc = tr * tr - 4 * det;
  if (disc >= 0) {
    const s = Math.sqrt(disc);
    return [
      { real: (tr + s) / 2, imag: 0 },
      { real: (tr - s) / 2, imag: 0 },
    ];
  }
  return [
    { real: tr / 2, imag: Math.sqrt(-disc) / 2 },
    { real: tr / 2, imag: -Math.sqrt(-disc) / 2 },
  ];
}

/** Eigenvalues of a small real matrix (QR with Wilkinson shift). */
export function eigenvalues(Ain: number[][]): Eigenvalue[] {
  const n = Ain.length;
  if (n === 0) return [];
  if (n === 1) return [{ real: Ain[0][0], imag: 0 }];
  const H = clone(Ain);
  hessenberg(H);
  const found: Eigenvalue[] = [];
  let m = n;
  let guard = 0;
  const limit = 80 * n * n + 200;
  while (m > 0 && guard < limit) {
    guard++;
    if (m === 1) {
      found.push({ real: H[0][0], imag: 0 });
      break;
    }
    for (let i = 1; i < m; i++) {
      const scale = Math.abs(H[i][i]) + Math.abs(H[i - 1][i - 1]) + 1e-15;
      if (Math.abs(H[i][i - 1]) <= 1e-12 * scale) H[i][i - 1] = 0;
    }
    if (H[m - 1][m - 2] === 0) {
      found.push({ real: H[m - 1][m - 1], imag: 0 });
      m--;
      continue;
    }
    if (m === 2 || H[m - 2][m - 3] === 0) {
      found.push(
        ...quad(H[m - 2][m - 2], H[m - 2][m - 1], H[m - 1][m - 2], H[m - 1][m - 1])
      );
      m -= 2;
      continue;
    }
    const shift = guard % 20 === 0 ? H[m - 1][m - 1] + ((guard / 20) % 2 === 0 ? 0.05 : -0.05) : wilkinson(H, m);
    qrStep(H, m, shift);
  }
  return found;
}

export function spectralAbscissa(A: number[][]): number {
  const ev = eigenvalues(A);
  let max = -Infinity;
  for (const e of ev) if (e.real > max) max = e.real;
  return max;
}

export function isHurwitz(A: number[][], tol = 1e-7): boolean {
  const ev = eigenvalues(A);
  return ev.length === A.length && ev.every((e) => e.real < -tol);
}
