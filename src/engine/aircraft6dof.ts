/**
 * Nonlinear rigid-body 6-DoF aircraft (flat, non-rotating Earth) following the
 * state formulation in NASA TM 88104 / H-1391 (Duke, Antoniewicz, Krambeer):
 *
 *   x = [p, q, r, V, α, β, φ, θ, ψ, h, x_N, y_E]ᵀ
 *
 * Rotational dynamics use body-axis Euler equations; translational rates use the
 * wind-axis (V, α, β) form; attitude rates and NED kinematics match §1.2.3–1.2.4.
 * Aerodynamics are a linear aero-coefficient model (light-aircraft style) so the
 * nonlinear plant is trim-able and finite-difference linearizable for Design.
 */
import { Param } from './types';

export const AIRCRAFT_NX = 12;
export const AIRCRAFT_NU = 4;

export type AircraftParams = {
  m: number;
  S: number;
  b: number;
  c: number;
  Ixx: number;
  Iyy: number;
  Izz: number;
  Ixz: number;
  rho: number;
  g: number;
  Tmax: number;
  CL0: number;
  CLa: number;
  CLq: number;
  CLde: number;
  CD0: number;
  CDa: number;
  CYb: number;
  CYp: number;
  CYr: number;
  CYdr: number;
  Clb: number;
  Clp: number;
  Clr: number;
  Clda: number;
  Cldr: number;
  Cm0: number;
  Cma: number;
  Cmq: number;
  Cmde: number;
  Cnb: number;
  Cnp: number;
  Cnr: number;
  Cnda: number;
  Cndr: number;
};

/** Generic light-aircraft SI parameters (≈ Navion-class scaling). */
export const DEFAULT_AIRCRAFT: AircraftParams = {
  m: 1110,
  S: 16.2,
  b: 10.2,
  c: 1.74,
  Ixx: 1285,
  Iyy: 1825,
  Izz: 2667,
  Ixz: 0,
  rho: 1.225,
  g: 9.81,
  Tmax: 3500,
  CL0: 0.28,
  CLa: 5.0,
  CLq: 4.0,
  CLde: 0.4,
  CD0: 0.03,
  CDa: 0.3,
  CYb: -0.5,
  CYp: 0,
  CYr: 0.2,
  CYdr: 0.15,
  Clb: -0.1,
  Clp: -0.45,
  Clr: 0.1,
  Clda: 0.12,
  Cldr: 0.01,
  Cm0: 0.04,
  Cma: -0.6,
  Cmq: -12,
  Cmde: -1.1,
  Cnb: 0.1,
  Cnp: -0.03,
  Cnr: -0.15,
  Cnda: -0.02,
  Cndr: -0.1,
};

export const AIRCRAFT_STATE_LABELS = [
  'p',
  'q',
  'r',
  'V',
  'α',
  'β',
  'φ',
  'θ',
  'ψ',
  'h',
  'xN',
  'yE',
] as const;

export const AIRCRAFT_INPUT_LABELS = ['δe', 'δa', 'δr', 'δt'] as const;

function num(p: Record<string, Param>, key: string, fallback: number): number {
  const v = Number(p[key]);
  return Number.isFinite(v) ? v : fallback;
}

export function parseAircraftParams(parameters: Record<string, Param> | null | undefined): AircraftParams {
  const d = DEFAULT_AIRCRAFT;
  const src = parameters ?? {};
  const out = { ...d };
  for (const key of Object.keys(d) as (keyof AircraftParams)[]) {
    out[key] = num(src, key, d[key]);
  }
  out.m = Math.max(1e-3, out.m);
  out.S = Math.max(1e-6, out.S);
  out.b = Math.max(1e-6, out.b);
  out.c = Math.max(1e-6, out.c);
  out.rho = Math.max(1e-6, out.rho);
  out.Tmax = Math.max(0, out.Tmax);
  return out;
}

