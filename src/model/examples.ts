import { getBlock } from '../engine/blocks';
import { designDynamicsLqr } from '../engine/lqr';
import { GraphEdge, GraphNode } from '../engine/types';
import { DEFAULT_CONFIG, DEFAULT_DESIGN, DocNode, SimDocument } from './document';
import { CART_DOUBLE_PENDULUM_ODE } from './plants';
import { SCENE_CART_PENDULUM, SCENE_MASS_SPRING, SCENE_ROTOR, SCENE_TANK } from './scenes';

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
  // Generic LQR roles: ki ← −Kᵢ, optional kref ← +K₀
  let K = [0, 0, 0, 0, 0, 0];
  try {
    K = designDynamicsLqr('ode', { ...CART_DOUBLE_PENDULUM_ODE }, design.Q, design.R).K;
  } catch (error) {
    console.warn(error);
  }
  const deg = 180 / Math.PI;
  const nodes: DocNode[] = [
    node('note-law', 'note', 16, 8, {
      text: 'Generic LQR roles: u = kref·r + Σ ki·zi with ki=−Ki, kref=+K0. Plant is a mass-matrix ODE.',
    }, 'Control law'),
    node('ref', 'constant', 16, 96, { value: 0 }, 'x ref'),
    node('kref', 'gain', 132, 93, { k: K[0] }, 'K₀ r'),
    node('k0', 'gain', 248, 93, { k: -K[0] }, '−K₀ x'),
    node('k3', 'gain', 248, 173, { k: -K[3] }, '−K₃ ẋ'),
    node('k1', 'gain', 248, 253, { k: -K[1] }, '−K₁ θ₁'),
    node('k4', 'gain', 248, 333, { k: -K[4] }, '−K₄ ω₁'),
    node('k2', 'gain', 248, 413, { k: -K[2] }, '−K₂ θ₂'),
    node('k5', 'gain', 248, 493, { k: -K[5] }, '−K₅ ω₂'),
    node('sum-u', 'sum', 400, 268, { signs: '+++++++' }, 'Σ u'),
    node('sat', 'saturation', 553, 292, { upperLimit: 80, lowerLimit: -80 }, '|F| ≤ 80'),
    node('pulse', 'pulse', 553, 392, { amplitude: 16, delay: 8, width: 0.18, period: 0 }, 'Disturbance'),
    node('manual', 'manual', 553, 488, { value: 0, min: -25, max: 25 }, 'Hand force'),
    node('sum-f', 'sum', 685, 280, { signs: '+++' }, 'Σ F'),
    node('plant', 'ode', 822, 217, { ...CART_DOUBLE_PENDULUM_ODE }, 'ODE plant'),
    node('stage', 'stage', 822, 430, { ...SCENE_CART_PENDULUM, nudgePlant: 'plant' }, 'Stage'),
    node('note-plant', 'note', 822, 16, {
      text: 'All demo-specific behavior is data: ODE constants/M/rhs and Stage scene/nudge strings.',
    }),
    node('scope-cart', 'scope', 1188, 24, { inputCount: 2, timeSpan: 16, autoScale: true, yMin: -1, yMax: 1 }, 'Cart & force'),
    node('xy', 'xy', 1468, 24, { timeSpan: 16 }, 'θ₁ vs θ₂'),
    node('deg1', 'gain', 1188, 286, { k: deg }, 'θ₁ deg'),
    node('deg2', 'gain', 1188, 366, { k: deg }, 'θ₂ deg'),
    node('scope-ang', 'scope', 1320, 248, { inputCount: 2, timeSpan: 16, autoScale: true, yMin: -20, yMax: 20 }, 'Angles'),
    node('meter-f', 'meter', 1620, 300, { digits: 2 }, 'Force'),
  ];

  const edges = [
    edge('ref', 'out', 'kref', 'in'),
    edge('plant', 'y0', 'k0', 'in'),
    edge('plant', 'y3', 'k3', 'in'),
    edge('plant', 'y1', 'k1', 'in'),
    edge('plant', 'y4', 'k4', 'in'),
    edge('plant', 'y2', 'k2', 'in'),
    edge('plant', 'y5', 'k5', 'in'),
    edge('kref', 'out', 'sum-u', 'in0'),
    edge('k0', 'out', 'sum-u', 'in1'),
    edge('k3', 'out', 'sum-u', 'in2'),
    edge('k1', 'out', 'sum-u', 'in3'),
    edge('k4', 'out', 'sum-u', 'in4'),
    edge('k2', 'out', 'sum-u', 'in5'),
    edge('k5', 'out', 'sum-u', 'in6'),
    edge('sum-u', 'out', 'sat', 'in'),
    edge('sat', 'out', 'sum-f', 'in0'),
    edge('pulse', 'out', 'sum-f', 'in1'),
    edge('manual', 'out', 'sum-f', 'in2'),
    edge('sum-f', 'out', 'plant', 'u1'),
    edge('plant', 'y0', 'stage', 'x'),
    edge('plant', 'y1', 'stage', 'th1'),
    edge('plant', 'y2', 'stage', 'th2'),
    edge('sum-f', 'out', 'stage', 'force'),
    edge('plant', 'y1', 'deg1', 'in'),
    edge('plant', 'y2', 'deg2', 'in'),
    edge('deg1', 'out', 'scope-ang', 'in0'),
    edge('deg2', 'out', 'scope-ang', 'in1'),
    edge('plant', 'y0', 'scope-cart', 'in0'),
    edge('sum-f', 'out', 'scope-cart', 'in1'),
    edge('plant', 'y1', 'xy', 'x'),
    edge('plant', 'y2', 'xy', 'y'),
    edge('sum-f', 'out', 'meter-f', 'in'),
  ];

  return {
    name: 'Inverted double pendulum',
    description:
      'State feedback on a generic mass-matrix ODE plant, with a data-driven Stage scene — no demo-specific engine code.',
    config: { ...DEFAULT_CONFIG, stopTime: 16, stepSize: 0.001, solver: 'rk4', speed: 1, startTime: 0 },
    design,
    nodes,
    edges,
  };
}

