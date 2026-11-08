import {
  compileExpression,
  expressionUsesInput,
  splitExpressions,
} from './expr';
import { clampPositive, parseAssignments, solveDense } from './dynamics';
import { parseStageConfig } from './scene';
import { BlockContext, BlockDefinition, Param, ParamSpec, PortDef } from './types';

function num(p: Record<string, Param>, key: string, fallback = 0): number {
  const v = Number(p[key]);
  return Number.isFinite(v) ? v : fallback;
}

function text(p: Record<string, Param>, key: string, fallback = ''): string {
  const v = p[key];
  return v === undefined ? fallback : String(v);
}

const none = () => 0;
const noFeed = () => false;
const feed = () => true;

const numberField = (key: string, label: string, group?: string, step = 0.1, help?: string): ParamSpec => ({
  key,
  label,
  type: 'number',
  group,
  step,
  help,
});

const exprCache = new Map<string, (vars: Record<string, number>) => number>();
function runExpr(source: string, vars: Record<string, number>): number {
  let fn = exprCache.get(source);
  if (!fn) {
    fn = compileExpression(source);
    exprCache.set(source, fn);
  }
  return fn(vars);
}

function bindVars(ctx: BlockContext, extra: Record<string, number> = {}): Record<string, number> {
  const vars: Record<string, number> = { t: ctx.t, ...extra, ...parseAssignments(text(ctx.parameters, 'constants', '')) };
  for (const [key, value] of Object.entries(ctx.parameters)) {
    if (key === 'constants' || key === 'dx' || key === 'y' || key === 'M' || key === 'rhs' || key === 'x0' || key === 'form') continue;
    const n = Number(value);
    if (Number.isFinite(n) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) vars[key] = n;
  }
  for (let i = 0; i < ctx.state.length; i++) {
    vars[`x${i + 1}`] = ctx.state[i];
    vars[`q${i + 1}`] = ctx.state[i];
  }
  const inputIds = Object.keys(ctx.inputs).sort();
  inputIds.forEach((id, index) => {
    const value = ctx.inputs[id] ?? 0;
    vars[id] = value;
    vars[`u${index + 1}`] = value;
  });
  if (vars.u1 !== undefined) vars.u = vars.u1;
  return vars;
}

function countPorts(value: number, fallback: number, max = 8): number {
  const n = Math.round(Number.isFinite(value) ? value : fallback);
  return Math.max(1, Math.min(max, n));
}

function odeSize(p: Record<string, Param>): { nx: number; nu: number; ny: number; nq: number; form: string } {
  const form = text(p, 'form', 'explicit');
  if (form === 'mass') {
    const nq = countPorts(num(p, 'nq', 2), 2, 6);
    return { nx: nq * 2, nu: countPorts(num(p, 'nu', 1), 1, 4), ny: countPorts(num(p, 'ny', nq * 2), nq * 2, 12), nq, form };
  }
  const nx = countPorts(num(p, 'nx', 2), 2, 12);
  return { nx, nu: countPorts(num(p, 'nu', 1), 1, 4), ny: countPorts(num(p, 'ny', nx), nx, 12), nq: 0, form: 'explicit' };
}

const Mbuf = new Float64Array(36);
const RHSbuf = new Float64Array(6);
const QDDbuf = new Float64Array(6);