function parseState(raw: string, fallback: number[]): number[] {
  const parts = String(raw ?? '')
    .trim()
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map(Number);
  const out = fallback.slice();
  for (let i = 0; i < AIRCRAFT_NX; i++) {
    if (Number.isFinite(parts[i])) out[i] = parts[i]!;
  }
  return out;
}

/** Default wings-level cruise seed (refined by trimAircraft). */
export const AIRCRAFT_X0_SEED = [
  0, 0, 0, 60, 0.05, 0, 0, 0.05, 0, 1000, 0, 0,
];

export function aircraftInitialState(parameters: Record<string, Param>): number[] {
  return parseState(String(parameters.x0 ?? ''), AIRCRAFT_X0_SEED);
}

/**
 * Nonlinear ẋ = f(x,u) for the H-1391 state vector.
 * u = [δe, δa, δr, δt] with surface angles in radians and throttle in [0,1].
 */
export function aircraftDerivatives(x: number[], u: number[], p: AircraftParams): number[] {
  const pRate = x[0] ?? 0;
  const q = x[1] ?? 0;
  const r = x[2] ?? 0;
  const V = Math.max(1, x[3] ?? 1);
  const alpha = x[4] ?? 0;
  const beta = x[5] ?? 0;
  const phi = x[6] ?? 0;
  const theta = x[7] ?? 0;
  const psi = x[8] ?? 0;

  const de = u[0] ?? 0;
  const da = u[1] ?? 0;
  const dr = u[2] ?? 0;
  const dt = Math.max(0, Math.min(1.5, u[3] ?? 0));

  const ca = Math.cos(alpha);
  const sa = Math.sin(alpha);
  const cb = Math.cos(beta);
  const sb = Math.sin(beta);
  const cph = Math.cos(phi);
  const sph = Math.sin(phi);
  const cth = Math.cos(theta);
  const sth = Math.sin(theta);
  const cps = Math.cos(psi);
  const sps = Math.sin(psi);

  // Body velocities from (V,α,β) — NASA (1-9)–(1-11).
  const uB = V * ca * cb;
  const vB = V * sb;
  const wB = V * sa * cb;

  const qbar = 0.5 * p.rho * V * V;
  const phat = (pRate * p.b) / (2 * V);
  const qhat = (q * p.c) / (2 * V);
  const rhat = (r * p.b) / (2 * V);

  const CL = p.CL0 + p.CLa * alpha + p.CLq * qhat + p.CLde * de;
  const CD = p.CD0 + p.CDa * Math.abs(alpha) + 0.05 * CL * CL;
  const CY = p.CYb * beta + p.CYp * phat + p.CYr * rhat + p.CYdr * dr;
  const Cl = p.Clb * beta + p.Clp * phat + p.Clr * rhat + p.Clda * da + p.Cldr * dr;
  const Cm = p.Cm0 + p.Cma * alpha + p.Cmq * qhat + p.Cmde * de;
  const Cn = p.Cnb * beta + p.Cnp * phat + p.Cnr * rhat + p.Cnda * da + p.Cndr * dr;

  // Wind-axis aero forces → body axes (stability/wind convention).
  const Lift = qbar * p.S * CL;
  const Drag = qbar * p.S * CD;
  const Side = qbar * p.S * CY;
  const Xa = -Drag * ca + Lift * sa;
  const Ya = Side;
  const Za = -Drag * sa - Lift * ca;

  const T = dt * p.Tmax;
  const Xt = T;
  const Yt = 0;
  const Zt = 0;

  // Gravity in body axes (flat Earth).
  const Xg = -p.m * p.g * sth;
  const Yg = p.m * p.g * sph * cth;
  const Zg = p.m * p.g * cph * cth;

  const X = Xa + Xt + Xg;
  const Y = Ya + Yt + Yg;
  const Z = Za + Zt + Zg;

  // Moments (body) — NASA (1-24).
  const Lmom = qbar * p.S * p.b * Cl;
  const Mmom = qbar * p.S * p.c * Cm;
  const Nmom = qbar * p.S * p.b * Cn;

  // Euler rotational eqs with Ixz — NASA (1-27)/(1-39)–(1-41) special case Ixy=Iyz=0.
  const { Ixx, Iyy, Izz, Ixz } = p;
  const Gamma = Ixx * Izz - Ixz * Ixz;
  const pDot =
    (Izz * Lmom + Ixz * Nmom - (Izz * (Iyy - Ixx) - Ixz * Ixz) * q * r + Ixz * (Ixx - Iyy + Izz) * pRate * q) /
    Math.max(1e-9, Gamma);
  const qDot = (Mmom - Ixz * (pRate * pRate - r * r) - (Ixx - Izz) * pRate * r) / Math.max(1e-9, Iyy);
  const rDot =
    (Ixx * Nmom + Ixz * Lmom + (Ixx * (Ixx - Iyy) + Ixz * Ixz) * pRate * q - Ixz * (Ixx - Iyy + Izz) * q * r) /
    Math.max(1e-9, Gamma);

  // Wind-axis translational rates — NASA (1-58)–(1-60) with D,Y,L and thrust/gravity folded into X,Y,Z.
  // Equivalent body-force form of app. B:
  const ax = X / p.m;
  const ay = Y / p.m;
  const az = Z / p.m;
  const Vdot = ax * ca * cb + ay * sb + az * sa * cb;
  const alphaDot =
    (az * ca - ax * sa) / Math.max(1e-6, V * cb) +
    q -
    Math.tan(beta) * (pRate * ca + r * sa);
  const betaDot =
    (1 / Math.max(1e-6, V)) * (-ax * ca * sb + ay * cb - az * sa * sb) + pRate * sa - r * ca;

  // Attitude rates — NASA (1-66)–(1-68).
  const tth = Math.tan(Math.max(-1.45, Math.min(1.45, theta)));
  const cthSafe = Math.abs(cth) < 0.05 ? 0.05 * Math.sign(cth || 1) : cth;
  const phiDot = pRate + tth * (q * sph + r * cph);
  const thetaDot = q * cph - r * sph;
  const psiDot = (q * sph + r * cph) / cthSafe;

  // Earth-relative velocity — NASA (1-72)–(1-74); h up, x North, y East.
  const hDot =
    V * (ca * cb * sth - sb * sph * cth - sa * cb * cph * cth);
  const xDot =
    V *
    (ca * cb * cth * cps +
      sb * (sph * sth * cps - cph * sps) +
      sa * cb * (cph * sth * cps + sph * sps));
  const yDot =
    V *
    (ca * cb * cth * sps +
      sb * (cph * cps + sph * sth * sps) +
      sa * cb * (cph * sth * sps - sph * cps));

  // Silence unused body velocity locals (kept for clarity / future sensors).
  void uB;
  void vB;
  void wB;

  return [pDot, qDot, rDot, Vdot, alphaDot, betaDot, phiDot, thetaDot, psiDot, hDot, xDot, yDot];
}

