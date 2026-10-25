export interface PendulumParams {
  M: number;
  m1: number;
  m2: number;
  l1: number;
  l2: number;
  g: number;
  b: number;
  c1: number;
  c2: number;
}

export const DEFAULT_PENDULUM: PendulumParams = {
  M: 1.0,
  m1: 0.25,
  m2: 0.25,
  l1: 0.4,
  l2: 0.4,
  g: 9.81,
  b: 0.15,
  c1: 0.002,
  c2: 0.002,
};

const M9 = new Float64Array(9);
const RHS = new Float64Array(3);
const QDD = new Float64Array(3);

function solve3(A: Float64Array, b: Float64Array, x: Float64Array): boolean {
  for (let k = 0; k < 3; k++) {
    let piv = k;
    let max = Math.abs(A[k * 3 + k]);
    for (let i = k + 1; i < 3; i++) {
      const v = Math.abs(A[i * 3 + k]);
      if (v > max) {
        max = v;
        piv = i;
      }
    }
    if (max < 1e-12) return false;
    if (piv !== k) {
      for (let j = k; j < 3; j++) {
        const tmp = A[k * 3 + j];
        A[k * 3 + j] = A[piv * 3 + j];
        A[piv * 3 + j] = tmp;
      }
      const tb = b[k];
      b[k] = b[piv];
      b[piv] = tb;
    }
    const diag = A[k * 3 + k];
    for (let i = k + 1; i < 3; i++) {
      const f = A[i * 3 + k] / diag;
      A[i * 3 + k] = 0;
      for (let j = k + 1; j < 3; j++) A[i * 3 + j] -= f * A[k * 3 + j];
      b[i] -= f * b[k];
    }
  }
  for (let k = 2; k >= 0; k--) {
    let s = b[k];
    for (let j = k + 1; j < 3; j++) s -= A[k * 3 + j] * x[j];
    x[k] = s / A[k * 3 + k];
  }
  return true;
}

/**
 * Cart + double inverted pendulum.
 * State is [x, θ1, θ2, dx, ω1, ω2]. Angles are measured from upright.
 * θ > 0 tips the link toward +x. Input is the horizontal force on the cart.
 */
export function pendulumDerivatives(
  z: ArrayLike<number>,
  force: number,
  p: PendulumParams,
  out: { [i: number]: number }
): void {
  const th1 = z[1];
  const th2 = z[2];
  const dx = z[3];
  const w1 = z[4];
  const w2 = z[5];
  const s1 = Math.sin(th1);
  const s2 = Math.sin(th2);
  const c1 = Math.cos(th1);
  const c2 = Math.cos(th2);
  const delta = th1 - th2;
  const sd = Math.sin(delta);
  const cd = Math.cos(delta);
  const m12 = p.m1 + p.m2;
  const mc = p.M + m12;
  const l1 = p.l1;
  const l2 = p.l2;

  M9[0] = mc;
  M9[1] = m12 * l1 * c1;
  M9[2] = p.m2 * l2 * c2;
  M9[3] = M9[1];
  M9[4] = m12 * l1 * l1;
  M9[5] = p.m2 * l1 * l2 * cd;
  M9[6] = M9[2];
  M9[7] = M9[5];
  M9[8] = p.m2 * l2 * l2;

  RHS[0] = force - p.b * dx + m12 * l1 * s1 * w1 * w1 + p.m2 * l2 * s2 * w2 * w2;
  RHS[1] = -p.c1 * w1 - p.m2 * l1 * l2 * sd * w2 * w2 + m12 * p.g * l1 * s1;
  RHS[2] = -p.c2 * w2 + p.m2 * l1 * l2 * sd * w1 * w1 + p.m2 * p.g * l2 * s2;

  const ok = solve3(M9, RHS, QDD);
  out[0] = dx;
  out[1] = w1;
  out[2] = w2;
  out[3] = ok ? QDD[0] : 0;
  out[4] = ok ? QDD[1] : 0;
  out[5] = ok ? QDD[2] : 0;
}

export function pendulumEnergy(z: ArrayLike<number>, p: PendulumParams): { kinetic: number; potential: number; total: number } {
  const th1 = z[1];
  const th2 = z[2];
  const dx = z[3];
  const w1 = z[4];
  const w2 = z[5];
  const vx1 = dx + p.l1 * Math.cos(th1) * w1;
  const vy1 = -p.l1 * Math.sin(th1) * w1;
  const vx2 = vx1 + p.l2 * Math.cos(th2) * w2;
  const vy2 = vy1 - p.l2 * Math.sin(th2) * w2;
  const kinetic = 0.5 * p.M * dx * dx + 0.5 * p.m1 * (vx1 * vx1 + vy1 * vy1) + 0.5 * p.m2 * (vx2 * vx2 + vy2 * vy2);
  const y1 = p.l1 * Math.cos(th1);
  const y2 = y1 + p.l2 * Math.cos(th2);
  const potential = p.m1 * p.g * y1 + p.m2 * p.g * y2;
  const upright = (p.m1 + p.m2) * p.g * p.l1 + p.m2 * p.g * p.l2;
  return { kinetic, potential: potential - upright, total: kinetic + potential - upright };
}

