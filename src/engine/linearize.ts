import { getBlock } from './blocks';
import { compileExpression, splitExpressions } from './expr';
import { BlockContext, BlockDefinition, Param } from './types';

export type LinearizeMethod = 'analytical' | 'supplied' | 'fd';

export type LinearizeResult = {
  A: number[][];
  B: number[][];
  method: LinearizeMethod;
};

export type LinearizeArgs = {
  parameters: Record<string, Param>;
  x0: number[];
  u0: number[];
  t: number;
};

function text(p: Record<string, Param>, key: string, fallback = ''): string {
  const v = p[key];
  return v === undefined ? fallback : String(v);
}

/** Parse a matrix whose entries may be numeric literals or expressions in `vars`. */
export function parseMatrixExpressions(
  source: string,
  vars: Record<string, number>,
  rows: number,
  cols: number
): number[][] {
  const rowParts = String(source ?? '')
    .split(';')
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
  if (rowParts.length !== rows) {
    throw new Error(`Expected ${rows} matrix rows, got ${rowParts.length}`);
  }
  const out: number[][] = [];
  for (const row of rowParts) {
    const cells = row
      .split(/[\s,]+/)
      .map((c) => c.trim())
      .filter(Boolean);
    if (cells.length !== cols) {
      throw new Error(`Expected ${cols} columns, got ${cells.length} in "${row}"`);
    }
    out.push(
      cells.map((cell) => {
        const asNum = Number(cell);
        if (Number.isFinite(asNum) && !/[A-Za-z_]/.test(cell)) return asNum;
        return compileExpression(cell)(vars);
      })
    );
  }
  return out;
}

function buildEvalVars(
  parameters: Record<string, Param>,
  x0: number[],
  u0: number[],
  t: number,
  ports: ReturnType<BlockDefinition['ports']>
): Record<string, number> {
  const vars: Record<string, number> = { t };
  for (let i = 0; i < x0.length; i++) {
    vars[`x${i + 1}`] = x0[i] ?? 0;
  }
  ports.inputs.forEach((port, index) => {
    const v = u0[index] ?? 0;
    vars[port.id] = v;
    vars[`u${index + 1}`] = v;
  });
  if (vars.u1 !== undefined) vars.u = vars.u1;
  for (const [key, value] of Object.entries(parameters)) {
    if (key === 'linA' || key === 'linB' || key === 'linMode' || key === 'dx' || key === 'A' || key === 'B') continue;
    const n = Number(value);
    if (Number.isFinite(n) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) vars[key] = n;
  }
  // constants: wn=2; zeta=0.2
  for (const part of text(parameters, 'constants', '').split(/[;\n]+/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    const rhs = Number(trimmed.slice(eq + 1).trim());
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && Number.isFinite(rhs)) vars[name] = rhs;
  }
  return vars;
}

function trySupplied(
  parameters: Record<string, Param>,
  x0: number[],
  u0: number[],
  t: number,
  n: number,
  m: number,
  ports: ReturnType<BlockDefinition['ports']>
): LinearizeResult | null {
  const mode = text(parameters, 'linMode', 'auto').toLowerCase();
  const linA = text(parameters, 'linA', '').trim();
  const linB = text(parameters, 'linB', '').trim();
  const want = mode === 'supplied' || (linA.length > 0 && linB.length > 0 && mode !== 'fd' && mode !== 'analytical');
  if (!want || !linA || !linB) {
    if (mode === 'supplied') throw new Error('linMode=supplied requires linA and linB matrices.');
    return null;
  }
  const vars = buildEvalVars(parameters, x0, u0, t, ports);
  return {
    A: parseMatrixExpressions(linA, vars, n, n),
    B: parseMatrixExpressions(linB, vars, n, m),
    method: 'supplied',
  };
}

