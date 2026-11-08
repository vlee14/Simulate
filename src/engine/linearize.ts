import { getBlock } from './blocks';
import { BlockContext, Param } from './types';

/** Finite-difference linearization of any continuous block about (x0, u0) at time t. */
export function linearizeBlock(
  blockType: string,
  parameters: Record<string, Param>,
  x0?: number[],
  u0?: number[],
  eps = 1e-6,
  t = 0
): { A: number[][]; B: number[][] } {
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
    zp[j] += eps;
    zm[j] -= eps;
    const fp = evalF(zp, uBase);
    const fm = evalF(zm, uBase);
    for (let i = 0; i < n; i++) A[i][j] = (fp[i] - fm[i]) / (2 * eps);
  }
  for (let j = 0; j < m; j++) {
    const up = uBase.slice();
    const um = uBase.slice();
    up[j] += eps;
    um[j] -= eps;
    const fp = evalF(z0, up);
    const fm = evalF(z0, um);
    for (let i = 0; i < n; i++) B[i][j] = (fp[i] - fm[i]) / (2 * eps);
  }
  return { A, B };
}
