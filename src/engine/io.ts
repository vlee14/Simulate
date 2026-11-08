import { BlockContext, BlockDefinition, Param, ParamSpec, PortDef, PortDomain } from './types';

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

function domainOf(kind: string): PortDomain {
  switch (kind) {
    case 'encoder':
    case 'tachometer':
    case 'force':
    case 'torque':
      return 'mechanical';
    case 'current':
    case 'voltage':
      return 'electrical';
    case 'pressure':
      return 'pneumatic';
    case 'temperature':
      return 'thermal';
    case 'signal':
    default:
      return 'signal';
  }
}

function nextNoise(ctx: BlockContext): number {
  // xorshift-ish using discrete[1] as seed state when present, else Math.random
  if (ctx.discrete.length > 1) {
    let s = ctx.discrete[1] | 0;
    if (s === 0) s = 0x9e3779b9;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    ctx.discrete[1] = s;
    return ((s >>> 0) / 0xffffffff) * 2 - 1;
  }
  return Math.random() * 2 - 1;
}

function sense(ctx: BlockContext, raw: number): number {
  const gain = num(ctx.parameters, 'gain', 1);
  const bias = num(ctx.parameters, 'bias', 0);
  const noise = Math.max(0, num(ctx.parameters, 'noise', 0));
  let y = gain * raw + bias;
  if (noise > 0) y += noise * nextNoise(ctx);
  return y;
}

