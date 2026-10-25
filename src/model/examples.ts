import { getBlock } from '../engine/blocks';
import { designPendulumLqr } from '../engine/lqr';
import { DEFAULT_PENDULUM } from '../engine/physics';
import { GraphEdge, GraphNode } from '../engine/types';
import { DEFAULT_CONFIG, DEFAULT_DESIGN, DocNode, SimDocument } from './document';

export const GAIN_ROLES = ['gain-x', 'gain-dx', 'gain-th1', 'gain-w1', 'gain-th2', 'gain-w2'] as const;

/** Block gains that realize u = −K (z − r), with the reference subtracted on cart position only. */
export function regulatorGains(K: number[]): Record<string, number> {
  return {
    'gain-x': K[0],
    'gain-th1': -K[1],
    'gain-th2': -K[2],
    'gain-dx': -K[3],
    'gain-w1': -K[4],
    'gain-w2': -K[5],
  };
}

function node(
  id: string,
  blockType: string,
  x: number,
  y: number,
  parameters?: Record<string, string | number | boolean>,
  alias?: string,
  role?: string
): DocNode {
  return { id, blockType, x, y, parameters, alias, role: role ?? id };
}

function edge(source: string, sourceHandle: string, target: string, targetHandle: string) {
  return { source, sourceHandle, target, targetHandle };
}

export function pendulumDocument(): SimDocument {
  const design = {
    Q: DEFAULT_DESIGN.Q.slice(),
    R: DEFAULT_DESIGN.R,
  };
  let gains: Record<string, number> = {
    'gain-x': 0,
    'gain-dx': 0,
    'gain-th1': 0,
    'gain-w1': 0,
    'gain-th2': 0,
    'gain-w2': 0,
  };
  try {
    const result = designPendulumLqr(DEFAULT_PENDULUM, design.Q, design.R);
    gains = regulatorGains(result.K);
  } catch (error) {
    console.warn(error);
  }
  const deg = 180 / Math.PI;
  const nodes: DocNode[] = [
    node('note-law', 'note', 8, 0, {
      text: 'State feedback    u = −K (z − r)    z = [x  θ₁  θ₂  ẋ  ω₁  ω₂]',
    }, 'Control law'),
    node('ref', 'constant', 8, 78, { value: 0 }, 'x ref'),
    node('sum-x', 'sum', 168, 70, { signs: '+-' }, 'x error'),
    node('gain-x', 'gain', 340, 8, { k: gains['gain-x'] }, 'Kx'),
    node('gain-dx', 'gain', 340, 96, { k: gains['gain-dx'] }, '−Kẋ'),
    node('gain-th1', 'gain', 340, 184, { k: gains['gain-th1'] }, '−Kθ₁'),
    node('gain-w1', 'gain', 500, 8, { k: gains['gain-w1'] }, '−Kω₁'),
    node('gain-th2', 'gain', 500, 96, { k: gains['gain-th2'] }, '−Kθ₂'),
    node('gain-w2', 'gain', 500, 184, { k: gains['gain-w2'] }, '−Kω₂'),
    node('sum-u', 'sum', 680, 48, { signs: '++++++' }, 'Σ u'),
    node('sat', 'saturation', 860, 70, { upperLimit: 80, lowerLimit: -80 }, '|F| ≤ 80'),
    node('pulse', 'pulse', 860, 200, { amplitude: 16, delay: 8, width: 0.18, period: 0 }, 'Disturbance'),
    node('manual', 'manual', 860, 300, { value: 0, min: -25, max: 25 }, 'Hand force'),
    node('sum-f', 'sum', 1060, 78, { signs: '+++' }, 'Σ F'),
    node(
      'plant',
      'pendulum',
      1240,
      8,
      {
        ...DEFAULT_PENDULUM,
        x0: 0,
        th1_0: 0.18,
        th2_0: -0.12,
        dx0: 0,
        w1_0: 0,
        w2_0: 0,
      },
      'Cart double pendulum'
    ),
    node('deg1', 'gain', 8, 430, { k: deg }, 'θ₁ deg'),
    node('deg2', 'gain', 180, 430, { k: deg }, 'θ₂ deg'),
    node('scope-ang', 'scope', 360, 400, { inputCount: 2, timeSpan: 16, autoScale: true, yMin: -20, yMax: 20 }, 'Angles'),
    node('scope-cart', 'scope', 680, 400, { inputCount: 2, timeSpan: 16, autoScale: true, yMin: -1, yMax: 1 }, 'Cart & force'),
    node('xy', 'xy', 1000, 410, { timeSpan: 16 }, 'θ₁ vs θ₂'),
    node('meter-f', 'meter', 1260, 430, { digits: 2 }, 'Force'),
    node('note-plant', 'note', 1240, 300, {
      text: 'Angles are from upright. The upright state is unstable until the loop is closed.',
    }),
  ];

  const edges = [
    edge('ref', 'out', 'sum-x', 'in0'),
    edge('plant', 'x', 'sum-x', 'in1'),
    edge('sum-x', 'out', 'gain-x', 'in'),
    edge('plant', 'dx', 'gain-dx', 'in'),
    edge('plant', 'th1', 'gain-th1', 'in'),
    edge('plant', 'w1', 'gain-w1', 'in'),
    edge('plant', 'th2', 'gain-th2', 'in'),
    edge('plant', 'w2', 'gain-w2', 'in'),
    edge('gain-x', 'out', 'sum-u', 'in0'),
    edge('gain-dx', 'out', 'sum-u', 'in1'),
    edge('gain-th1', 'out', 'sum-u', 'in2'),
    edge('gain-w1', 'out', 'sum-u', 'in3'),
    edge('gain-th2', 'out', 'sum-u', 'in4'),
    edge('gain-w2', 'out', 'sum-u', 'in5'),
    edge('sum-u', 'out', 'sat', 'in'),
    edge('sat', 'out', 'sum-f', 'in0'),
    edge('pulse', 'out', 'sum-f', 'in1'),
    edge('manual', 'out', 'sum-f', 'in2'),
    edge('sum-f', 'out', 'plant', 'force'),
    edge('plant', 'th1', 'deg1', 'in'),
    edge('plant', 'th2', 'deg2', 'in'),
    edge('deg1', 'out', 'scope-ang', 'in0'),
    edge('deg2', 'out', 'scope-ang', 'in1'),
    edge('plant', 'x', 'scope-cart', 'in0'),
    edge('sum-f', 'out', 'scope-cart', 'in1'),
    edge('plant', 'th1', 'xy', 'x'),
    edge('plant', 'th2', 'xy', 'y'),
    edge('sum-f', 'out', 'meter-f', 'in'),
  ];

  return {
    name: 'Inverted double pendulum',
    description:
      'A cart balances two pendulums about the upright equilibrium with state feedback. Retune it from the Design panel, then kick it.',
    config: { ...DEFAULT_CONFIG, stopTime: 16, stepSize: 0.001, solver: 'rk4', speed: 1, startTime: 0 },
    design,
    nodes,
    edges,
  };
}

