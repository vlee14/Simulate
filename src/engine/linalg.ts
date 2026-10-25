export function zeros(rows: number, cols = rows): number[][] {
  return Array.from({ length: rows }, () => new Array(cols).fill(0));
}

export function eye(n: number): number[][] {
  const A = zeros(n);
  for (let i = 0; i < n; i++) A[i][i] = 1;
  return A;
}

export function clone(A: number[][]): number[][] {
  return A.map((row) => row.slice());
}

export function transpose(A: number[][]): number[][] {
  const rows = A.length;
  const cols = A[0]?.length ?? 0;
  const B = zeros(cols, rows);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) B[j][i] = A[i][j];
  }
  return B;
}

export function mul(A: number[][], B: number[][]): number[][] {
  const n = A.length;
  const m = B[0]?.length ?? 0;
  const p = B.length;
  const C = zeros(n, m);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < p; k++) {
      const aik = A[i][k];
      if (aik === 0) continue;
      for (let j = 0; j < m; j++) C[i][j] += aik * B[k][j];
    }
  }
  return C;
}

export function add(A: number[][], B: number[][]): number[][] {
  return A.map((row, i) => row.map((v, j) => v + B[i][j]));
}

export function scale(A: number[][], s: number): number[][] {
  return A.map((row) => row.map((v) => v * s));
}

export function infNorm(A: number[][]): number {
  let m = 0;
  for (const row of A) {
    let s = 0;
    for (const v of row) s += Math.abs(v);
    if (s > m) m = s;
  }
  return m;
}

/** Solve A x = b. Returns null if A is singular. */
export function solve(Ain: number[][], bin: number[]): number[] | null {
  const n = Ain.length;
  const A = Ain.map((row, i) => row.slice(0, n).concat(bin[i]));
  for (let k = 0; k < n; k++) {
    let piv = k;
    let max = Math.abs(A[k][k]);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(A[i][k]);
      if (v > max) {
        max = v;
        piv = i;
      }
    }
    if (max < 1e-14) return null;
    if (piv !== k) {
      const tmp = A[k];
      A[k] = A[piv];
      A[piv] = tmp;
    }
    const diag = A[k][k];
    for (let j = k; j <= n; j++) A[k][j] /= diag;
    for (let i = 0; i < n; i++) {
      if (i === k) continue;
      const f = A[i][k];
      if (f === 0) continue;
      for (let j = k; j <= n; j++) A[i][j] -= f * A[k][j];
    }
  }
  return A.map((row) => row[n]);
}

export function invert(A: number[][]): number[][] | null {
  const n = A.length;
  const I = eye(n);
  const cols: number[][] = [];
  for (let j = 0; j < n; j++) {
    const x = solve(A, I.map((row) => row[j]));
    if (!x) return null;
    cols.push(x);
  }
  const B = zeros(n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) B[i][j] = cols[j][i];
  }
  return B;
}

export function matVec(A: number[][], x: number[]): number[] {
  return A.map((row) => row.reduce((s, v, j) => s + v * x[j], 0));
}

export function rank(Ain: number[][], tol = 1e-8): number {
  if (Ain.length === 0) return 0;
  const A = Ain.map((row) => row.slice());
  const rows = A.length;
  const cols = A[0].length;
  let r = 0;
  for (let c = 0; c < cols && r < rows; c++) {
    let piv = r;
    for (let i = r + 1; i < rows; i++) {
      if (Math.abs(A[i][c]) > Math.abs(A[piv][c])) piv = i;
    }
    if (Math.abs(A[piv][c]) < tol) continue;
    if (piv !== r) {
      const tmp = A[r];
      A[r] = A[piv];
      A[piv] = tmp;
    }
    const div = A[r][c];
    for (let j = c; j < cols; j++) A[r][j] /= div;
    for (let i = 0; i < rows; i++) {
      if (i === r) continue;
      const f = A[i][c];
      for (let j = c; j < cols; j++) A[i][j] -= f * A[r][j];
    }
    r++;
  }
  return r;
}

/** Matrix exponential via scaling and a Taylor polynomial. Fine for small dense matrices. */
export function expm(A: number[][]): number[][] {
  const n = A.length;
  let s = 0;
  let M = clone(A);
  let norm = infNorm(M);
  while (norm > 0.5 && s < 24) {
    M = scale(M, 0.5);
    norm *= 0.5;
    s++;
  }
  let term = eye(n);
  let sum = eye(n);
  for (let k = 1; k <= 18; k++) {
    term = scale(mul(term, M), 1 / k);
    sum = add(sum, term);
  }
  for (let i = 0; i < s; i++) sum = mul(sum, sum);
  return sum;
}

/** Zero-order-hold discretization via Van Loan's expm identity. */
export function c2d(A: number[][], B: number[][], Ts: number): { Ad: number[][]; Bd: number[][] } {
  const n = A.length;
  const m = B[0]?.length ?? 1;
  const M = zeros(n + m);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) M[i][j] = A[i][j] * Ts;
    for (let j = 0; j < m; j++) M[i][n + j] = B[i][j] * Ts;
  }
  const E = expm(M);
  const Ad = zeros(n);
  const Bd = zeros(n, m);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) Ad[i][j] = E[i][j];
    for (let j = 0; j < m; j++) Bd[i][j] = E[i][n + j];
  }
  return { Ad, Bd };
}

/**
 * Solve Aᵀ P + P A = −Q for P.
 * Returns null if the Lyapunov operator is singular (A has poles mirroring across the imaginary axis).
 */
export function lyapunov(A: number[][], Q: number[][]): number[][] | null {
  const n = A.length;
  const N = n * n;
  const AT = transpose(A);
  const M = zeros(N);
  const rhs = new Array(N).fill(0);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const row = i + j * n;
      rhs[row] = -Q[i][j];
      for (let c = 0; c < n; c++) {
        M[row][c + j * n] += AT[i][c];
        M[row][i + c * n] += A[c][j];
      }
    }
  }
  const vec = solve(M, rhs);
  if (!vec) return null;
  const P = zeros(n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) P[i][j] = vec[i + j * n];
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const v = 0.5 * (P[i][j] + P[j][i]);
      P[i][j] = v;
      P[j][i] = v;
    }
  }
  return P;
}
