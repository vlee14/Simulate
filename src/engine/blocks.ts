import { compileExpression, expressionInputCount } from './expr';
import { pendulumDerivatives, readPendulumParams } from './physics';
import { BlockContext, BlockDefinition, Param, ParamSpec, PortDef } from './types';

function num(p: Record<string, Param>, key: string, fallback = 0): number {
  const v = Number(p[key]);
  return Number.isFinite(v) ? v : fallback;
}

function text(p: Record<string, Param>, key: string, fallback = ''): string {
  const v = p[key];
  return v === undefined ? fallback : String(v);
}

function on(p: Record<string, Param>, key: string): boolean {
  return p[key] === true || p[key] === 'true';
}

function scalarIn(name = 'in', label = 'in'): PortDef[] {
  return [{ id: name, name: label }];
}
function scalarOut(): PortDef[] {
  return [{ id: 'out', name: 'out' }];
}

function parseList(raw: string): number[] {
  const parts = raw
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  if (parts.length === 0 || parts.some((v) => !Number.isFinite(v))) {
    throw new Error(`Could not parse coefficients "${raw}"`);
  }
  let i = 0;
  while (i < parts.length - 1 && Math.abs(parts[i]) < 1e-15) i++;
  return parts.slice(i);
}

function parseMatrix(raw: string): number[][] {
  const rows = raw
    .split(';')
    .map((row) => row.trim())
    .filter((row) => row.length > 0)
    .map((row) => row.split(/[\s,]+/).filter(Boolean).map(Number));
  if (rows.length === 0 || rows.some((row) => row.length === 0 || row.some((v) => !Number.isFinite(v)))) {
    throw new Error(`Could not parse matrix "${raw}"`);
  }
  const width = rows[0].length;
  if (rows.some((row) => row.length !== width)) throw new Error('Matrix rows have different lengths');
  return rows;
}

const matrixCache = new Map<string, number[][]>();
function matrix(raw: string): number[][] {
  const hit = matrixCache.get(raw);
  if (hit) return hit;
  const parsed = parseMatrix(raw);
  matrixCache.set(raw, parsed);
  return parsed;
}

interface Realization {
  a: number[];
  b: number[];
  D: number;
  n: number;
}

function realize(numText: string, denText: string): Realization {
  let num = parseList(numText);
  let den = parseList(denText);
  if (Math.abs(den[0]) < 1e-15) throw new Error('Denominator leading coefficient is zero');
  const lead = den[0];
  num = num.map((v) => v / lead);
  den = den.map((v) => v / lead);
  if (num.length - 1 > den.length - 1) throw new Error('Transfer function must be proper');
  while (num.length < den.length) num.unshift(0);
  const n = den.length - 1;
  const D = num[0];
  const a = new Array(n).fill(0);
  const b = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    a[i] = den[i + 1];
    b[i] = num[i + 1] - D * den[i + 1];
  }
  return { a, b, D, n };
}

const tfCache = new Map<string, Realization>();
function tfOf(numText: string, denText: string): Realization {
  const key = `${numText}|${denText}`;
  const hit = tfCache.get(key);
  if (hit) return hit;
  const realized = realize(numText, denText);
  tfCache.set(key, realized);
  return realized;
}

function ssOf(p: Record<string, Param>) {
  const A = matrix(text(p, 'A', '0'));
  const B = matrix(text(p, 'B', '1'));
  const C = matrix(text(p, 'C', '1'));
  const D = matrix(text(p, 'D', '0'));
  const n = A.length;
  if (A.some((row) => row.length !== n)) throw new Error('A must be square');
  if (B.length !== n) throw new Error('B must have the same row count as A');
  const m = B[0].length;
  const outputs = C.length;
  if (C.some((row) => row.length !== n)) throw new Error('C must have one column per state');
  if (D.length !== outputs || D.some((row) => row.length !== m)) throw new Error('D must be outputs × inputs');
  return { A, B, C, D, n, m, outputs };
}

function signsOf(p: Record<string, Param>): string {
  const clean = text(p, 'signs', '+').replace(/[^+\-]/g, '');
  return (clean.length ? clean : '+').slice(0, 8);
}

function opsOf(p: Record<string, Param>): string {
  const clean = text(p, 'operators', '**').replace(/[^*/]/g, '');
  return (clean.length ? clean : '*').slice(0, 8);
}

function indexedPorts(ids: string[], prefix: string): PortDef[] {
  return ids.map((id, i) => ({ id, name: `${prefix}${i + 1}` }));
}

const exprCache = new Map<string, (vars: Record<string, number>) => number>();
function runExpr(source: string, vars: Record<string, number>): number {
  let fn = exprCache.get(source);
  if (!fn) {
    fn = compileExpression(source);
    exprCache.set(source, fn);
  }
  return fn(vars);
}

const none = () => 0;
const noFeed = () => false;
const feed = () => true;
const io = (inputs: PortDef[], outputs: PortDef[] = scalarOut()) => () => ({ inputs, outputs });

const numberField = (key: string, label: string, group?: string, step = 0.1, help?: string): ParamSpec => ({
  key,
  label,
  type: 'number',
  group,
  step,
  help,
});