export const IO_BLOCKS: BlockDefinition[] = [
  {
    type: 'sensor',
    category: 'Sensors',
    name: 'Sensor',
    description: 'Generic sensor: gain, bias, noise, and optional first-order lag.',
    renderer: 'sim',
    defaultParameters: { kind: 'signal', gain: 1, bias: 0, noise: 0, tau: 0, seed: 1 },
    parameters: [
      {
        key: 'kind',
        label: 'Kind',
        type: 'select',
        group: 'Sensor',
        options: [
          { value: 'signal', label: 'Signal' },
          { value: 'encoder', label: 'Angle / encoder' },
          { value: 'tachometer', label: 'Speed' },
          { value: 'pressure', label: 'Pressure' },
          { value: 'current', label: 'Current' },
          { value: 'temperature', label: 'Temperature' },
        ],
      },
      numberField('gain', 'Gain', 'Sensor', 0.1),
      numberField('bias', 'Bias', 'Sensor', 0.01),
      numberField('noise', 'Noise (1σ)', 'Sensor', 0.01),
      numberField('tau', 'Lag τ (s)', 'Sensor', 0.01, '0 = ideal. Otherwise ẏ = (u − y)/τ'),
      numberField('seed', 'Noise seed', 'Sensor', 1),
    ],
    hasDirectFeedthrough: (p) => num(p, 'tau', 0) <= 1e-12,
    ports: (p) => {
      const domain = domainOf(text(p, 'kind', 'signal'));
      return {
        inputs: [{ id: 'in', name: 'in', domain }],
        outputs: [{ id: 'out', name: 'ŷ', domain }],
      };
    },
    continuousStates: (p) => (num(p, 'tau', 0) > 1e-12 ? 1 : 0),
    discreteStates: () => 2,
    init: (ctx) => {
      ctx.discrete[0] = 0;
      ctx.discrete[1] = Math.max(1, Math.round(num(ctx.parameters, 'seed', 1)));
      if (ctx.state.length) ctx.state[0] = 0;
    },
    outputs: (ctx) => {
      const tau = num(ctx.parameters, 'tau', 0);
      const raw = tau > 1e-12 ? ctx.state[0] : ctx.inputs.in ?? 0;
      ctx.outputs.out = sense(ctx, raw);
    },
    derivatives: (ctx) => {
      const tau = Math.max(1e-4, num(ctx.parameters, 'tau', 0));
      ctx.deriv[0] = ((ctx.inputs.in ?? 0) - ctx.state[0]) / tau;
    },
  },
  {
    type: 'encoder',
    category: 'Sensors',
    name: 'Encoder',
    description: 'Angle sensor with counts-per-rev quantization, bias, and noise.',
    renderer: 'sim',
    defaultParameters: { counts: 4096, bias: 0, noise: 0, seed: 2 },
    parameters: [
      numberField('counts', 'Counts / rev', 'Encoder', 64),
      numberField('bias', 'Bias (rad)', 'Encoder', 0.001),
      numberField('noise', 'Noise (rad)', 'Encoder', 0.001),
      numberField('seed', 'Noise seed', 'Encoder', 1),
    ],
    hasDirectFeedthrough: feed,
    ports: () => ({
      inputs: [{ id: 'theta', name: 'θ', domain: 'mechanical' }],
      outputs: [{ id: 'out', name: 'θ̂', domain: 'mechanical' }],
    }),
    continuousStates: none,
    discreteStates: () => 2,
    init: (ctx) => {
      ctx.discrete[1] = Math.max(1, Math.round(num(ctx.parameters, 'seed', 2)));
    },
    outputs: (ctx) => {
      const counts = Math.max(1, num(ctx.parameters, 'counts', 4096));
      const step = (2 * Math.PI) / counts;
      const raw = ctx.inputs.theta ?? 0;
      const quantized = Math.round(raw / step) * step;
      ctx.outputs.out = sense(ctx, quantized);
    },
  },
  {
    type: 'actuator',
    category: 'Actuators',
    name: 'Actuator',
    description: 'Command to effort with saturation and first-order lag.',
    renderer: 'sim',
    defaultParameters: { kind: 'force', upper: 80, lower: -80, tau: 0.02 },
    parameters: [
      {
        key: 'kind',
        label: 'Kind',
        type: 'select',
        group: 'Actuator',
        options: [
          { value: 'force', label: 'Force' },
          { value: 'torque', label: 'Torque' },
          { value: 'voltage', label: 'Voltage' },
          { value: 'pressure', label: 'Pressure' },
          { value: 'signal', label: 'Signal / opening' },
        ],
      },
      numberField('upper', 'Upper limit', 'Actuator', 1),
      numberField('lower', 'Lower limit', 'Actuator', 1),
      numberField('tau', 'Lag τ (s)', 'Actuator', 0.01),
    ],
    hasDirectFeedthrough: noFeed,
    ports: (p) => {
      const domain = domainOf(text(p, 'kind', 'force'));
      return {
        inputs: [{ id: 'cmd', name: 'cmd', domain: 'signal' }],
        outputs: [{ id: 'out', name: 'out', domain }],
      };
    },
    continuousStates: () => 1,
    discreteStates: none,
    init: (ctx) => {
      ctx.state[0] = 0;
    },
    outputs: (ctx) => {
      ctx.outputs.out = ctx.state[0];
    },
    derivatives: (ctx) => {
      const lo = num(ctx.parameters, 'lower', -80);
      const hi = num(ctx.parameters, 'upper', 80);
      const tau = Math.max(1e-4, num(ctx.parameters, 'tau', 0.02));
      const cmd = Math.min(hi, Math.max(lo, ctx.inputs.cmd ?? 0));
      ctx.deriv[0] = (cmd - ctx.state[0]) / tau;
    },
  },
  {
    type: 'subsystem',
    category: 'Subsystem',
    name: 'Subsystem',
    description: 'Reusable plant package. Expand at compile from an embedded blueprint of blocks and wires.',
    renderer: 'sim',
    defaultParameters: {
      blueprint: '{"nodes":[{"id":"in","blockType":"inport","parameters":{"name":"u","domain":"signal"}},{"id":"g","blockType":"gain","parameters":{"k":1}},{"id":"out","blockType":"outport","parameters":{"name":"y","domain":"signal"}}],"edges":[{"source":"in","sourceHandle":"out","target":"g","targetHandle":"in"},{"source":"g","sourceHandle":"out","target":"out","targetHandle":"in"}]}',
    },
    parameters: [
      {
        key: 'blueprint',
        label: 'Blueprint JSON',
        type: 'string',
        wide: true,
        group: 'Subsystem',
        help: 'Graph of child blocks with inport/outport boundaries. Prefer Insert from Plant builder.',
      },
    ],
    hasDirectFeedthrough: feed,
    ports: (p) => {
      try {
        // Lazy import-free parse to avoid cycles at module init.
        const raw = text(p, 'blueprint', '');
        const parsed = JSON.parse(raw) as {
          nodes?: { blockType: string; parameters?: Record<string, Param> }[];
        };
        const inputs: PortDef[] = [];
        const outputs: PortDef[] = [];
        for (const node of parsed.nodes ?? []) {
          if (node.blockType === 'inport') {
            const name = String(node.parameters?.name ?? 'u');
            inputs.push({
              id: name,
              name,
              domain: (node.parameters?.domain as PortDomain) ?? 'signal',
            });
          }
          if (node.blockType === 'outport') {
            const name = String(node.parameters?.name ?? 'y');
            outputs.push({
              id: name,
              name,
              domain: (node.parameters?.domain as PortDomain) ?? 'signal',
            });
          }
        }
        return {
          inputs: inputs.length ? inputs : [{ id: 'u', name: 'u', domain: 'signal' }],
          outputs: outputs.length ? outputs : [{ id: 'y', name: 'y', domain: 'signal' }],
        };
      } catch {
        return {
          inputs: [{ id: 'u', name: 'u', domain: 'signal' }],
          outputs: [{ id: 'y', name: 'y', domain: 'signal' }],
        };
      }
    },
    continuousStates: none,
    discreteStates: none,
    // Never evaluated — compile expands the blueprint away.
    outputs: () => undefined,
  },
  {
    type: 'inport',
    category: 'Subsystem',
    name: 'Inport',
    description: 'Subsystem input boundary. Name must match a parent subsystem port.',
    renderer: 'sim',
    defaultParameters: { name: 'u', domain: 'signal' },
    parameters: [
      { key: 'name', label: 'Port name', type: 'string', group: 'Interface' },
      {
        key: 'domain',
        label: 'Domain',
        type: 'select',
        group: 'Interface',
        options: [
          { value: 'signal', label: 'Signal' },
          { value: 'mechanical', label: 'Mechanical' },
          { value: 'electrical', label: 'Electrical' },
          { value: 'pneumatic', label: 'Pneumatic' },
          { value: 'hydraulic', label: 'Hydraulic' },
          { value: 'thermal', label: 'Thermal' },
        ],
      },
    ],
    hasDirectFeedthrough: feed,
    ports: (p) => ({
      inputs: [],
      outputs: [{ id: 'out', name: text(p, 'name', 'u'), domain: text(p, 'domain', 'signal') as PortDomain }],
    }),
    continuousStates: none,
    discreteStates: none,
    // Value is injected while flattening; as a standalone block it passes 0.
    outputs: (ctx) => {
      ctx.outputs.out = ctx.inputs.__ext ?? 0;
    },
  },
  {
    type: 'outport',
    category: 'Subsystem',
    name: 'Outport',
    description: 'Subsystem output boundary. Name must match a parent subsystem port.',
    renderer: 'sim',
    defaultParameters: { name: 'y', domain: 'signal' },
    parameters: [
      { key: 'name', label: 'Port name', type: 'string', group: 'Interface' },
      {
        key: 'domain',
        label: 'Domain',
        type: 'select',
        group: 'Interface',
        options: [
          { value: 'signal', label: 'Signal' },
          { value: 'mechanical', label: 'Mechanical' },
          { value: 'electrical', label: 'Electrical' },
          { value: 'pneumatic', label: 'Pneumatic' },
          { value: 'hydraulic', label: 'Hydraulic' },
          { value: 'thermal', label: 'Thermal' },
        ],
      },
    ],
    hasDirectFeedthrough: feed,
    ports: (p) => ({
      inputs: [{ id: 'in', name: text(p, 'name', 'y'), domain: text(p, 'domain', 'signal') as PortDomain }],
      outputs: [],
    }),
    continuousStates: none,
    discreteStates: none,
    outputs: () => undefined,
  },
];