export function oscillatorDocument(): SimDocument {
  return {
    name: 'Mass-spring-damper',
    description: 'Built from Mass, Spring, and Damper blocks. A step force settles at x = F/k.',
    config: { solver: 'rk4', stepSize: 0.002, stopTime: 14, startTime: 0, speed: 1 },
    design: { Q: DEFAULT_DESIGN.Q.slice(), R: DEFAULT_DESIGN.R },
    nodes: [
      node('note', 'note', 16, 8, { text: 'm = 1, c = 0.3, k = 1. Mechanical building blocks close Newton’s law.' }),
      node('force', 'step', 16, 118, { stepTime: 0.4, initialValue: 0, finalValue: 1 }, 'Force'),
      node('sum', 'sum', 140, 104, { signs: '+--' }, 'Σ F'),
      node('mass', 'mass', 300, 112, { m: 1, x0: 0, v0: 0 }, 'Mass'),
      node('damper', 'damper', 140, 300, { c: 0.3 }, 'Damper'),
      node('spring', 'spring', 300, 300, { k: 1 }, 'Spring'),
      node('scope', 'scope', 500, 40, { inputCount: 2, timeSpan: 14, autoScale: true, yMin: -0.2, yMax: 1.4 }, 'x and v'),
      node('meter', 'meter', 500, 292, { digits: 3 }, 'x'),
      node('stage', 'stage', 680, 140, { ...SCENE_MASS_SPRING }, 'Stage'),
    ],
    edges: [
      edge('force', 'out', 'sum', 'in0'),
      edge('damper', 'out', 'sum', 'in1'),
      edge('spring', 'out', 'sum', 'in2'),
      edge('sum', 'out', 'mass', 'F'),
      edge('mass', 'v', 'damper', 'in'),
      edge('mass', 'x', 'spring', 'in'),
      edge('mass', 'x', 'scope', 'in0'),
      edge('mass', 'v', 'scope', 'in1'),
      edge('mass', 'x', 'meter', 'in'),
      edge('mass', 'x', 'stage', 'x'),
      edge('mass', 'v', 'stage', 'v'),
    ],
  };
}