export type AircraftTrim = {
  x: number[];
  u: number[];
  residual: number;
};

/**
 * Approximate wings-level cruise trim at speed V and altitude h:
 * solve α, δe, δt for V̇≈α̇≈q̇≈0 with β=p=q=r=φ=0, θ=α (γ=0).
 */
export function trimAircraft(
  p: AircraftParams,
  opts: { V?: number; h?: number; iters?: number } = {}
): AircraftTrim {
  const V = opts.V ?? 60;
  const h = opts.h ?? 1000;
  let alpha = 0.05;
  let de = 0;
  let dt = 0.4;
  const eps = 1e-5;
  const iters = opts.iters ?? 25;

  const residualOf = (a: number, elev: number, thr: number) => {
    const x = [0, 0, 0, V, a, 0, 0, a, 0, h, 0, 0];
    const u = [elev, 0, 0, thr];
    const f = aircraftDerivatives(x, u, p);
    return [f[3]!, f[4]!, f[1]!]; // V̇, α̇, q̇
  };

  for (let k = 0; k < iters; k++) {
    const r0 = residualOf(alpha, de, dt);
    const J = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    for (let j = 0; j < 3; j++) {
      const da = j === 0 ? eps : 0;
      const dde = j === 1 ? eps : 0;
      const ddt = j === 2 ? eps : 0;
      const rp = residualOf(alpha + da, de + dde, dt + ddt);
      for (let i = 0; i < 3; i++) J[i]![j] = (rp[i]! - r0[i]!) / eps;
    }
    // Solve J Δ = −r (3×3 Gauss).
    const A = J.map((row, i) => [...row, -r0[i]!]);
    for (let col = 0; col < 3; col++) {
      let piv = col;
      for (let r = col + 1; r < 3; r++) if (Math.abs(A[r]![col]!) > Math.abs(A[piv]![col]!)) piv = r;
      const tmp = A[col]!;
      A[col] = A[piv]!;
      A[piv] = tmp;
      const diag = A[col]![col]!;
      if (Math.abs(diag) < 1e-12) continue;
      for (let c = col; c < 4; c++) A[col]![c]! /= diag;
      for (let r = 0; r < 3; r++) {
        if (r === col) continue;
        const f = A[r]![col]!;
        for (let c = col; c < 4; c++) A[r]![c]! -= f * A[col]![c]!;
      }
    }
    alpha += A[0]![3]!;
    de += A[1]![3]!;
    dt += A[2]![3]!;
    dt = Math.max(0.05, Math.min(1.2, dt));
    alpha = Math.max(-0.2, Math.min(0.35, alpha));
    de = Math.max(-0.4, Math.min(0.4, de));
  }

  const x = [0, 0, 0, V, alpha, 0, 0, alpha, 0, h, 0, 0];
  const u = [de, 0, 0, dt];
  const f = aircraftDerivatives(x, u, p);
  const residual = Math.hypot(f[1]!, f[3]!, f[4]!);
  return { x, u, residual };
}