function splitMatrixEntries(source: string): string[] {
  return source
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function evalMassForm(ctx: BlockContext, nq: number): boolean {
  const vars = bindVars(ctx);
  const mParts = splitMatrixEntries(text(ctx.parameters, 'M', ''));
  const rParts = splitExpressions(text(ctx.parameters, 'rhs', ''));
  if (mParts.length !== nq * nq) throw new Error(`Mass matrix needs ${nq * nq} entries, got ${mParts.length}`);
  if (rParts.length !== nq) throw new Error(`RHS needs ${nq} entries, got ${rParts.length}`);
  for (let i = 0; i < nq * nq; i++) Mbuf[i] = runExpr(mParts[i], vars);
  for (let i = 0; i < nq; i++) RHSbuf[i] = runExpr(rParts[i], vars);
  return solveDense(Mbuf.subarray(0, nq * nq), nq, RHSbuf.subarray(0, nq), QDDbuf.subarray(0, nq));
}

function writeOutputsFromState(ctx: BlockContext, ny: number): void {
  const yParts = splitExpressions(text(ctx.parameters, 'y', ''));
  if (yParts.length === 0) {
    for (let i = 0; i < ny; i++) ctx.outputs[`y${i}`] = ctx.state[i] ?? 0;
    return;
  }
  const vars = bindVars(ctx);
  for (let i = 0; i < ny; i++) {
    const source = yParts[i] ?? yParts[yParts.length - 1] ?? '0';
    ctx.outputs[`y${i}`] = runExpr(source, vars);
  }
}

export const DOMAIN_BLOCKS: BlockDefinition[] = [
  {
    type: 'ode',
    category: 'Dynamics',
    name: 'ODE',
    description: 'Generic continuous plant. Explicit ẋ = f(x,u,t), or mass-matrix form M(q)q̈ = rhs for multibody models.',
    renderer: 'sim',
    defaultParameters: {
      form: 'explicit',
      nx: 2,
      nq: 2,
      nu: 1,
      ny: 2,
      constants: 'wn=2; zeta=0.2',
      dx: 'x2; -wn^2*x1 - 2*zeta*wn*x2 + u1',
      M: '1, 0; 0, 1',
      rhs: 'u1; 0',
      y: 'x1; x2',
      x0: '1 0',
    },
    parameters: [
      {
        key: 'form',
        label: 'Form',
        type: 'select',
        group: 'Structure',
        options: [
          { value: 'explicit', label: 'Explicit ẋ = f(x,u,t)' },
          { value: 'mass', label: 'Mass matrix M(q)q̈ = rhs' },
        ],
      },
      numberField('nx', 'States nx', 'Structure', 1, 'Used for explicit form'),
      numberField('nq', 'Coordinates nq', 'Structure', 1, 'Used for mass-matrix form. State is [q; q̇]'),
      numberField('nu', 'Inputs nu', 'Structure', 1),
      numberField('ny', 'Outputs ny', 'Structure', 1),
      {
        key: 'constants',
        label: 'Constants',
        type: 'string',
        wide: true,
        group: 'Dynamics',
        help: 'Assignments like M=1; g=9.81. Names are available in expressions.',
      },
      {
        key: 'dx',
        label: 'ẋ expressions',
        type: 'string',
        wide: true,
        group: 'Dynamics',
        help: 'Semicolon-separated. Variables x1…xn, u1…um, t, and constants.',
      },
      {
        key: 'M',
        label: 'Mass matrix M',
        type: 'string',
        wide: true,
        group: 'Dynamics',
        help: 'Row-major, semicolon between rows. Entries are expressions in q (x1…xnq) and constants.',
      },
      {
        key: 'rhs',
        label: 'RHS',
        type: 'string',
        wide: true,
        group: 'Dynamics',
        help: 'Semicolon-separated generalized forces / Coriolis / gravity terms.',
      },
      {
        key: 'y',
        label: 'Outputs y',
        type: 'string',
        wide: true,
        group: 'Dynamics',
        help: 'Semicolon-separated. Empty exposes the states.',
      },
      {
        key: 'x0',
        label: 'Initial state',
        type: 'string',
        wide: true,
        group: 'Dynamics',
      },
    ],
    hasDirectFeedthrough: (p) => {
      const y = text(p, 'y', '');
      return y.length > 0 && expressionUsesInput(y);
    },
    ports: (p) => {
      const { nu, ny } = odeSize(p);
      return {
        inputs: Array.from({ length: nu }, (_, i) => ({ id: `u${i + 1}`, name: nu === 1 ? 'u' : `u${i + 1}` })),
        outputs: Array.from({ length: ny }, (_, i) => ({ id: `y${i}`, name: ny === 1 ? 'y' : `y${i + 1}` })),
      };
    },
    continuousStates: (p) => odeSize(p).nx,
    discreteStates: none,
    init: (ctx) => {
      const parts = text(ctx.parameters, 'x0', '')
        .trim()
        .split(/[\s,;]+/)
        .filter(Boolean)
        .map(Number);
      for (let i = 0; i < ctx.state.length; i++) ctx.state[i] = Number.isFinite(parts[i]) ? parts[i] : 0;
    },
    outputs: (ctx) => {
      writeOutputsFromState(ctx, odeSize(ctx.parameters).ny);
    },
    derivatives: (ctx) => {
      const size = odeSize(ctx.parameters);
      if (size.form === 'mass') {
        const nq = size.nq;
        for (let i = 0; i < nq; i++) ctx.deriv[i] = ctx.state[nq + i];
        const ok = evalMassForm(ctx, nq);
        for (let i = 0; i < nq; i++) ctx.deriv[nq + i] = ok ? QDDbuf[i] : 0;
        return;
      }
      const vars = bindVars(ctx);
      const parts = splitExpressions(text(ctx.parameters, 'dx', ''));
      if (parts.length !== size.nx) throw new Error(`Expected ${size.nx} derivative expressions, got ${parts.length}`);
      for (let i = 0; i < size.nx; i++) ctx.deriv[i] = runExpr(parts[i], vars);
    },
  },
  {
    type: 'secondorder',
    category: 'Dynamics',
    name: 'Second-Order',
    description: 'Standard plant ÿ + 2ζωẏ + ω²y = K u',
    renderer: 'sim',
    defaultParameters: { wn: 2, zeta: 0.25, K: 1, y0: 0, dy0: 0 },
    parameters: [
      numberField('wn', 'Natural freq. ωn', 'Plant', 0.1),
      numberField('zeta', 'Damping ζ', 'Plant', 0.05),
      numberField('K', 'Gain K', 'Plant', 0.1),
      numberField('y0', 'y(0)', 'Initial', 0.1),
      numberField('dy0', 'ẏ(0)', 'Initial', 0.1),
    ],
    hasDirectFeedthrough: noFeed,
    ports: () => ({
      inputs: [{ id: 'u', name: 'u' }],
      outputs: [
        { id: 'y', name: 'y' },
        { id: 'dy', name: 'ẏ' },
      ],
    }),
    continuousStates: () => 2,
    discreteStates: none,
    init: (ctx) => {
      ctx.state[0] = num(ctx.parameters, 'y0', 0);
      ctx.state[1] = num(ctx.parameters, 'dy0', 0);
    },
    outputs: (ctx) => {
      ctx.outputs.y = ctx.state[0];
      ctx.outputs.dy = ctx.state[1];
    },
    derivatives: (ctx) => {
      const wn = Math.max(1e-6, num(ctx.parameters, 'wn', 1));
      const zeta = num(ctx.parameters, 'zeta', 0.2);
      const K = num(ctx.parameters, 'K', 1);
      const u = ctx.inputs.u ?? 0;
      ctx.deriv[0] = ctx.state[1];
      ctx.deriv[1] = K * u - 2 * zeta * wn * ctx.state[1] - wn * wn * ctx.state[0];
    },
  },
  {
    type: 'mass',
    category: 'Dynamics',
    name: 'Mass',
    description: 'Translational mass. F = m a with integrated velocity and position.',
    renderer: 'sim',
    defaultParameters: { m: 1, x0: 0, v0: 0 },
    parameters: [
      numberField('m', 'Mass m', 'Mechanical', 0.05),
      numberField('x0', 'x(0)', 'Initial', 0.05),
      numberField('v0', 'v(0)', 'Initial', 0.05),
    ],
    hasDirectFeedthrough: noFeed,
    ports: () => ({
      inputs: [{ id: 'F', name: 'F', domain: 'mechanical' }],
      outputs: [
        { id: 'x', name: 'x', domain: 'mechanical' },
        { id: 'v', name: 'v', domain: 'mechanical' },
      ],
    }),
    continuousStates: () => 2,
    discreteStates: none,
    init: (ctx) => {
      ctx.state[0] = num(ctx.parameters, 'x0', 0);
      ctx.state[1] = num(ctx.parameters, 'v0', 0);
    },
    outputs: (ctx) => {
      ctx.outputs.x = ctx.state[0];
      ctx.outputs.v = ctx.state[1];
    },
    derivatives: (ctx) => {
      const m = clampPositive(num(ctx.parameters, 'm', 1));
      ctx.deriv[0] = ctx.state[1];
      ctx.deriv[1] = (ctx.inputs.F ?? 0) / m;
    },
  },
  {
    type: 'inertia',
    category: 'Dynamics',
    name: 'Inertia',
    description: 'Rotational inertia. T = J α with integrated speed and angle.',
    renderer: 'sim',
    defaultParameters: { J: 0.05, theta0: 0, w0: 0 },
    parameters: [
      numberField('J', 'Inertia J', 'Mechanical', 0.01),
      numberField('theta0', 'θ(0)', 'Initial', 0.05),
      numberField('w0', 'ω(0)', 'Initial', 0.05),
    ],
    hasDirectFeedthrough: noFeed,
    ports: () => ({
      inputs: [{ id: 'T', name: 'T', domain: 'mechanical' }],
      outputs: [
        { id: 'theta', name: 'θ', domain: 'mechanical' },
        { id: 'w', name: 'ω', domain: 'mechanical' },
      ],
    }),
    continuousStates: () => 2,
    discreteStates: none,
    init: (ctx) => {
      ctx.state[0] = num(ctx.parameters, 'theta0', 0);
      ctx.state[1] = num(ctx.parameters, 'w0', 0);
    },
    outputs: (ctx) => {
      ctx.outputs.theta = ctx.state[0];
      ctx.outputs.w = ctx.state[1];
    },
    derivatives: (ctx) => {
      const J = clampPositive(num(ctx.parameters, 'J', 0.05));
      ctx.deriv[0] = ctx.state[1];
      ctx.deriv[1] = (ctx.inputs.T ?? 0) / J;
    },
  },
  {
    type: 'spring',
    category: 'Dynamics',
    name: 'Spring',
    description: 'Force or torque from displacement. y = k · u',
    renderer: 'sim',
    defaultParameters: { k: 1 },
    parameters: [numberField('k', 'Stiffness k', 'Mechanical', 0.1)],
    hasDirectFeedthrough: feed,
    ports: () => ({
      inputs: [{ id: 'in', name: 'x', domain: 'mechanical' }],
      outputs: [{ id: 'out', name: 'F', domain: 'mechanical' }],
    }),
    continuousStates: none,
    discreteStates: none,
    outputs: (ctx) => {
      ctx.outputs.out = num(ctx.parameters, 'k', 1) * (ctx.inputs.in ?? 0);
    },
  },
  {
    type: 'damper',
    category: 'Dynamics',
    name: 'Damper',
    description: 'Viscous force or torque. y = c · u',
    renderer: 'sim',
    defaultParameters: { c: 0.2 },
    parameters: [numberField('c', 'Damping c', 'Mechanical', 0.05)],
    hasDirectFeedthrough: feed,
    ports: () => ({
      inputs: [{ id: 'in', name: 'v', domain: 'mechanical' }],
      outputs: [{ id: 'out', name: 'F', domain: 'mechanical' }],
    }),
    continuousStates: none,
    discreteStates: none,
    outputs: (ctx) => {
      ctx.outputs.out = num(ctx.parameters, 'c', 0.2) * (ctx.inputs.in ?? 0);
    },
  },
  {
    type: 'dcmotor',
    category: 'Dynamics',
    name: 'DC Motor',
    description: 'Armature-controlled DC motor. States current i and speed ω.',
    renderer: 'sim',
    defaultParameters: { R: 1, L: 0.05, Kt: 0.1, Kb: 0.1, J: 0.02, b: 0.05, i0: 0, w0: 0 },
    parameters: [
      numberField('R', 'Resistance R', 'Electrical', 0.1),
      numberField('L', 'Inductance L', 'Electrical', 0.05),
      numberField('Kt', 'Torque const. Kt', 'Electrical', 0.01),
      numberField('Kb', 'Back-EMF Kb', 'Electrical', 0.01),
      numberField('J', 'Rotor inertia J', 'Mechanical', 0.01),
      numberField('b', 'Viscous friction b', 'Mechanical', 0.01),
      numberField('i0', 'i(0)', 'Initial', 0.01),
      numberField('w0', 'ω(0)', 'Initial', 0.01),
    ],
    hasDirectFeedthrough: noFeed,
    ports: () => ({
      inputs: [
        { id: 'Va', name: 'Va', domain: 'electrical' },
        { id: 'TL', name: 'TL', domain: 'mechanical' },
      ],
      outputs: [
        { id: 'w', name: 'ω', domain: 'mechanical' },
        { id: 'i', name: 'i', domain: 'electrical' },
        { id: 'T', name: 'T', domain: 'mechanical' },
      ],
    }),
    continuousStates: () => 2,
    discreteStates: none,
    init: (ctx) => {
      ctx.state[0] = num(ctx.parameters, 'i0', 0);
      ctx.state[1] = num(ctx.parameters, 'w0', 0);
    },
    outputs: (ctx) => {
      const Kt = num(ctx.parameters, 'Kt', 0.01);
      ctx.outputs.i = ctx.state[0];
      ctx.outputs.w = ctx.state[1];
      ctx.outputs.T = Kt * ctx.state[0];
    },
    derivatives: (ctx) => {
      const R = Math.max(0, num(ctx.parameters, 'R', 1));
      const L = clampPositive(num(ctx.parameters, 'L', 0.5));
      const Kt = num(ctx.parameters, 'Kt', 0.01);
      const Kb = num(ctx.parameters, 'Kb', 0.01);
      const J = clampPositive(num(ctx.parameters, 'J', 0.01));
      const b = Math.max(0, num(ctx.parameters, 'b', 0.1));
      const Va = ctx.inputs.Va ?? 0;
      const TL = ctx.inputs.TL ?? 0;
      const i = ctx.state[0];
      const w = ctx.state[1];
      ctx.deriv[0] = (Va - R * i - Kb * w) / L;
      ctx.deriv[1] = (Kt * i - b * w - TL) / J;
    },
  },
  {
    type: 'rlc',
    category: 'Dynamics',
    name: 'Series RLC',
    description: 'Series RLC circuit driven by voltage. States capacitor voltage and inductor current.',
    renderer: 'sim',
    defaultParameters: { R: 1, L: 0.5, C: 0.2, v0: 0, i0: 0 },
    parameters: [
      numberField('R', 'R', 'Electrical', 0.1),
      numberField('L', 'L', 'Electrical', 0.05),
      numberField('C', 'C', 'Electrical', 0.05),
      numberField('v0', 'vC(0)', 'Initial', 0.05),
      numberField('i0', 'iL(0)', 'Initial', 0.05),
    ],
    hasDirectFeedthrough: noFeed,
    ports: () => ({
      inputs: [{ id: 'V', name: 'V' }],
      outputs: [
        { id: 'vC', name: 'vC' },
        { id: 'i', name: 'i' },
      ],
    }),
    continuousStates: () => 2,
    discreteStates: none,
    init: (ctx) => {
      ctx.state[0] = num(ctx.parameters, 'v0', 0);
      ctx.state[1] = num(ctx.parameters, 'i0', 0);
    },
    outputs: (ctx) => {
      ctx.outputs.vC = ctx.state[0];
      ctx.outputs.i = ctx.state[1];
    },
    derivatives: (ctx) => {
      const R = Math.max(0, num(ctx.parameters, 'R', 1));
      const L = clampPositive(num(ctx.parameters, 'L', 0.5));
      const C = clampPositive(num(ctx.parameters, 'C', 0.2));
      const V = ctx.inputs.V ?? 0;
      ctx.deriv[0] = ctx.state[1] / C;
      ctx.deriv[1] = (V - ctx.state[0] - R * ctx.state[1]) / L;
    },
  },
  {
    type: 'pneumatic_tank',
    category: 'Dynamics',
    name: 'Pneumatic Tank',
    description: 'Isothermal tank. C ṗ = q_in − q_out with capacitance C = V / (R_spec T).',
    renderer: 'sim',
    defaultParameters: { C: 0.02, p0: 1 },
    parameters: [
      numberField('C', 'Capacitance C', 'Pneumatic', 0.001, 'Volume / (R_spec · T) in consistent units'),
      numberField('p0', 'p(0)', 'Initial', 0.05),
    ],
    hasDirectFeedthrough: noFeed,
    ports: () => ({
      inputs: [
        { id: 'qin', name: 'qin' },
        { id: 'qout', name: 'qout' },
      ],
      outputs: [{ id: 'p', name: 'p' }],
    }),
    continuousStates: () => 1,
    discreteStates: none,
    init: (ctx) => {
      ctx.state[0] = num(ctx.parameters, 'p0', 1);
    },
    outputs: (ctx) => {
      ctx.outputs.p = ctx.state[0];
    },
    derivatives: (ctx) => {
      const C = clampPositive(num(ctx.parameters, 'C', 0.02));
      ctx.deriv[0] = ((ctx.inputs.qin ?? 0) - (ctx.inputs.qout ?? 0)) / C;
    },
  },
  {
    type: 'pneumatic_valve',
    category: 'Dynamics',
    name: 'Pneumatic Valve',
    description: 'Orifice flow q = Cd · sign(Δp) · √|Δp|. Opening scales Cd.',
    renderer: 'sim',
    defaultParameters: { Cd: 0.4 },
    parameters: [numberField('Cd', 'Discharge Cd', 'Pneumatic', 0.05)],
    hasDirectFeedthrough: feed,
    ports: () => ({
      inputs: [
        { id: 'p1', name: 'p1' },
        { id: 'p2', name: 'p2' },
        { id: 'open', name: 'open' },
      ],
      outputs: [{ id: 'q', name: 'q' }],
    }),
    continuousStates: none,
    discreteStates: none,
    outputs: (ctx) => {
      const Cd = Math.max(0, num(ctx.parameters, 'Cd', 0.4));
      const open = Math.max(0, Math.min(1, ctx.inputs.open ?? 1));
      const dp = (ctx.inputs.p1 ?? 0) - (ctx.inputs.p2 ?? 0);
      ctx.outputs.q = Cd * open * Math.sign(dp) * Math.sqrt(Math.abs(dp));
    },
  },
  {
    type: 'hydraulic_chamber',
    category: 'Dynamics',
    name: 'Hydraulic Chamber',
    description: 'Compressible hydraulic volume. (V/β) ṗ = q_in − q_out − A v.',
    renderer: 'sim',
    defaultParameters: { V: 1e-3, beta: 1.4e9, A: 0.002, p0: 1e6 },
    parameters: [
      numberField('V', 'Volume V', 'Hydraulic', 1e-4),
      numberField('beta', 'Bulk modulus β', 'Hydraulic', 1e7),
      numberField('A', 'Piston area A', 'Hydraulic', 1e-4),
      numberField('p0', 'p(0)', 'Initial', 1e5),
    ],
    hasDirectFeedthrough: noFeed,
    ports: () => ({
      inputs: [
        { id: 'qin', name: 'qin' },
        { id: 'qout', name: 'qout' },
        { id: 'v', name: 'v' },
      ],
      outputs: [{ id: 'p', name: 'p' }],
    }),
    continuousStates: () => 1,
    discreteStates: none,
    init: (ctx) => {
      ctx.state[0] = num(ctx.parameters, 'p0', 1e6);
    },
    outputs: (ctx) => {
      ctx.outputs.p = ctx.state[0];
    },
    derivatives: (ctx) => {
      const V = clampPositive(num(ctx.parameters, 'V', 1e-3));
      const beta = clampPositive(num(ctx.parameters, 'beta', 1.4e9), 1);
      const A = num(ctx.parameters, 'A', 0.002);
      const q = (ctx.inputs.qin ?? 0) - (ctx.inputs.qout ?? 0) - A * (ctx.inputs.v ?? 0);
      ctx.deriv[0] = (beta / V) * q;
    },
  },
  {
    type: 'thermal_mass',
    category: 'Dynamics',
    name: 'Thermal Mass',
    description: 'Lumped heat capacity. C Ṫ = Q_in − Q_out.',
    renderer: 'sim',
    defaultParameters: { C: 500, T0: 300 },
    parameters: [
      numberField('C', 'Heat capacity C', 'Thermal', 10),
      numberField('T0', 'T(0)', 'Initial', 1),
    ],
    hasDirectFeedthrough: noFeed,
    ports: () => ({
      inputs: [
        { id: 'Qin', name: 'Qin' },
        { id: 'Qout', name: 'Qout' },
      ],
      outputs: [{ id: 'T', name: 'T' }],
    }),
    continuousStates: () => 1,
    discreteStates: none,
    init: (ctx) => {
      ctx.state[0] = num(ctx.parameters, 'T0', 300);
    },
    outputs: (ctx) => {
      ctx.outputs.T = ctx.state[0];
    },
    derivatives: (ctx) => {
      const C = clampPositive(num(ctx.parameters, 'C', 500), 1e-6);
      ctx.deriv[0] = ((ctx.inputs.Qin ?? 0) - (ctx.inputs.Qout ?? 0)) / C;
    },
  },
  {
    type: 'conduction',
    category: 'Dynamics',
    name: 'Conduction',
    description: 'Heat flow Q = G · (T1 − T2).',
    renderer: 'sim',
    defaultParameters: { G: 10 },
    parameters: [numberField('G', 'Conductance G', 'Thermal', 0.5)],
    hasDirectFeedthrough: feed,
    ports: () => ({
      inputs: [
        { id: 'T1', name: 'T1' },
        { id: 'T2', name: 'T2' },
      ],
      outputs: [{ id: 'Q', name: 'Q' }],
    }),
    continuousStates: none,
    discreteStates: none,
    outputs: (ctx) => {
      ctx.outputs.Q = num(ctx.parameters, 'G', 10) * ((ctx.inputs.T1 ?? 0) - (ctx.inputs.T2 ?? 0));
    },
  },
  {
    type: 'stage',
    category: 'Sinks',
    name: 'Stage',
    description: 'Generic scene animator. Ports come from `inputs`; drawing comes from a JSON `scene` of boxes, links, disks, tanks, …',
    renderer: 'plant',
    defaultParameters: {
      inputs: 'x:mechanical,th1:mechanical,th2:mechanical,force:mechanical',
      scene:
        '[{"type":"ground"},{"type":"box","id":"cart","x":"$x","y":0,"w":0.72,"h":0.26,"color":"#8b97a8"},{"type":"link","id":"l1","from":"cart","angle":"$th1","length":0.4,"color":"#e7a23a"},{"type":"link","id":"l2","from":"l1","angle":"$th2","length":0.4,"color":"#5ec8ff"},{"type":"arrow","value":"$force"}]',
      trail: 'l2',
      scale: 140,
      nudge: 'Tip θ₁|1|0.12; Tip θ₂|2|-0.12; Shove cart|3|0.6',
      nudgePlant: '',
      readouts: 'x|x|number;θ₁|th1|deg;θ₂|th2|deg;F|force|number',
      control: 'Hand force|manual|-25|25',
      disturbance: 'Kick →|pulse|pulse|16; Kick ←|pulse|pulse|-16',
      interact: 'cart|nudge|3|0.5; l1|nudge|1|0.12; l2|nudge|2|-0.12; *|control',
    },
    parameters: [
      {
        key: 'inputs',
        label: 'Input ports',
        type: 'string',
        wide: true,
        group: 'Stage',
        help: 'Comma list: name or name:domain. Example: x:mechanical,th1:mechanical,force:mechanical',
      },
      {
        key: 'scene',
        label: 'Scene JSON',
        type: 'string',
        wide: true,
        group: 'Stage',
        help: 'Array of elements: ground, box, link, disk, tank, piston, springmass, arrow. Use $port for bindings.',
      },
      { key: 'trail', label: 'Trail element id', type: 'string', group: 'Stage' },
      numberField('scale', 'Scale (px / unit)', 'Stage', 10),
      {
        key: 'control',
        label: 'User control',
        type: 'string',
        wide: true,
        group: 'Interact',
        help: 'label|manualBlockId|min|max  (append |hold to keep value on release). Drives Dock slider, ←/→ keys, and canvas drag.',
      },
      {
        key: 'disturbance',
        label: 'Disturbances',
        type: 'string',
        wide: true,
        group: 'Interact',
        help: 'label|pulse|blockId|amp; … or label|nudge|stateIndex|amount',
      },
      {
        key: 'interact',
        label: 'Canvas hits',
        type: 'string',
        wide: true,
        group: 'Interact',
        help: 'elementId|nudge|index|amount; *|control — click links/boxes to kick state, drag empty stage for control.',
      },
      {
        key: 'nudge',
        label: 'Nudge buttons',
        type: 'string',
        wide: true,
        group: 'Interact',
        help: 'label|stateIndex|amount; … applied to the nudge plant’s continuous state / x0',
      },
      {
        key: 'nudgePlant',
        label: 'Nudge plant id',
        type: 'string',
        group: 'Interact',
        help: 'Block id or role. Empty = first Dynamics plant on the diagram.',
      },
      {
        key: 'readouts',
        label: 'Readouts',
        type: 'string',
        wide: true,
        group: 'Stage',
        help: 'label|port|number|deg; …',
      },
    ],
    hasDirectFeedthrough: noFeed,
    ports: (p) => ({ inputs: parseStageConfig(p).inputs, outputs: [] }),
    continuousStates: none,
    discreteStates: none,
    outputs: () => undefined,
  },
];