export function pidDocument(): SimDocument {
  return {
    name: 'PID on second-order plant',
    description: 'A PID drives the generic Second-Order plant to a unit step.',
    config: { solver: 'rk4', stepSize: 0.002, stopTime: 12, startTime: 0, speed: 1 },
    design: { Q: DEFAULT_DESIGN.Q.slice(), R: DEFAULT_DESIGN.R },
    nodes: [
      node('note', 'note', 16, 8, { text: 'Plant is ÿ + 2ζωẏ + ω²y = K u with ωn = 2, ζ = 0.25, K = 1.' }),
      node('ref', 'step', 16, 128, { stepTime: 0.3, initialValue: 0, finalValue: 1 }, 'Reference'),
      node('sum', 'sum', 144, 121, { signs: '+-' }, 'Error'),
      node('pid', 'pid', 260, 128, { Kp: 3.5, Ki: 4, Kd: 0.8, Tf: 0.05, limitOutput: true, upperLimit: 12, lowerLimit: -12 }, 'PID'),
      node('plant', 'secondorder', 420, 119, { wn: 2, zeta: 0.25, K: 1, y0: 0, dy0: 0 }, 'Second-order'),
      node('scope', 'scope', 600, 52, { inputCount: 2, timeSpan: 12, autoScale: true, yMin: -0.2, yMax: 1.4 }, 'Ref & y'),
      node('meter', 'meter', 600, 268, { digits: 3 }, 'y'),
    ],
    edges: [
      edge('ref', 'out', 'sum', 'in0'),
      edge('plant', 'y', 'sum', 'in1'),
      edge('sum', 'out', 'pid', 'in'),
      edge('pid', 'out', 'plant', 'u'),
      edge('ref', 'out', 'scope', 'in0'),
      edge('plant', 'y', 'scope', 'in1'),
      edge('plant', 'y', 'meter', 'in'),
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
      node('note', 'note', 16, 8, { text: 'Two integrators and a gain close the loop ÿ = −ω² y. Period is π seconds.' }),
      node('v', 'integrator', 16, 112, { initialCondition: 1 }, 'velocity'),
      node('y', 'integrator', 150, 112, { initialCondition: 0 }, 'position'),
      node('stiff', 'gain', 16, 252, { k: -4 }, '−ω²'),
      node('scope', 'scope', 300, 48, { inputCount: 2, timeSpan: 10, autoScale: true, yMin: -1.2, yMax: 1.2 }, 'y and v'),
      node('meter', 'meter', 300, 260, { digits: 3 }, 'y'),
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

export function motorDocument(): SimDocument {
  return {
    name: 'DC motor speed control',
    description: 'Armature voltage steps; a PID regulates rotor speed on the DC Motor block.',
    config: { solver: 'rk4', stepSize: 0.001, stopTime: 8, startTime: 0, speed: 1 },
    design: { Q: DEFAULT_DESIGN.Q.slice(), R: DEFAULT_DESIGN.R },
    nodes: [
      node('note', 'note', 16, 8, { text: 'Electrical + mechanical domains in one DC Motor building block. TL is a load disturbance.' }),
      node('ref', 'step', 16, 120, { stepTime: 0.4, initialValue: 0, finalValue: 5 }, 'ω ref'),
      node('sum', 'sum', 150, 112, { signs: '+-' }, 'Error'),
      node('pid', 'pid', 280, 120, { Kp: 8, Ki: 25, Kd: 0.2, Tf: 0.02, limitOutput: true, upperLimit: 48, lowerLimit: -48 }, 'PID'),
      node('load', 'pulse', 280, 280, { amplitude: 0.05, delay: 4, width: 0.5, period: 0 }, 'Load pulse'),
      node('motor', 'dcmotor', 460, 150, { R: 1, L: 0.05, Kt: 0.1, Kb: 0.1, J: 0.02, b: 0.05 }, 'DC motor'),
      node('angle', 'integrator', 460, 280, { initialCondition: 0 }, 'θ = ∫ω'),
      node('scope', 'scope', 680, 40, { inputCount: 2, timeSpan: 8, autoScale: true, yMin: -1, yMax: 6 }, 'Ref & ω'),
      node('meter', 'meter', 680, 280, { digits: 3 }, 'ω'),
      node('stage', 'stage', 860, 140, { ...SCENE_ROTOR }, 'Stage'),
    ],
    edges: [
      edge('ref', 'out', 'sum', 'in0'),
      edge('motor', 'w', 'sum', 'in1'),
      edge('sum', 'out', 'pid', 'in'),
      edge('pid', 'out', 'motor', 'Va'),
      edge('load', 'out', 'motor', 'TL'),
      edge('motor', 'w', 'angle', 'in'),
      edge('ref', 'out', 'scope', 'in0'),
      edge('motor', 'w', 'scope', 'in1'),
      edge('motor', 'w', 'meter', 'in'),
      edge('angle', 'out', 'stage', 'theta'),
      edge('motor', 'T', 'stage', 'torque'),
    ],
  };
}

export function pneumaticDocument(): SimDocument {
  return {
    name: 'Pneumatic tank charge',
    description: 'A valve from a supply pressure fills an isothermal tank. Opening steps at t = 0.5 s.',
    config: { solver: 'rk4', stepSize: 0.002, stopTime: 10, startTime: 0, speed: 1 },
    design: { Q: DEFAULT_DESIGN.Q.slice(), R: DEFAULT_DESIGN.R },
    nodes: [
      node('note', 'note', 16, 8, { text: 'Pneumatic Valve + Tank. q = Cd·open·sign(Δp)·√|Δp|, C ṗ = q.' }),
      node('supply', 'constant', 16, 120, { value: 5 }, 'Supply p'),
      node('open', 'step', 16, 240, { stepTime: 0.5, initialValue: 0, finalValue: 1 }, 'Valve open'),
      node('valve', 'pneumatic_valve', 200, 150, { Cd: 0.35 }, 'Valve'),
      node('vent', 'constant', 200, 300, { value: 0 }, 'Vent q'),
      node('tank', 'pneumatic_tank', 380, 160, { C: 0.05, p0: 1 }, 'Tank'),
      node('scope', 'scope', 560, 48, { inputCount: 2, timeSpan: 10, autoScale: true, yMin: 0, yMax: 5.5 }, 'p & q'),
      node('meter', 'meter', 560, 280, { digits: 3 }, 'p'),
      node('stage', 'stage', 740, 140, { ...SCENE_TANK }, 'Stage'),
    ],
    edges: [
      edge('supply', 'out', 'valve', 'p1'),
      edge('tank', 'p', 'valve', 'p2'),
      edge('open', 'out', 'valve', 'open'),
      edge('valve', 'q', 'tank', 'qin'),
      edge('vent', 'out', 'tank', 'qout'),
      edge('tank', 'p', 'scope', 'in0'),
      edge('valve', 'q', 'scope', 'in1'),
      edge('tank', 'p', 'meter', 'in'),
      edge('tank', 'p', 'stage', 'level'),
      edge('valve', 'q', 'stage', 'flow'),
    ],
  };
}

export function blankDocument(): SimDocument {
  return {
    name: 'Untitled',
    description: 'Empty diagram.',
    config: { ...DEFAULT_CONFIG, stopTime: 10 },
    design: { Q: DEFAULT_DESIGN.Q.slice(), R: DEFAULT_DESIGN.R },
    nodes: [
      node('note', 'note', 80, 80, {
        text: 'Drag Dynamics blocks (ODE, Mass, Motor, Pneumatic…) to build a plant, then run.',
      }),
    ],
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
    summary: 'Mass-matrix ODE plant with state feedback and an animated stage.',
    create: pendulumDocument,
  },
  {
    id: 'motor',
    name: 'DC motor speed control',
    summary: 'Electrical + mechanical motor block under PID speed control.',
    create: motorDocument,
  },
  {
    id: 'pneumatic',
    name: 'Pneumatic tank charge',
    summary: 'Valve and isothermal tank from the pneumatic domain library.',
    create: pneumaticDocument,
  },
  {
    id: 'pid',
    name: 'PID on second-order plant',
    summary: 'Generic second-order Dynamics block under PID control.',
    create: pidDocument,
  },
  {
    id: 'oscillator',
    name: 'Mass-spring-damper',
    summary: 'Mass, Spring, and Damper building blocks closing Newton’s law.',
    create: oscillatorDocument,
  },
  {
    id: 'harmonic',
    name: 'Harmonic oscillator',
    summary: 'An undamped second-order loop from integrators and a gain.',
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