function finiteDifference(
  def: BlockDefinition,
  parameters: Record<string, Param>,
  z0: number[],
  uBase: number[],
  t0: number,
  eps: number,
  n: number,
  m: number,
  ports: ReturnType<BlockDefinition['ports']>
): LinearizeResult {
  const evalF = (z: number[], u: number[]) => {
    const state = new Float64Array(z);
    const deriv = new Float64Array(n);
    const inputs: Record<string, number> = {};
    ports.inputs.forEach((port, index) => {
      inputs[port.id] = u[index] ?? 0;
    });
    const outputs: Record<string, number> = {};
    for (const port of ports.outputs) outputs[port.id] = 0;
    const ctx: BlockContext = {
      id: 'linearize',
      t: t0,
      dt: eps,
      inputs,
      outputs,
      parameters,
      state,
      discrete: new Float64Array(0),
      deriv,
    };
    def.outputs(ctx);
    def.derivatives!(ctx);
    return Array.from(deriv);
  };

  const A = Array.from({ length: n }, () => new Array(n).fill(0));
  const B = Array.from({ length: n }, () => new Array(m).fill(0));
  for (let j = 0; j < n; j++) {
    const zp = z0.slice();
    const zm = z0.slice();
    zp[j]! += eps;
    zm[j]! -= eps;
    const fp = evalF(zp, uBase);
    const fm = evalF(zm, uBase);
    for (let i = 0; i < n; i++) A[i]![j] = (fp[i]! - fm[i]!) / (2 * eps);
  }
  for (let j = 0; j < m; j++) {
    const up = uBase.slice();
    const um = uBase.slice();
    up[j]! += eps;
    um[j]! -= eps;
    const fp = evalF(z0, up);
    const fm = evalF(z0, um);
    for (let i = 0; i < n; i++) B[i]![j] = (fp[i]! - fm[i]!) / (2 * eps);
  }
  return { A, B, method: 'fd' };
}

/**
 * Linearize a continuous block about (x0, u0) at time t.
 *
 * Preference order (unless `linMode` forces a path):
 * 1. Supplied `linA` / `linB` (entries may be expressions in x,u,t,constants)
 * 2. Block `linearize` hook (closed-form / symbolic Jacobian)
 * 3. Central finite differences (fallback)
 */
export function linearizeBlock(
  blockType: string,
  parameters: Record<string, Param>,
  x0?: number[],
  u0?: number[],
  eps = 1e-6,
  t = 0
): LinearizeResult {
  const def = getBlock(blockType);
  if (!def?.derivatives) throw new Error(`Block "${blockType}" has no continuous dynamics to linearize.`);
  const n = def.continuousStates(parameters);
  const ports = def.ports(parameters);
  const m = Math.max(1, ports.inputs.length);
  const z0 = x0?.slice(0, n) ?? new Array(n).fill(0);
  while (z0.length < n) z0.push(0);
  const uBase = u0?.slice(0, m) ?? new Array(m).fill(0);
  while (uBase.length < m) uBase.push(0);
  const t0 = Number.isFinite(t) ? t : 0;
  const mode = text(parameters, 'linMode', 'auto').toLowerCase();

  if (mode !== 'fd' && mode !== 'analytical') {
    const supplied = trySupplied(parameters, z0, uBase, t0, n, m, ports);
    if (supplied) return supplied;
  }
  if (mode === 'supplied') {
    const supplied = trySupplied(parameters, z0, uBase, t0, n, m, ports);
    if (supplied) return supplied;
    throw new Error('linMode=supplied requires linA and linB.');
  }

  if (mode !== 'fd' && def.linearize) {
    const analytical = def.linearize({ parameters, x0: z0, u0: uBase, t: t0 });
    if (analytical) return { ...analytical, method: 'analytical' };
    if (mode === 'analytical') {
      throw new Error(`Block "${blockType}" has no analytical linearization at this operating point.`);
    }
  } else if (mode === 'analytical') {
    throw new Error(`Block "${blockType}" does not implement analytical linearization.`);
  }

  return finiteDifference(def, parameters, z0, uBase, t0, eps, n, m, ports);
}

/** Convenience: split a semicolon-separated expression list (re-export for callers). */
export { splitExpressions };