export function oscillatorDocument(): SimDocument {
  return {
    name: 'Mass-spring-damper',
    description: 'A unit step force on mẍ + cẋ + kx = F. Watch the underdamped settle at x = F/k.',
    config: { solver: 'rk4', stepSize: 0.002, stopTime: 14, startTime: 0, speed: 1 },
    design: { Q: DEFAULT_DESIGN.Q.slice(), R: DEFAULT_DESIGN.R },
    nodes: [
      node('note', 'note', 40, 24, { text: 'm = 1,  c = 0.3,  k = 1.    Step force settles at x = 1.' }),
      node('force', 'step', 40, 140, { stepTime: 0.4, initialValue: 0, finalValue: 1 }, 'Force'),
      node('sum', 'sum', 250, 150, { signs: '+--' }, 'Σ'),
      node('invm', 'gain', 430, 156, { k: 1 }, '1/m'),
      node('v', 'integrator', 620, 110, { initialCondition: 0 }, 'velocity'),
      node('x', 'integrator', 820, 110, { initialCondition: 0 }, 'position'),
      node('damp', 'gain', 620, 250, { k: 0.3 }, 'c'),
      node('spring', 'gain', 820, 250, { k: 1 }, 'k'),
      node('scope', 'scope', 1040, 80, { inputCount: 2, timeSpan: 14, autoScale: true, yMin: -0.2, yMax: 1.4 }, 'x and v'),
      node('meter', 'meter', 1040, 300, { digits: 3 }, 'x'),
    ],
    edges: [
      edge('force', 'out', 'sum', 'in0'),
      edge('damp', 'out', 'sum', 'in1'),
      edge('spring', 'out', 'sum', 'in2'),
      edge('sum', 'out', 'invm', 'in'),
      edge('invm', 'out', 'v', 'in'),
      edge('v', 'out', 'x', 'in'),
      edge('v', 'out', 'damp', 'in'),
      edge('x', 'out', 'spring', 'in'),
      edge('x', 'out', 'scope', 'in0'),
      edge('v', 'out', 'scope', 'in1'),
      edge('x', 'out', 'meter', 'in'),
    ],
  };
}