export const BLOCKS: BlockDefinition[] = [
  {
    type: 'constant',
    category: 'Sources',
    name: 'Constant',
    description: 'A fixed value',
    renderer: 'sim',
    defaultParameters: { value: 1 },
    parameters: [numberField('value', 'Value', undefined, 0.1)],
    hasDirectFeedthrough: noFeed,
    ports: io([]),
    continuousStates: none,
    discreteStates: none,
    outputs: (ctx) => {
      ctx.outputs.out = num(ctx.parameters, 'value', 0);
    },
  },
  {
    type: 'manual',
    category: 'Sources',
    name: 'Manual',
    description: 'A live slider source for nudging a model while it runs',
    renderer: 'sim',
    defaultParameters: { value: 0, min: -20, max: 20 },
    parameters: [
      numberField('value', 'Value', undefined, 0.1),
      numberField('min', 'Slider min', undefined, 1),
      numberField('max', 'Slider max', undefined, 1),
    ],
    hasDirectFeedthrough: noFeed,
    ports: io([]),
    continuousStates: none,
    discreteStates: none,
    outputs: (ctx) => {
      ctx.outputs.out = num(ctx.parameters, 'value', 0);
    },
  },
  {
    type: 'step',
    category: 'Sources',
    name: 'Step',
    description: 'Jumps from one value to another at a given time',
    renderer: 'sim',
    defaultParameters: { stepTime: 1, initialValue: 0, finalValue: 1 },
    parameters: [
      numberField('stepTime', 'Step time (s)', undefined, 0.1),
      numberField('initialValue', 'Initial value'),
      numberField('finalValue', 'Final value'),
    ],
    hasDirectFeedthrough: noFeed,
    ports: io([]),
    continuousStates: none,
    discreteStates: none,
    outputs: (ctx) => {
      ctx.outputs.out =
        ctx.t >= num(ctx.parameters, 'stepTime', 1)
          ? num(ctx.parameters, 'finalValue', 1)
          : num(ctx.parameters, 'initialValue', 0);
    },
  },
  {
    type: 'sine',
    category: 'Sources',
    name: 'Sine',
    description: 'A sinusoid, frequency in hertz',
    renderer: 'sim',
    defaultParameters: { amplitude: 1, frequency: 0.5, phase: 0, bias: 0 },
    parameters: [
      numberField('amplitude', 'Amplitude'),
      numberField('frequency', 'Frequency (Hz)', undefined, 0.1),
      numberField('phase', 'Phase (rad)', undefined, 0.1),
      numberField('bias', 'Bias'),
    ],
    hasDirectFeedthrough: noFeed,
    ports: io([]),
    continuousStates: none,
    discreteStates: none,
    outputs: (ctx) => {
      const w = 2 * Math.PI * num(ctx.parameters, 'frequency', 0.5);
      ctx.outputs.out =
        num(ctx.parameters, 'amplitude', 1) * Math.sin(w * ctx.t + num(ctx.parameters, 'phase', 0)) +
        num(ctx.parameters, 'bias', 0);
    },
  },
  {
    type: 'ramp',
    category: 'Sources',
    name: 'Ramp',
    description: 'A signal that grows linearly after a start time',
    renderer: 'sim',
    defaultParameters: { slope: 1, startTime: 0, initialOutput: 0 },
    parameters: [
      numberField('slope', 'Slope'),
      numberField('startTime', 'Start time (s)', undefined, 0.1),
      numberField('initialOutput', 'Initial output'),
    ],
    hasDirectFeedthrough: noFeed,
    ports: io([]),
    continuousStates: none,
    discreteStates: none,
    outputs: (ctx) => {
      const t0 = num(ctx.parameters, 'startTime', 0);
      const y0 = num(ctx.parameters, 'initialOutput', 0);
      ctx.outputs.out = ctx.t < t0 ? y0 : y0 + num(ctx.parameters, 'slope', 1) * (ctx.t - t0);
    },
  },
  {
    type: 'pulse',
    category: 'Sources',
    name: 'Pulse',
    description: 'A single pulse, or a train when period is positive',
    renderer: 'sim',
    defaultParameters: { amplitude: 1, delay: 1, width: 0.2, period: 0 },
    parameters: [
      numberField('amplitude', 'Amplitude'),
      numberField('delay', 'Delay (s)', undefined, 0.1),
      numberField('width', 'Width (s)', undefined, 0.05),
      numberField('period', 'Period (s, 0 = once)', undefined, 0.1),
    ],
    hasDirectFeedthrough: noFeed,
    ports: io([]),
    continuousStates: none,
    discreteStates: none,
    outputs: (ctx) => {
      const delay = num(ctx.parameters, 'delay', 0);
      const width = Math.max(0, num(ctx.parameters, 'width', 0.2));
      const period = num(ctx.parameters, 'period', 0);
      const amp = num(ctx.parameters, 'amplitude', 1);
      if (ctx.t < delay) {
        ctx.outputs.out = 0;
        return;
      }
      const elapsed = ctx.t - delay;
      if (period <= 0) {
        ctx.outputs.out = elapsed < width ? amp : 0;
        return;
      }
      const tau = elapsed % period;
      ctx.outputs.out = tau < width ? amp : 0;
    },
  },
  {
    type: 'clock',
    category: 'Sources',
    name: 'Clock',
    description: 'Outputs the current simulation time',
    renderer: 'sim',
    defaultParameters: {},
    parameters: [],
    hasDirectFeedthrough: noFeed,
    ports: io([]),
    continuousStates: none,
    discreteStates: none,
    outputs: (ctx) => {
      ctx.outputs.out = ctx.t;
    },
  },
  {
    type: 'gain',
    category: 'Math',
    name: 'Gain',
    description: 'Multiplies by a constant',
    renderer: 'sim',
    defaultParameters: { k: 1 },
    parameters: [numberField('k', 'Gain', undefined, 0.1)],
    hasDirectFeedthrough: feed,
    ports: io(scalarIn()),
    continuousStates: none,
    discreteStates: none,
    outputs: (ctx) => {
      ctx.outputs.out = num(ctx.parameters, 'k', 1) * (ctx.inputs.in ?? 0);
    },
  },
  {
    type: 'sum',
    category: 'Math',
    name: 'Sum',
    description: 'Adds or subtracts inputs. Signs are + and −, one per input.',
    renderer: 'sim',
    defaultParameters: { signs: '+-' },
    parameters: [{ key: 'signs', label: 'Signs', type: 'string', help: 'One + or − per input, for example +−+' }],
    hasDirectFeedthrough: feed,
    ports: (p) => ({
      inputs: indexedPorts(
        signsOf(p)
          .split('')
          .map((_, i) => `in${i}`),
        ''
      ).map((port, i) => ({ ...port, name: signsOf(p)[i] === '-' ? '−' : '+' })),
      outputs: scalarOut(),
    }),
    continuousStates: none,
    discreteStates: none,
    outputs: (ctx) => {
      const signs = signsOf(ctx.parameters);
      let y = 0;
      for (let i = 0; i < signs.length; i++) {
        const u = ctx.inputs[`in${i}`] ?? 0;
        y += signs[i] === '-' ? -u : u;
      }
      ctx.outputs.out = y;
    },
  },
  {
    type: 'product',
    category: 'Math',
    name: 'Product',
    description: 'Multiplies or divides inputs. Operators are * and /.',
    renderer: 'sim',
    defaultParameters: { operators: '**' },
    parameters: [{ key: 'operators', label: 'Operators', type: 'string', help: 'One * or / per input' }],
    hasDirectFeedthrough: feed,
    ports: (p) => ({
      inputs: opsOf(p)
        .split('')
        .map((op, i) => ({ id: `in${i}`, name: op })),
      outputs: scalarOut(),
    }),
    continuousStates: none,
    discreteStates: none,
    outputs: (ctx) => {
      const ops = opsOf(ctx.parameters);
      let y = 1;
      for (let i = 0; i < ops.length; i++) {
        const u = ctx.inputs[`in${i}`] ?? 0;
        if (ops[i] === '/') y = u === 0 ? 0 : y / u;
        else y *= u;
      }
      ctx.outputs.out = y;
    },
  },
  {
    type: 'bias',
    category: 'Math',
    name: 'Bias',
    description: 'Adds a constant offset',
    renderer: 'sim',
    defaultParameters: { bias: 0 },
    parameters: [numberField('bias', 'Bias')],
    hasDirectFeedthrough: feed,
    ports: io(scalarIn()),
    continuousStates: none,
    discreteStates: none,
    outputs: (ctx) => {
      ctx.outputs.out = (ctx.inputs.in ?? 0) + num(ctx.parameters, 'bias', 0);
    },
  },
  {
    type: 'math',
    category: 'Math',
    name: 'Math',
    description: 'A unary function',
    renderer: 'sim',
    defaultParameters: { fn: 'sin' },
    parameters: [
      {
        key: 'fn',
        label: 'Function',
        type: 'select',
        options: ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'abs', 'sqrt', 'square', 'exp', 'ln', 'sign', 'neg'].map(
          (value) => ({ value, label: value })
        ),
      },
    ],
    hasDirectFeedthrough: feed,
    ports: io(scalarIn()),
    continuousStates: none,
    discreteStates: none,
    outputs: (ctx) => {
      const u = ctx.inputs.in ?? 0;
      switch (text(ctx.parameters, 'fn', 'sin')) {
        case 'sin':
          ctx.outputs.out = Math.sin(u);
          break;
        case 'cos':
          ctx.outputs.out = Math.cos(u);
          break;
        case 'tan':
          ctx.outputs.out = Math.tan(u);
          break;
        case 'asin':
          ctx.outputs.out = Math.asin(Math.max(-1, Math.min(1, u)));
          break;
        case 'acos':
          ctx.outputs.out = Math.acos(Math.max(-1, Math.min(1, u)));
          break;
        case 'atan':
          ctx.outputs.out = Math.atan(u);
          break;
        case 'abs':
          ctx.outputs.out = Math.abs(u);
          break;
        case 'sqrt':
          ctx.outputs.out = Math.sqrt(Math.max(0, u));
          break;
        case 'square':
          ctx.outputs.out = u * u;
          break;
        case 'exp':
          ctx.outputs.out = Math.exp(u);
          break;
        case 'ln':
          ctx.outputs.out = Math.log(Math.max(1e-15, u));
          break;
        case 'sign':
          ctx.outputs.out = Math.sign(u);
          break;
        case 'neg':
          ctx.outputs.out = -u;
          break;
        default:
          ctx.outputs.out = u;
      }
    },
  },
  {
    type: 'fcn',
    category: 'Math',
    name: 'Fcn',
    description: 'An expression in u1…u8 and t. Try -k*u1 or sin(u1)+u2.',
    renderer: 'sim',
    defaultParameters: { expr: '-u1' },
    parameters: [
      {
        key: 'expr',
        label: 'Expression',
        type: 'string',
        wide: true,
        help: 'Variables u, u1…u8, t. Functions sin, cos, abs, sqrt, min, max, atan2.',
      },
    ],
    hasDirectFeedthrough: feed,
    ports: (p) => {
      const n = expressionInputCount(text(p, 'expr', 'u'));
      return {
        inputs: Array.from({ length: n }, (_, i) => ({ id: `u${i + 1}`, name: `u${i + 1}` })),
        outputs: scalarOut(),
      };
    },
    continuousStates: none,
    discreteStates: none,
    outputs: (ctx) => {
      const source = text(ctx.parameters, 'expr', 'u');
      const n = expressionInputCount(source);
      const vars: Record<string, number> = { t: ctx.t };
      for (let i = 1; i <= n; i++) vars[`u${i}`] = ctx.inputs[`u${i}`] ?? 0;
      vars.u = vars.u1 ?? 0;
      ctx.outputs.out = runExpr(source, vars);
    },
  },
  {
    type: 'integrator',
    category: 'Continuous',
    name: 'Integrator',
    description: 'Integrates the input. y = ∫ u dt. No direct feedthrough.',
    renderer: 'sim',
    defaultParameters: { initialCondition: 0, limitOutput: false, upperLimit: 10, lowerLimit: -10 },
    parameters: [
      numberField('initialCondition', 'Initial condition', 'State'),
      { key: 'limitOutput', label: 'Limit output', type: 'boolean', group: 'State' },
      numberField('upperLimit', 'Upper limit', 'State'),
      numberField('lowerLimit', 'Lower limit', 'State'),
    ],
    hasDirectFeedthrough: noFeed,
    ports: io(scalarIn()),
    continuousStates: () => 1,
    discreteStates: none,
    init: (ctx) => {
      ctx.state[0] = num(ctx.parameters, 'initialCondition', 0);
    },
    outputs: (ctx) => {
      let y = ctx.state[0];
      if (on(ctx.parameters, 'limitOutput')) {
        y = Math.min(num(ctx.parameters, 'upperLimit', 10), Math.max(num(ctx.parameters, 'lowerLimit', -10), y));
      }
      ctx.outputs.out = y;
    },
    derivatives: (ctx) => {
      let u = ctx.inputs.in ?? 0;
      if (on(ctx.parameters, 'limitOutput')) {
        const hi = num(ctx.parameters, 'upperLimit', 10);
        const lo = num(ctx.parameters, 'lowerLimit', -10);
        if (ctx.state[0] >= hi && u > 0) u = 0;
        if (ctx.state[0] <= lo && u < 0) u = 0;
      }
      ctx.deriv[0] = u;
    },
  },
  {
    type: 'derivative',
    category: 'Continuous',
    name: 'Derivative',
    description: 'Band-limited derivative, s / (τs + 1)',
    renderer: 'sim',
    defaultParameters: { tau: 0.02 },
    parameters: [numberField('tau', 'Time constant τ', undefined, 0.01, 'Smaller follows faster and gets noisier')],
    hasDirectFeedthrough: feed,
    ports: io(scalarIn()),
    continuousStates: () => 1,
    discreteStates: none,
    outputs: (ctx) => {
      const tau = Math.max(1e-4, num(ctx.parameters, 'tau', 0.02));
      ctx.outputs.out = ((ctx.inputs.in ?? 0) - ctx.state[0]) / tau;
    },
    derivatives: (ctx) => {
      const tau = Math.max(1e-4, num(ctx.parameters, 'tau', 0.02));
      ctx.deriv[0] = ((ctx.inputs.in ?? 0) - ctx.state[0]) / tau;
    },
  },
  {
    type: 'pid',
    category: 'Continuous',
    name: 'PID',
    description: 'Parallel PID with a filtered derivative',
    renderer: 'sim',
    defaultParameters: { Kp: 1, Ki: 0, Kd: 0, Tf: 0.05, limitOutput: false, upperLimit: 20, lowerLimit: -20 },
    parameters: [
      numberField('Kp', 'Kp', 'Gains'),
      numberField('Ki', 'Ki', 'Gains'),
      numberField('Kd', 'Kd', 'Gains'),
      numberField('Tf', 'Derivative filter Tf', 'Gains', 0.01),
      { key: 'limitOutput', label: 'Limit output', type: 'boolean', group: 'Limits' },
      numberField('upperLimit', 'Upper', 'Limits'),
      numberField('lowerLimit', 'Lower', 'Limits'),
    ],
    hasDirectFeedthrough: feed,
    ports: io([{ id: 'in', name: 'e' }]),
    continuousStates: () => 2,
    discreteStates: none,
    outputs: (ctx) => {
      const e = ctx.inputs.in ?? 0;
      const Tf = Math.max(1e-4, num(ctx.parameters, 'Tf', 0.05));
      let y =
        num(ctx.parameters, 'Kp', 1) * e +
        num(ctx.parameters, 'Ki', 0) * ctx.state[0] +
        (num(ctx.parameters, 'Kd', 0) / Tf) * (e - ctx.state[1]);
      if (on(ctx.parameters, 'limitOutput')) {
        y = Math.min(num(ctx.parameters, 'upperLimit', 20), Math.max(num(ctx.parameters, 'lowerLimit', -20), y));
      }
      ctx.outputs.out = y;
    },
    derivatives: (ctx) => {
      const e = ctx.inputs.in ?? 0;
      const Tf = Math.max(1e-4, num(ctx.parameters, 'Tf', 0.05));
      let iDot = e;
      if (on(ctx.parameters, 'limitOutput')) {
        const yRaw =
          num(ctx.parameters, 'Kp', 1) * e +
          num(ctx.parameters, 'Ki', 0) * ctx.state[0] +
          (num(ctx.parameters, 'Kd', 0) / Tf) * (e - ctx.state[1]);
        const hi = num(ctx.parameters, 'upperLimit', 20);
        const lo = num(ctx.parameters, 'lowerLimit', -20);
        if ((yRaw >= hi && e > 0) || (yRaw <= lo && e < 0)) iDot = 0;
      }
      ctx.deriv[0] = iDot;
      ctx.deriv[1] = (e - ctx.state[1]) / Tf;
    },
  },
  {
    type: 'transfer',
    category: 'Continuous',
    name: 'Transfer Fcn',
    description: 'Proper H(s). Coefficients are highest power first.',
    renderer: 'sim',
    defaultParameters: { numerator: '1', denominator: '1 1' },
    parameters: [
      { key: 'numerator', label: 'Numerator', type: 'string', wide: true, help: 'Example: 1' },
      { key: 'denominator', label: 'Denominator', type: 'string', wide: true, help: 'Example: 1 2 1 for s² + 2s + 1' },
    ],
    hasDirectFeedthrough: (p) => {
      try {
        return Math.abs(tfOf(text(p, 'numerator', '1'), text(p, 'denominator', '1 1')).D) > 1e-12;
      } catch {
        return true;
      }
    },
    ports: io(scalarIn()),
    continuousStates: (p) => {
      try {
        return tfOf(text(p, 'numerator', '1'), text(p, 'denominator', '1 1')).n;
      } catch {
        return 1;
      }
    },
    discreteStates: none,
    outputs: (ctx) => {
      const tf = tfOf(text(ctx.parameters, 'numerator', '1'), text(ctx.parameters, 'denominator', '1 1'));
      let y = tf.D * (ctx.inputs.in ?? 0);
      for (let i = 0; i < tf.n; i++) y += tf.b[i] * ctx.state[i];
      ctx.outputs.out = y;
    },
    derivatives: (ctx) => {
      const tf = tfOf(text(ctx.parameters, 'numerator', '1'), text(ctx.parameters, 'denominator', '1 1'));
      if (tf.n === 0) return;
      let acc = ctx.inputs.in ?? 0;
      for (let i = 0; i < tf.n; i++) acc -= tf.a[i] * ctx.state[i];
      ctx.deriv[0] = acc;
      for (let i = 1; i < tf.n; i++) ctx.deriv[i] = ctx.state[i - 1];
    },
  },
  {
    type: 'statespace',
    category: 'Continuous',
    name: 'State-Space',
    description: 'ẋ = Ax + Bu, y = Cx + Du. Rows are separated by semicolons.',
    renderer: 'sim',
    defaultParameters: { A: '0 1; -1 -0.4', B: '0; 1', C: '1 0', D: '0', x0: '0 0' },
    parameters: [
      { key: 'A', label: 'A', type: 'string', wide: true, group: 'Matrices' },
      { key: 'B', label: 'B', type: 'string', wide: true, group: 'Matrices' },
      { key: 'C', label: 'C', type: 'string', wide: true, group: 'Matrices' },
      { key: 'D', label: 'D', type: 'string', wide: true, group: 'Matrices' },
      { key: 'x0', label: 'Initial state', type: 'string', wide: true, group: 'Matrices' },
    ],
    hasDirectFeedthrough: (p) => {
      try {
        return ssOf(p).D.some((row) => row.some((v) => Math.abs(v) > 1e-12));
      } catch {
        return true;
      }
    },
    ports: (p) => {
      try {
        const ss = ssOf(p);
        return {
          inputs: Array.from({ length: ss.m }, (_, i) => ({ id: `u${i}`, name: ss.m === 1 ? 'u' : `u${i + 1}` })),
          outputs: Array.from({ length: ss.outputs }, (_, i) => ({
            id: `y${i}`,
            name: ss.outputs === 1 ? 'y' : `y${i + 1}`,
          })),
        };
      } catch {
        return { inputs: [{ id: 'u0', name: 'u' }], outputs: [{ id: 'y0', name: 'y' }] };
      }
    },
    continuousStates: (p) => {
      try {
        return ssOf(p).n;
      } catch {
        return 1;
      }
    },
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
      const ss = ssOf(ctx.parameters);
      const u = ssInputs(ctx, ss.m);
      for (let i = 0; i < ss.outputs; i++) {
        let y = 0;
        for (let j = 0; j < ss.n; j++) y += ss.C[i][j] * ctx.state[j];
        for (let j = 0; j < ss.m; j++) y += ss.D[i][j] * u[j];
        ctx.outputs[`y${i}`] = y;
      }
    },
    derivatives: (ctx) => {
      const ss = ssOf(ctx.parameters);
      const u = ssInputs(ctx, ss.m);
      for (let i = 0; i < ss.n; i++) {
        let d = 0;
        for (let j = 0; j < ss.n; j++) d += ss.A[i][j] * ctx.state[j];
        for (let j = 0; j < ss.m; j++) d += ss.B[i][j] * u[j];
        ctx.deriv[i] = d;
      }
    },
  },
  {
    type: 'delay',
    category: 'Discrete',
    name: 'Unit Delay',
    description: 'Holds the input for one sample. Breaks discrete algebraic loops.',
    renderer: 'sim',
    defaultParameters: { sampleTime: 0.01, initialOutput: 0 },
    parameters: [
      numberField('sampleTime', 'Sample time (s)', undefined, 0.01),
      numberField('initialOutput', 'Initial output'),
    ],
    hasDirectFeedthrough: noFeed,
    ports: io(scalarIn()),
    continuousStates: none,
    discreteStates: () => 1,
    init: (ctx) => {
      ctx.discrete[0] = num(ctx.parameters, 'initialOutput', 0);
    },
    outputs: (ctx) => {
      ctx.outputs.out = ctx.discrete[0];
    },
    updateDiscrete: (ctx) => {
      ctx.discrete[0] = ctx.inputs.in ?? 0;
    },
  },
  {
    type: 'zoh',
    category: 'Discrete',
    name: 'Zero-Order Hold',
    description: 'Samples the input and holds it. One solver step of delay.',
    renderer: 'sim',
    defaultParameters: { sampleTime: 0.01, initialOutput: 0 },
    parameters: [
      numberField('sampleTime', 'Sample time (s)', undefined, 0.01),
      numberField('initialOutput', 'Initial output'),
    ],
    hasDirectFeedthrough: noFeed,
    ports: io(scalarIn()),
    continuousStates: none,
    discreteStates: () => 1,
    init: (ctx) => {
      ctx.discrete[0] = num(ctx.parameters, 'initialOutput', 0);
    },
    outputs: (ctx) => {
      ctx.outputs.out = ctx.discrete[0];
    },
    updateDiscrete: (ctx) => {
      ctx.discrete[0] = ctx.inputs.in ?? 0;
    },
  },
  {
    type: 'saturation',
    category: 'Nonlinear',
    name: 'Saturation',
    description: 'Clips a signal to an interval',
    renderer: 'sim',
    defaultParameters: { upperLimit: 20, lowerLimit: -20 },
    parameters: [numberField('upperLimit', 'Upper'), numberField('lowerLimit', 'Lower')],
    hasDirectFeedthrough: feed,
    ports: io(scalarIn()),
    continuousStates: none,
    discreteStates: none,
    outputs: (ctx) => {
      const u = ctx.inputs.in ?? 0;
      ctx.outputs.out = Math.min(num(ctx.parameters, 'upperLimit', 20), Math.max(num(ctx.parameters, 'lowerLimit', -20), u));
    },
  },
  {
    type: 'deadzone',
    category: 'Nonlinear',
    name: 'Dead Zone',
    description: 'Zeros the signal between the lower and upper bounds',
    renderer: 'sim',
    defaultParameters: { lower: -0.1, upper: 0.1 },
    parameters: [numberField('lower', 'Lower', undefined, 0.05), numberField('upper', 'Upper', undefined, 0.05)],
    hasDirectFeedthrough: feed,
    ports: io(scalarIn()),
    continuousStates: none,
    discreteStates: none,
    outputs: (ctx) => {
      const u = ctx.inputs.in ?? 0;
      const lo = num(ctx.parameters, 'lower', -0.1);
      const hi = num(ctx.parameters, 'upper', 0.1);
      if (u > hi) ctx.outputs.out = u - hi;
      else if (u < lo) ctx.outputs.out = u - lo;
      else ctx.outputs.out = 0;
    },
  },
  {
    type: 'switch',
    category: 'Nonlinear',
    name: 'Switch',
    description: 'Passes the first input when the control input meets the threshold, otherwise the third',
    renderer: 'sim',
    defaultParameters: { threshold: 0, criteria: '>=' },
    parameters: [
      numberField('threshold', 'Threshold'),
      {
        key: 'criteria',
        label: 'Criteria',
        type: 'select',
        options: [
          { value: '>=', label: 'u2 ≥ threshold' },
          { value: '>', label: 'u2 > threshold' },
        ],
      },
    ],
    hasDirectFeedthrough: feed,
    ports: () => ({
      inputs: [
        { id: 'u1', name: 'u1' },
        { id: 'u2', name: 'u2' },
        { id: 'u3', name: 'u3' },
      ],
      outputs: scalarOut(),
    }),
    continuousStates: none,
    discreteStates: none,
    outputs: (ctx) => {
      const thr = num(ctx.parameters, 'threshold', 0);
      const u2 = ctx.inputs.u2 ?? 0;
      const pass = text(ctx.parameters, 'criteria', '>=') === '>' ? u2 > thr : u2 >= thr;
      ctx.outputs.out = pass ? ctx.inputs.u1 ?? 0 : ctx.inputs.u3 ?? 0;
    },
  },
  {
    type: 'minmax',
    category: 'Nonlinear',
    name: 'Min / Max',
    description: 'The smaller or larger of two inputs',
    renderer: 'sim',
    defaultParameters: { mode: 'max' },
    parameters: [
      {
        key: 'mode',
        label: 'Mode',
        type: 'select',
        options: [
          { value: 'min', label: 'Min' },
          { value: 'max', label: 'Max' },
        ],
      },
    ],
    hasDirectFeedthrough: feed,
    ports: () => ({
      inputs: [
        { id: 'u1', name: 'u1' },
        { id: 'u2', name: 'u2' },
      ],
      outputs: scalarOut(),
    }),
    continuousStates: none,
    discreteStates: none,
    outputs: (ctx) => {
      const a = ctx.inputs.u1 ?? 0;
      const b = ctx.inputs.u2 ?? 0;
      ctx.outputs.out = text(ctx.parameters, 'mode', 'max') === 'min' ? Math.min(a, b) : Math.max(a, b);
    },
  },
  {
    type: 'pendulum',
    category: 'Plants',
    name: 'Double Pendulum',
    description: 'Cart with two inverted pendulums. Angles are measured from upright.',
    renderer: 'plant',
    defaultParameters: {
      M: 1,
      m1: 0.25,
      m2: 0.25,
      l1: 0.4,
      l2: 0.4,
      g: 9.81,
      b: 0.15,
      c1: 0.002,
      c2: 0.002,
      x0: 0,
      th1_0: 0.18,
      th2_0: -0.12,
      dx0: 0,
      w1_0: 0,
      w2_0: 0,
    },
    parameters: [
      numberField('M', 'Cart mass M (kg)', 'Masses', 0.05),
      numberField('m1', 'Link 1 mass (kg)', 'Masses', 0.05),
      numberField('m2', 'Link 2 mass (kg)', 'Masses', 0.05),
      numberField('l1', 'Link 1 length (m)', 'Geometry', 0.05),
      numberField('l2', 'Link 2 length (m)', 'Geometry', 0.05),
      numberField('g', 'Gravity (m/s²)', 'Geometry', 0.1),
      numberField('b', 'Cart friction', 'Damping', 0.01),
      numberField('c1', 'Joint 1 damping', 'Damping', 0.001),
      numberField('c2', 'Joint 2 damping', 'Damping', 0.001),
      numberField('x0', 'Cart position x₀', 'Initial conditions', 0.05),
      numberField('dx0', 'Cart velocity', 'Initial conditions', 0.05),
      numberField('th1_0', 'θ₁ (rad)', 'Initial conditions', 0.01),
      numberField('w1_0', 'ω₁ (rad/s)', 'Initial conditions', 0.05),
      numberField('th2_0', 'θ₂ (rad)', 'Initial conditions', 0.01),
      numberField('w2_0', 'ω₂ (rad/s)', 'Initial conditions', 0.05),
    ],
    hasDirectFeedthrough: noFeed,
    ports: () => ({
      inputs: [{ id: 'force', name: 'F' }],
      outputs: [
        { id: 'x', name: 'x' },
        { id: 'dx', name: 'ẋ' },
        { id: 'th1', name: 'θ₁' },
        { id: 'w1', name: 'ω₁' },
        { id: 'th2', name: 'θ₂' },
        { id: 'w2', name: 'ω₂' },
      ],
    }),
    continuousStates: () => 6,
    discreteStates: none,
    init: (ctx) => {
      ctx.state[0] = num(ctx.parameters, 'x0', 0);
      ctx.state[1] = num(ctx.parameters, 'th1_0', 0);
      ctx.state[2] = num(ctx.parameters, 'th2_0', 0);
      ctx.state[3] = num(ctx.parameters, 'dx0', 0);
      ctx.state[4] = num(ctx.parameters, 'w1_0', 0);
      ctx.state[5] = num(ctx.parameters, 'w2_0', 0);
    },
    outputs: (ctx) => {
      ctx.outputs.x = ctx.state[0];
      ctx.outputs.th1 = ctx.state[1];
      ctx.outputs.th2 = ctx.state[2];
      ctx.outputs.dx = ctx.state[3];
      ctx.outputs.w1 = ctx.state[4];
      ctx.outputs.w2 = ctx.state[5];
    },
    derivatives: (ctx) => {
      pendulumDerivatives(ctx.state, ctx.inputs.force ?? 0, readPendulumParams(ctx.parameters), ctx.deriv);
    },
  },
  {
    type: 'scope',
    category: 'Sinks',
    name: 'Scope',
    description: 'Time traces of one or more signals',
    renderer: 'scope',
    defaultParameters: { inputCount: 2, timeSpan: 12, autoScale: true, yMin: -1, yMax: 1 },
    parameters: [
      numberField('inputCount', 'Channels', 'Display', 1),
      numberField('timeSpan', 'Time span (s)', 'Display', 0.5),
      { key: 'autoScale', label: 'Auto scale', type: 'boolean', group: 'Display' },
      numberField('yMin', 'Y min', 'Display', 0.1),
      numberField('yMax', 'Y max', 'Display', 0.1),
    ],
    hasDirectFeedthrough: noFeed,
    ports: (p) => {
      const n = Math.max(1, Math.min(6, Math.round(num(p, 'inputCount', 1))));
      return {
        inputs: Array.from({ length: n }, (_, i) => ({ id: `in${i}`, name: `${i + 1}` })),
        outputs: [],
      };
    },
    continuousStates: none,
    discreteStates: none,
    outputs: () => undefined,
  },
  {
    type: 'xy',
    category: 'Sinks',
    name: 'XY Graph',
    description: 'Plots one signal against another',
    renderer: 'xy',
    defaultParameters: { timeSpan: 12 },
    parameters: [numberField('timeSpan', 'History (s)', undefined, 0.5)],
    hasDirectFeedthrough: noFeed,
    ports: () => ({
      inputs: [
        { id: 'x', name: 'x' },
        { id: 'y', name: 'y' },
      ],
      outputs: [],
    }),
    continuousStates: none,
    discreteStates: none,
    outputs: () => undefined,
  },
  {
    type: 'meter',
    category: 'Sinks',
    name: 'Numeric',
    description: 'A live readout of one signal',
    renderer: 'meter',
    defaultParameters: { digits: 3 },
    parameters: [numberField('digits', 'Digits', undefined, 1)],
    hasDirectFeedthrough: noFeed,
    ports: io(scalarIn(), []),
    continuousStates: none,
    discreteStates: none,
    outputs: () => undefined,
  },
  {
    type: 'log',
    category: 'Sinks',
    name: 'Log',
    description: 'Records a signal so it can be downloaded as CSV',
    renderer: 'meter',
    defaultParameters: { timeSpan: 20 },
    parameters: [numberField('timeSpan', 'History (s)', undefined, 1)],
    hasDirectFeedthrough: noFeed,
    ports: io(scalarIn(), []),
    continuousStates: none,
    discreteStates: none,
    outputs: () => undefined,
  },
  {
    type: 'note',
    category: 'Annotation',
    name: 'Note',
    description: 'Text on the diagram',
    renderer: 'note',
    defaultParameters: { text: 'Note' },
    parameters: [{ key: 'text', label: 'Text', type: 'string', wide: true }],
    hasDirectFeedthrough: noFeed,
    ports: () => ({ inputs: [], outputs: [] }),
    continuousStates: none,
    discreteStates: none,
    outputs: () => undefined,
  },
];