export function readPendulumParams(parameters: Record<string, number | string | boolean>): PendulumParams {
  const n = (key: keyof PendulumParams, fallback: number) => {
    const v = Number(parameters[key]);
    return Number.isFinite(v) ? v : fallback;
  };
  return {
    M: Math.max(0.05, n('M', DEFAULT_PENDULUM.M)),
    m1: Math.max(0.01, n('m1', DEFAULT_PENDULUM.m1)),
    m2: Math.max(0.01, n('m2', DEFAULT_PENDULUM.m2)),
    l1: Math.max(0.05, n('l1', DEFAULT_PENDULUM.l1)),
    l2: Math.max(0.05, n('l2', DEFAULT_PENDULUM.l2)),
    g: n('g', DEFAULT_PENDULUM.g),
    b: Math.max(0, n('b', DEFAULT_PENDULUM.b)),
    c1: Math.max(0, n('c1', DEFAULT_PENDULUM.c1)),
    c2: Math.max(0, n('c2', DEFAULT_PENDULUM.c2)),
  };
}

/** Numerical Jacobian of the 6-state dynamics at the upright equilibrium. */
export function linearizePendulum(p: PendulumParams, eps = 1e-6): { A: number[][]; B: number[][] } {
  const z0 = [0, 0, 0, 0, 0, 0];
  const f = (z: number[], u: number) => {
    const out = [0, 0, 0, 0, 0, 0];
    pendulumDerivatives(z, u, p, out);
    return out;
  };
  const A = Array.from({ length: 6 }, () => new Array(6).fill(0));
  const B = Array.from({ length: 6 }, () => [0]);
  for (let j = 0; j < 6; j++) {
    const zp = z0.slice();
    const zm = z0.slice();
    zp[j] += eps;
    zm[j] -= eps;
    const fp = f(zp, 0);
    const fm = f(zm, 0);
    for (let i = 0; i < 6; i++) A[i][j] = (fp[i] - fm[i]) / (2 * eps);
  }
  const fp = f(z0, eps);
  const fm = f(z0, -eps);
  for (let i = 0; i < 6; i++) B[i][0] = (fp[i] - fm[i]) / (2 * eps);
  return { A, B };
}

/** Independent Lagrangian residual, used to verify the mass-matrix equations. */
export function lagrangianResidual(q: number[], v: number[], force: number, p: PendulumParams): number {
  const kinetic = (qq: number[], vv: number[]) => {
    const dx = vv[0];
    const w1 = vv[1];
    const w2 = vv[2];
    const vx1 = dx + p.l1 * Math.cos(qq[1]) * w1;
    const vy1 = -p.l1 * Math.sin(qq[1]) * w1;
    const vx2 = vx1 + p.l2 * Math.cos(qq[2]) * w2;
    const vy2 = vy1 - p.l2 * Math.sin(qq[2]) * w2;
    return 0.5 * p.M * dx * dx + 0.5 * p.m1 * (vx1 * vx1 + vy1 * vy1) + 0.5 * p.m2 * (vx2 * vx2 + vy2 * vy2);
  };
  const potential = (qq: number[]) => {
    const y1 = p.l1 * Math.cos(qq[1]);
    const y2 = y1 + p.l2 * Math.cos(qq[2]);
    return p.m1 * p.g * y1 + p.m2 * p.g * y2;
  };
  const L = (qq: number[], vv: number[]) => kinetic(qq, vv) - potential(qq);
  const eps = 1e-7;
  const momentum = (qq: number[], vv: number[]) => {
    const g = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const vp = vv.slice();
      const vm = vv.slice();
      vp[i] += eps;
      vm[i] -= eps;
      g[i] = (L(qq, vp) - L(qq, vm)) / (2 * eps);
    }
    return g;
  };
  const z = [q[0], q[1], q[2], v[0], v[1], v[2]];
  const deriv = [0, 0, 0, 0, 0, 0];
  pendulumDerivatives(z, force, p, deriv);
  const acc = [deriv[3], deriv[4], deriv[5]];
  const dt = 1e-5;
  const qF = q.map((qi, i) => qi + v[i] * dt);
  const vF = v.map((vi, i) => vi + acc[i] * dt);
  const qB = q.map((qi, i) => qi - v[i] * dt);
  const vB = v.map((vi, i) => vi - acc[i] * dt);
  const pF = momentum(qF, vF);
  const pB = momentum(qB, vB);
  let err = 0;
  for (let i = 0; i < 3; i++) {
    const dpdt = (pF[i] - pB[i]) / (2 * dt);
    const qp = q.slice();
    const qm = q.slice();
    qp[i] += eps;
    qm[i] -= eps;
    const dLdq = (L(qp, v) - L(qm, v)) / (2 * eps);
    const Q = i === 0 ? force - p.b * v[0] : i === 1 ? -p.c1 * v[1] : -p.c2 * v[2];
    err += Math.abs(dpdt - dLdq - Q);
  }
  return err;
}