/** Finite-difference linearization of the nonlinear 6-DoF about (x0,u0). */
export function linearizeAircraft(
  x0: number[],
  u0: number[],
  p: AircraftParams,
  eps = 1e-5
): { A: number[][]; B: number[][] } {
  const n = AIRCRAFT_NX;
  const m = AIRCRAFT_NU;
  const z0 = x0.slice(0, n);
  while (z0.length < n) z0.push(0);
  const uBase = u0.slice(0, m);
  while (uBase.length < m) uBase.push(0);

  const A = Array.from({ length: n }, () => new Array(n).fill(0));
  const B = Array.from({ length: n }, () => new Array(m).fill(0));
  for (let j = 0; j < n; j++) {
    const zp = z0.slice();
    const zm = z0.slice();
    zp[j]! += eps;
    zm[j]! -= eps;
    const fp = aircraftDerivatives(zp, uBase, p);
    const fm = aircraftDerivatives(zm, uBase, p);
    for (let i = 0; i < n; i++) A[i]![j] = (fp[i]! - fm[i]!) / (2 * eps);
  }
  for (let j = 0; j < m; j++) {
    const up = uBase.slice();
    const um = uBase.slice();
    up[j]! += eps;
    um[j]! -= eps;
    const fp = aircraftDerivatives(z0, up, p);
    const fm = aircraftDerivatives(z0, um, p);
    for (let i = 0; i < n; i++) B[i]![j] = (fp[i]! - fm[i]!) / (2 * eps);
  }
  return { A, B };
}

export function formatAircraftVector(values: number[], digits = 6): string {
  return values
    .map((v) => {
      if (!Number.isFinite(v)) return '0';
      return String(Number(v.toPrecision(digits)));
    })
    .join(' ');
}