function ssInputs(ctx: BlockContext, m: number): number[] {
  const u = new Array(m);
  for (let i = 0; i < m; i++) u[i] = ctx.inputs[`u${i}`] ?? 0;
  return u;
}

const byType = new Map(BLOCKS.map((block) => [block.type, block]));

export function getBlock(type: string): BlockDefinition | undefined {
  return byType.get(type);
}

export function libraryGroups(): { category: string; blocks: BlockDefinition[] }[] {
  const order = ['Sources', 'Math', 'Continuous', 'Discrete', 'Nonlinear', 'Plants', 'Sinks', 'Annotation'];
  return order.map((category) => ({
    category,
    blocks: BLOCKS.filter((block) => block.category === category),
  }));
}

export function blockSummary(def: BlockDefinition, parameters: Record<string, Param>): string {
  switch (def.type) {
    case 'gain':
      return formatCompact(num(parameters, 'k', 1));
    case 'constant':
    case 'manual':
      return formatCompact(num(parameters, 'value', 0));
    case 'sum':
      return signsOf(parameters)
        .split('')
        .map((s) => (s === '-' ? '−' : '+'))
        .join(' ');
    case 'product':
      return opsOf(parameters).split('').join(' ');
    case 'bias':
      return formatCompact(num(parameters, 'bias', 0));
    case 'math':
      return text(parameters, 'fn', 'sin');
    case 'fcn':
      return text(parameters, 'expr', 'u');
    case 'integrator':
      return `x₀ ${formatCompact(num(parameters, 'initialCondition', 0))}`;
    case 'pid':
      return `${formatCompact(num(parameters, 'Kp', 0))}  ${formatCompact(num(parameters, 'Ki', 0))}  ${formatCompact(num(parameters, 'Kd', 0))}`;
    case 'transfer':
      return text(parameters, 'denominator', '');
    case 'sine':
      return `${formatCompact(num(parameters, 'frequency', 0))} Hz`;
    case 'saturation':
      return `${formatCompact(num(parameters, 'lowerLimit', 0))}…${formatCompact(num(parameters, 'upperLimit', 0))}`;
    case 'step':
      return formatCompact(num(parameters, 'finalValue', 1));
    case 'pulse':
      return formatCompact(num(parameters, 'amplitude', 1));
    default:
      return '';
  }
}

export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 0.01 || abs >= 1000)) return value.toExponential(2);
  const textValue = value.toFixed(abs >= 100 ? 1 : abs >= 10 ? 2 : 3);
  return textValue.replace(/\.?0+$/, '');
}