export function pidDocument(): SimDocument {
  return {
    name: 'PID plant',
    description: 'A PID drives the plant 1/(s+1) to a unit step. Retune Kp, Ki, and Kd on the controller block.',
    config: { solver: 'rk4', stepSize: 0.002, stopTime: 12, startTime: 0, speed: 1 },
    design: { Q: DEFAULT_DESIGN.Q.slice(), R: DEFAULT_DESIGN.R },
    nodes: [
      node('note', 'note', 8, 0, { text: 'Plant G(s) = 1/(s+1). The step is the reference. Error is reference minus output.' }),
      node('ref', 'step', 8, 100, { stepTime: 0.3, initialValue: 0, finalValue: 1 }, 'Reference'),
      node('sum', 'sum', 220, 100, { signs: '+-' }, 'Error'),
      node('pid', 'pid', 400, 80, { Kp: 2, Ki: 1.4, Kd: 0.15, Tf: 0.05, limitOutput: true, upperLimit: 8, lowerLimit: -8 }, 'PID'),
      node('plant', 'transfer', 620, 90, { numerator: '1', denominator: '1 1' }, '1/(s+1)'),
      node('scope', 'scope', 880, 40, { inputCount: 2, timeSpan: 12, autoScale: true, yMin: -0.2, yMax: 1.4 }, 'Ref & y'),
      node('meter', 'meter', 880, 250, { digits: 3 }, 'y'),
    ],
    edges: [
      edge('ref', 'out', 'sum', 'in0'),
      edge('plant', 'out', 'sum', 'in1'),
      edge('sum', 'out', 'pid', 'in'),
      edge('pid', 'out', 'plant', 'in'),
      edge('ref', 'out', 'scope', 'in0'),
      edge('plant', 'out', 'scope', 'in1'),
      edge('plant', 'out', 'meter', 'in'),
    ],
  };
}

export function harmonicDocument(): SimDocument {
  return {
    name: 'Harmonic oscillator',
    description: 'ÿ + ω²y = 0 with ω² = 4. Position starts at rest and velocity starts at 1.',
    config: { solver: 'rk4', stepSize: 0.002, stopTime: 10, startTime: 0, speed: 1 },
    design: { Q: DEFAULT_DESIGN.Q.slice(), R: DEFAULT_DESIGN.R },
    nodes: [
      node('note', 'note', 8, 0, { text: 'Two integrators and a gain close the loop ÿ = −ω² y. Period is π seconds.' }),
      node('v', 'integrator', 40, 110, { initialCondition: 1 }, 'velocity'),
      node('y', 'integrator', 280, 110, { initialCondition: 0 }, 'position'),
      node('stiff', 'gain', 280, 240, { k: -4 }, '−ω²'),
      node('scope', 'scope', 520, 70, { inputCount: 2, timeSpan: 10, autoScale: true, yMin: -1.2, yMax: 1.2 }, 'y and v'),
      node('meter', 'meter', 520, 280, { digits: 3 }, 'y'),
    ],
    edges: [
      edge('v', 'out', 'y', 'in'),
      edge('y', 'out', 'stiff', 'in'),
      edge('stiff', 'out', 'v', 'in'),
      edge('y', 'out', 'scope', 'in0'),
      edge('v', 'out', 'scope', 'in1'),
      edge('y', 'out', 'meter', 'in'),
    ],
  };
}

export function blankDocument(): SimDocument {
  return {
    name: 'Untitled',
    description: 'Empty diagram.',
    config: { ...DEFAULT_CONFIG, stopTime: 10 },
    design: { Q: DEFAULT_DESIGN.Q.slice(), R: DEFAULT_DESIGN.R },
    nodes: [node('note', 'note', 80, 80, { text: 'Drag blocks from the library. Wire an output to an input, then run.' })],
    edges: [],
  };
}

export interface ExampleTemplate {
  id: string;
  name: string;
  summary: string;
  create: () => SimDocument;
}

export const EXAMPLES: ExampleTemplate[] = [
  {
    id: 'pendulum',
    name: 'Inverted double pendulum',
    summary: 'State feedback that balances a cart and two pendulums. Includes an LQR design panel.',
    create: pendulumDocument,
  },
  {
    id: 'pid',
    name: 'PID plant',
    summary: 'A PID controller tracking a step on the plant 1/(s+1).',
    create: pidDocument,
  },
  {
    id: 'oscillator',
    name: 'Mass-spring-damper',
    summary: 'mẍ + cẋ + kx = F, built from integrators and gains.',
    create: oscillatorDocument,
  },
  {
    id: 'harmonic',
    name: 'Harmonic oscillator',
    summary: 'An undamped second-order loop. Position and velocity trade energy.',
    create: harmonicDocument,
  },
];

export function documentGraph(doc: SimDocument): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = doc.nodes.map((item) => {
    const def = getBlock(item.blockType);
    return {
      id: item.id,
      blockType: item.blockType,
      role: item.role,
      parameters: { ...(def?.defaultParameters ?? {}), ...(item.parameters ?? {}) },
    };
  });
  const edges: GraphEdge[] = doc.edges.map((item, index) => ({
    id: `e${index}:${item.source}:${item.sourceHandle}:${item.target}:${item.targetHandle}`,
    source: item.source,
    target: item.target,
    sourceHandle: item.sourceHandle,
    targetHandle: item.targetHandle,
  }));
  return { nodes, edges };
}
