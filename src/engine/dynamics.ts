/** Shared helpers for multi-domain dynamics blocks. */

export function clampPositive(value: number, floor = 1e-9): number {
  return Number.isFinite(value) && value > floor ? value : floor;
}

/** Dense n×n solve Mx = b. M is row-major and overwritten. */
export function solveDense(M: Float64Array, n: number, b: Float64Array, x: Float64Array): boolean {
  for (let k = 0; k < n; k++) {
    let piv = k;
    let max = Math.abs(M[k * n + k]);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(M[i * n + k]);
      if (v > max) {
        max = v;
        piv = i;
      }
    }
    if (max < 1e-14) return false;
    if (piv !== k) {
      for (let j = k; j < n; j++) {
        const tmp = M[k * n + j];
        M[k * n + j] = M[piv * n + j];
        M[piv * n + j] = tmp;
      }
      const tb = b[k];
      b[k] = b[piv];
      b[piv] = tb;
    }
    const diag = M[k * n + k];
    for (let i = k + 1; i < n; i++) {
      const f = M[i * n + k] / diag;
      M[i * n + k] = 0;
      for (let j = k + 1; j < n; j++) M[i * n + j] -= f * M[k * n + j];
      b[i] -= f * b[k];
    }
  }
  for (let k = n - 1; k >= 0; k--) {
    let s = b[k];
    for (let j = k + 1; j < n; j++) s -= M[k * n + j] * x[j];
    x[k] = s / M[k * n + k];
  }
  return true;
}

export function parseAssignments(source: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of source.split(/[;\n]+/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = Number(trimmed.slice(eq + 1).trim());
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && Number.isFinite(value)) out[key] = value;
  }
  return out;
}
