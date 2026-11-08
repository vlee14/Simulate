import { getBlock } from '../engine/blocks';
import { designDynamicsLqr } from '../engine/lqr';
import { GraphEdge, GraphNode, ParamUncertainty } from '../engine/types';
import { DEFAULT_CONFIG, DEFAULT_DESIGN, DocNode, SimDocument } from './document';
import {
  AIRCRAFT_SCHEDULE_EXAMPLE,
  aircraftPlantParameters,
  CART_DOUBLE_PENDULUM_ODE,
  QUADROTOR_ODE,
} from './plants';
import {
  SCENE_AIRCRAFT,
  SCENE_CART_PENDULUM,
  SCENE_MASS_SPRING,
  SCENE_QUAD,
  SCENE_ROTOR,
  SCENE_SECOND_ORDER,
  SCENE_TANK,
} from './scenes';

function node(
  id: string,
  blockType: string,
  x: number,
  y: number,
  parameters?: Record<string, string | number | boolean>,
  alias?: string,
  role?: string,
  uncertainty?: Record<string, ParamUncertainty>
): DocNode {
  return { id, blockType, x, y, parameters, alias, role: role ?? id, uncertainty };
}

function edge(source: string, sourceHandle: string, target: string, targetHandle: string) {
  return { source, sourceHandle, target, targetHandle };
}

/** Stable demo seeds so every open of the template draws the same MC run n. */
function unc(kind: ParamUncertainty['kind'], seed: number, spread: number): ParamUncertainty {
  return { kind, seed, spread };
}

/** Shared sim config for demos that exercise Monte Carlo campaigns. */
function mcConfig(patch: Partial<SimDocument['config']> = {}): SimDocument['config'] {
  return {
    ...DEFAULT_CONFIG,
    solver: 'rk4',
    startTime: 0,
    speed: 1,
    mcRun: 0,
    mcCampaignSize: 1000,
    mcOverlayCount: 96,
    mcShowAllLines: false,
    mcConfidence: 0.95,
    mcRelError: 0.05,
    mcTailQuantile: 0.95,
    ...patch,
  };
}

function designConfig(patch: Partial<SimDocument['design']> = {}): SimDocument['design'] {
  return {
    ...DEFAULT_DESIGN,
    ...patch,
    Q: (patch.Q ?? DEFAULT_DESIGN.Q).slice(),
    analysis: (patch.analysis ?? DEFAULT_DESIGN.analysis).slice(),
  };
}

/** Numeric plant params override the constants string inside the ODE binder — enables MC draws. */
const PENDULUM_NUMERIC = {
  Mc: 1,
  m1: 0.25,
  m2: 0.25,
  l1: 0.4,
  l2: 0.4,
  g: 9.81,
  b: 0.15,
  c1: 0.002,
  c2: 0.002,
} as const;

export function pendulumDocument(): SimDocument {
  const design = designConfig();
  let K = [0, 0, 0, 0, 0, 0];
  try {
    K = designDynamicsLqr('ode', { ...CART_DOUBLE_PENDULUM_ODE, ...PENDULUM_NUMERIC }, design.Q, design.R).K;
  } catch (error) {
    console.warn(error);
  }
  const deg = 180 / Math.PI;
  const nodes: DocNode[] = [
    node(
      'note-law',
      'note',
      16,
      8,
      {
        text:
          'Design pane: Analyze stability (bands + overlay) or Compute LQR. Plant params carry % Monte Carlo — set Campaign size then Analyze. Stage: drag / ←→ / Kick.',
      },
      'Control law'
    ),
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
    node('pulse', 'pulse', 553, 392, { amplitude: 16, delay: 1e9, width: 0.18, period: 0 }, 'Disturbance'),
    node('manual', 'manual', 553, 488, { value: 0, min: -25, max: 25 }, 'Hand force'),
    node('sum-f', 'sum', 685, 280, { signs: '+++' }, 'Σ F'),
    node(
      'plant',
      'ode',
      822,
      217,
      { ...CART_DOUBLE_PENDULUM_ODE, ...PENDULUM_NUMERIC },
      'ODE plant',
      'plant',
      {
        m1: unc('percent', 1101, 8),
        m2: unc('percent', 1102, 8),
        l1: unc('percent', 1103, 5),
        l2: unc('percent', 1104, 5),
        b: unc('percent', 1105, 20),
        c1: unc('percent', 1106, 25),
        c2: unc('percent', 1107, 25),
      }
    ),
    node('stage', 'stage', 822, 430, { ...SCENE_CART_PENDULUM }, 'Stage'),
    node('note-plant', 'note', 822, 16, {
      text: 'Properties → plant: distributions on m₁,m₂,ℓ,b,c. Toolbar MC run selects a draw for simulation; Design campaign overlays Bode/poles.',
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
      'LQR state feedback on a mass-matrix ODE with Monte Carlo plant uncertainty, Design-pane stability campaigns, and a data-driven Stage (control / kick / interact).',
    config: mcConfig({ stopTime: 16, stepSize: 0.001, mcCampaignSize: 2000 }),
    design,
    nodes,
    edges,
  };
}

export function oscillatorDocument(): SimDocument {
  return {
    name: 'Mass-spring-damper',
    description:
      'Mass, Spring, and Damper with % uncertainty on m, c, k. Use Design → Analyze for MC bands; Stage Hand force / Impulse for disturbances.',
    config: mcConfig({ stepSize: 0.002, stopTime: 14, mcCampaignSize: 1500 }),
    design: designConfig({ Q: [40, 10, 0, 0, 0, 0], R: 1 }),
    nodes: [
      node('note', 'note', 16, 8, {
        text: 'MC on m, c, k. Design → Analyze stability about equilibrium. Stage: Force slider, Impulse, drag the mass.',
      }),
      node('force', 'step', 16, 118, { stepTime: 0.4, initialValue: 0, finalValue: 1 }, 'Step'),
      node('manual', 'manual', 16, 230, { value: 0, min: -5, max: 5 }, 'Hand force'),
      node('sum', 'sum', 160, 104, { signs: '++--' }, 'Σ F'),
      node('mass', 'mass', 320, 112, { m: 1, x0: 0, v0: 0 }, 'Mass', 'mass', {
        m: unc('percent', 2101, 10),
      }),
      node('damper', 'damper', 160, 300, { c: 0.3 }, 'Damper', 'damper', {
        c: unc('percent', 2102, 20),
      }),
      node('spring', 'spring', 320, 300, { k: 1 }, 'Spring', 'spring', {
        k: unc('percent', 2103, 10),
      }),
      node('scope', 'scope', 520, 40, { inputCount: 2, timeSpan: 14, autoScale: true, yMin: -0.2, yMax: 1.4 }, 'x and v'),
      node('meter', 'meter', 520, 292, { digits: 3 }, 'x'),
      node('stage', 'stage', 700, 140, { ...SCENE_MASS_SPRING }, 'Stage'),
    ],
    edges: [
      edge('force', 'out', 'sum', 'in0'),
      edge('manual', 'out', 'sum', 'in1'),
      edge('damper', 'out', 'sum', 'in2'),
      edge('spring', 'out', 'sum', 'in3'),
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
    description:
      'Second-order plant under PID with uncertain ωn/ζ/K, Stage hand disturbance, and Design-pane Bode/Nyquist campaigns.',
    config: mcConfig({ stepSize: 0.002, stopTime: 12, mcCampaignSize: 2000 }),
    design: designConfig({ Q: [25, 5, 0, 0, 0, 0], R: 0.5 }),
    nodes: [
      node('note', 'note', 16, 8, {
        text: 'Plant ÿ+2ζωẏ+ω²y=Ku with MC on ωn, ζ, K. Design → Analyze. Stage: Hand u / Kick / bump y.',
      }),
      node('ref', 'step', 16, 128, { stepTime: 0.3, initialValue: 0, finalValue: 1 }, 'Reference'),
      node('sum', 'sum', 144, 121, { signs: '+-' }, 'Error'),
      node(
        'pid',
        'pid',
        260,
        128,
        { Kp: 3.5, Ki: 4, Kd: 0.8, Tf: 0.05, limitOutput: true, upperLimit: 12, lowerLimit: -12 },
        'PID'
      ),
      node('manual', 'manual', 260, 280, { value: 0, min: -3, max: 3 }, 'Hand u'),
      node('kick', 'pulse', 260, 380, { amplitude: 2, delay: 1e9, width: 0.15, period: 0 }, 'Kick'),
      node('sum-u', 'sum', 400, 140, { signs: '+++' }, 'Σ u'),
      node(
        'plant',
        'secondorder',
        540,
        132,
        { wn: 2, zeta: 0.25, K: 1, y0: 0, dy0: 0 },
        'Second-order',
        'plant',
        {
          wn: unc('percent', 3101, 12),
          zeta: unc('percent', 3102, 25),
          K: unc('percent', 3103, 8),
        }
      ),
      node('scope', 'scope', 740, 40, { inputCount: 2, timeSpan: 12, autoScale: true, yMin: -0.2, yMax: 1.4 }, 'Ref & y'),
      node('meter', 'meter', 740, 268, { digits: 3 }, 'y'),
      node('stage', 'stage', 900, 140, { ...SCENE_SECOND_ORDER }, 'Stage'),
    ],
    edges: [
      edge('ref', 'out', 'sum', 'in0'),
      edge('plant', 'y', 'sum', 'in1'),
      edge('sum', 'out', 'pid', 'in'),
      edge('pid', 'out', 'sum-u', 'in0'),
      edge('manual', 'out', 'sum-u', 'in1'),
      edge('kick', 'out', 'sum-u', 'in2'),
      edge('sum-u', 'out', 'plant', 'u'),
      edge('ref', 'out', 'scope', 'in0'),
      edge('plant', 'y', 'scope', 'in1'),
      edge('plant', 'y', 'meter', 'in'),
      edge('plant', 'y', 'stage', 'y'),
      edge('sum-u', 'out', 'stage', 'u'),
    ],
  };
}

export function harmonicDocument(): SimDocument {
  return {
    name: 'Harmonic oscillator',
    description:
      'Undamped second-order plant (ζ≈0) with Monte Carlo on ωn. Design → Analyze shows pole clouds; period ≈ π s at ωn=2.',
    config: mcConfig({ stepSize: 0.002, stopTime: 10, mcCampaignSize: 1000 }),
    design: designConfig({ Q: [10, 1, 0, 0, 0, 0], R: 1, opMode: 'x0' }),
    nodes: [
      node('note', 'note', 16, 8, {
        text: 'Free response of ÿ+ωn²y=0 (ζ≈0, u=0). MC on ωn. Design → Analyze (op point = plant x₀) for ensemble poles.',
      }),
      node('u', 'constant', 16, 128, { value: 0 }, 'u = 0'),
      node(
        'plant',
        'secondorder',
        160,
        120,
        { wn: 2, zeta: 0.002, K: 1, y0: 0, dy0: 1 },
        'Oscillator',
        'plant',
        {
          wn: unc('percent', 4101, 8),
        }
      ),
      node('scope', 'scope', 360, 48, { inputCount: 2, timeSpan: 10, autoScale: true, yMin: -1.2, yMax: 1.2 }, 'y and ẏ'),
      node('meter', 'meter', 360, 260, { digits: 3 }, 'y'),
    ],
    edges: [
      edge('u', 'out', 'plant', 'u'),
      edge('plant', 'y', 'scope', 'in0'),
      edge('plant', 'dy', 'scope', 'in1'),
      edge('plant', 'y', 'meter', 'in'),
    ],
  };
}

export function motorDocument(): SimDocument {
  return {
    name: 'DC motor speed control',
    description:
      'DC motor under PID with Monte Carlo on R, J, b, Kt; Stage Va trim / load kick / spin nudges; Design campaigns for margins.',
    config: mcConfig({ stepSize: 0.001, stopTime: 8, mcCampaignSize: 2000 }),
    design: designConfig({ Q: [5, 20, 0, 0, 0, 0], R: 0.2 }),
    nodes: [
      node('note', 'note', 16, 8, {
        text: 'MC on R, J, b, Kt. Design → Analyze. Stage: Va trim, Load kick, Spin nudges. Auto load pulse at t=4 s.',
      }),
      node('ref', 'step', 16, 120, { stepTime: 0.4, initialValue: 0, finalValue: 5 }, 'ω ref'),
      node('sum', 'sum', 150, 112, { signs: '+-' }, 'Error'),
      node(
        'pid',
        'pid',
        280,
        120,
        { Kp: 8, Ki: 25, Kd: 0.2, Tf: 0.02, limitOutput: true, upperLimit: 48, lowerLimit: -48 },
        'PID'
      ),
      node('manual', 'manual', 150, 280, { value: 0, min: -12, max: 12 }, 'Va trim'),
      node('sum-va', 'sum', 400, 120, { signs: '++' }, 'Σ Va'),
      node('load', 'pulse', 400, 280, { amplitude: 0.05, delay: 4, width: 0.5, period: 0 }, 'Load pulse'),
      node(
        'motor',
        'dcmotor',
        560,
        150,
        { R: 1, L: 0.05, Kt: 0.1, Kb: 0.1, J: 0.02, b: 0.05 },
        'DC motor',
        'motor',
        {
          R: unc('percent', 5101, 10),
          J: unc('percent', 5102, 15),
          b: unc('percent', 5103, 20),
          Kt: unc('percent', 5104, 8),
        }
      ),
      node('angle', 'integrator', 560, 300, { initialCondition: 0 }, 'θ = ∫ω'),
      node('scope', 'scope', 780, 40, { inputCount: 2, timeSpan: 8, autoScale: true, yMin: -1, yMax: 6 }, 'Ref & ω'),
      node('meter', 'meter', 780, 280, { digits: 3 }, 'ω'),
      node('stage', 'stage', 960, 140, { ...SCENE_ROTOR }, 'Stage'),
    ],
    edges: [
      edge('ref', 'out', 'sum', 'in0'),
      edge('motor', 'w', 'sum', 'in1'),
      edge('sum', 'out', 'pid', 'in'),
      edge('pid', 'out', 'sum-va', 'in0'),
      edge('manual', 'out', 'sum-va', 'in1'),
      edge('sum-va', 'out', 'motor', 'Va'),
      edge('load', 'out', 'motor', 'TL'),
      edge('motor', 'w', 'angle', 'in'),
      edge('ref', 'out', 'scope', 'in0'),
      edge('motor', 'w', 'scope', 'in1'),
      edge('motor', 'w', 'meter', 'in'),
      edge('angle', 'out', 'stage', 'theta'),
      edge('motor', 'T', 'stage', 'torque'),
      edge('motor', 'w', 'stage', 'omega'),
    ],
  };
}

export function pneumaticDocument(): SimDocument {
  return {
    name: 'Pneumatic tank charge',
    description:
      'Valve + isothermal tank with MC on Cd and C; Stage valve trim / burp pulse; open Design for uncertainty campaigns.',
    config: mcConfig({ stepSize: 0.002, stopTime: 10, mcCampaignSize: 1200 }),
    design: designConfig({ Q: [10, 0, 0, 0, 0, 0], R: 1 }),
    nodes: [
      node('note', 'note', 16, 8, {
        text: 'MC on valve Cd and tank C. Stage: Valve trim + Burp. Design → Analyze uses the tank as the Dynamics plant when selected.',
      }),
      node('supply', 'constant', 16, 120, { value: 5 }, 'Supply p'),
      node('open', 'step', 16, 240, { stepTime: 0.5, initialValue: 0, finalValue: 0.7 }, 'Valve open'),
      node('manual', 'manual', 16, 360, { value: 0, min: 0, max: 1 }, 'Valve trim'),
      node('burp', 'pulse', 200, 360, { amplitude: 0.35, delay: 1e9, width: 0.25, period: 0 }, 'Burp'),
      node('sum-open', 'sum', 200, 240, { signs: '+++' }, 'Σ open'),
      node('valve', 'pneumatic_valve', 360, 150, { Cd: 0.35 }, 'Valve', 'valve', {
        Cd: unc('percent', 6101, 15),
      }),
      node('vent', 'constant', 360, 300, { value: 0 }, 'Vent q'),
      node('tank', 'pneumatic_tank', 540, 160, { C: 0.05, p0: 1 }, 'Tank', 'tank', {
        C: unc('percent', 6102, 12),
      }),
      node('scope', 'scope', 720, 48, { inputCount: 2, timeSpan: 10, autoScale: true, yMin: 0, yMax: 5.5 }, 'p & q'),
      node('meter', 'meter', 720, 280, { digits: 3 }, 'p'),
      node('stage', 'stage', 900, 140, { ...SCENE_TANK }, 'Stage'),
    ],
    edges: [
      edge('supply', 'out', 'valve', 'p1'),
      edge('tank', 'p', 'valve', 'p2'),
      edge('open', 'out', 'sum-open', 'in0'),
      edge('manual', 'out', 'sum-open', 'in1'),
      edge('burp', 'out', 'sum-open', 'in2'),
      edge('sum-open', 'out', 'valve', 'open'),
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

/** Rigid 6-DoF aircraft (NASA TM 88104 / H-1391): nonlinear plant + Design linearization about trim. */
export function aircraftDocument(): SimDocument {
  const plant = aircraftPlantParameters({
    V: 60,
    h: 1000,
    paramExprs: AIRCRAFT_SCHEDULE_EXAMPLE,
  });
  const u0 = String(plant.u0)
    .trim()
    .split(/[\s,;]+/)
    .map(Number);
  const de0 = u0[0] ?? 0;
  const dt0 = u0[3] ?? 0.4;
  return {
    name: 'Aircraft 6-DoF',
    description:
      'Nonlinear rigid 6-DoF aircraft (NASA H-1391 state: pqr, Vαβ, Euler, NED) with linear aero, thrust, and scheduled ρ(h)/m(t). Open-loop at wings-level trim; Design analyzes the FD linearization about that trim.',
    config: mcConfig({ stepSize: 0.01, stopTime: 40, speed: 4, mcCampaignSize: 500, mcOverlayCount: 24 }),
    design: designConfig({
      opMode: 'x0',
      xOp: String(plant.x0),
      uOp: String(plant.u0),
      tOp: 10,
      Q: [2, 4, 2, 0.05, 20, 10, 8, 8, 1, 0.001, 0.0001, 0.0001],
      R: 2,
      controller: 'lqr',
      analysis: ['poles', 'ctrb', 'damping', 'margins', 'polemap', 'bode', 'nyquist', 'nichols', 'rlocus'],
    }),
    nodes: [
      node('note', 'note', 16, 8, {
        text:
          '6-DoF (H-1391) with paramExprs ρ(h)/m(t). Design t*=10 s. Linearize: ODEs use analytical Jacobians; aircraft defaults to FD or paste linA/linB. Gains: k(t,s) / gainExprs.',
      }),
      node('de', 'constant', 40, 120, { value: de0 }, 'δe trim'),
      node('da', 'constant', 40, 200, { value: 0 }, 'δa'),
      node('dr', 'constant', 40, 280, { value: 0 }, 'δr'),
      node('dt', 'constant', 40, 360, { value: dt0 }, 'δt trim'),
      node('debias', 'manual', 40, 440, { value: 0, min: -0.2, max: 0.2 }, 'δe bias'),
      node('desum', 'sum', 220, 160, { signs: '++' }, 'Σ δe'),
      node(
        'plant',
        'aircraft',
        420,
        200,
        { ...plant },
        'Aircraft 6-DoF',
        'plant',
        {
          m: unc('percent', 8811, 5),
          Cma: unc('percent', 8812, 12),
          CLa: unc('percent', 8813, 8),
        }
      ),
      node('stage', 'stage', 760, 200, { ...SCENE_AIRCRAFT }, 'Stage'),
    ],
    edges: [
      edge('de', 'out', 'desum', 'in0'),
      edge('debias', 'out', 'desum', 'in1'),
      edge('desum', 'out', 'plant', 'u1'),
      edge('da', 'out', 'plant', 'u2'),
      edge('dr', 'out', 'plant', 'u3'),
      edge('dt', 'out', 'plant', 'u4'),
      edge('plant', 'y10', 'stage', 'xN'),
      edge('plant', 'y11', 'stage', 'yE'),
      edge('plant', 'y9', 'stage', 'h'),
      edge('plant', 'y8', 'stage', 'psi'),
      edge('plant', 'y3', 'stage', 'V'),
      edge('plant', 'y4', 'stage', 'alpha'),
    ],
  };
}

/** Planar quadrotor chase: outer Pro-Nav → mid attitude → inner rate (+ altitude hold). */
export function quadrotorDocument(): SimDocument {
  const numeric = { m: 1.2, Iyy: 0.03, g: 9.81, bw: 0.04 } as const;
  const hoverT = numeric.m * numeric.g;
  return {
    name: 'Quadrotor Pro-Nav chase',
    description:
      'Planar quadrotor with 3-loop architecture: outer true Pro-Nav guidance, mid pitch attitude, inner pitch-rate; parallel altitude hold. MC on m/Iyy. Stage: alt bias / gust / pitch nudges.',
    config: mcConfig({ stepSize: 0.002, stopTime: 8, mcCampaignSize: 500, mcOverlayCount: 48 }),
    design: designConfig({ Q: [4, 8, 1, 2, 20, 4], R: 0.4, analysis: ['poles', 'bode'] }),
    nodes: [
      node('note', 'note', 16, 8, {
        text:
          '3 loops: Pro Nav (a_cmd) → attitude PID (θ) → rate PID (ω→τ). Altitude PID holds target z. Stage: Alt bias / Gust. Design linearizes the ODE plant.',
      }),

      // —— Relative geometry (target − interceptor) ——
      node('rx', 'sum', 16, 120, { signs: '+-' }, 'rx = xt−x'),
      node('rz', 'sum', 16, 220, { signs: '+-' }, 'rz = zt−z'),
      node('vrx', 'sum', 16, 320, { signs: '+-' }, 'vrx'),
      node('vrz', 'sum', 16, 420, { signs: '+-' }, 'vrz'),

      // —— Outer loop: proportional navigation ——
      node('pn', 'pronav', 200, 200, { N: 3.2, eps: 0.2, aMax: 4.5, fadeRange: 2 }, 'Pro Nav', 'guidance', {
        N: unc('percent', 8101, 10),
      }),
      // θ_cmd from desired horizontal accel: a_x ≈ −g θ  ⇒  θ ≈ −ax/g
      node('thcmd', 'fcn', 360, 140, { expr: '-u1/9.81' }, 'θ_cmd ≈ −ax/g'),
      node('thsat', 'saturation', 500, 140, { upperLimit: 0.4, lowerLimit: -0.4 }, 'θ_cmd sat'),

      // —— Mid loop: attitude ——
      node('eth', 'sum', 640, 132, { signs: '+-' }, 'eθ'),
      node(
        'att',
        'pid',
        780,
        140,
        { Kp: 7, Ki: 0.15, Kd: 1.0, Tf: 0.04, limitOutput: true, upperLimit: 3.5, lowerLimit: -3.5 },
        'Attitude PID'
      ),

      // —— Inner loop: rate ——
      node('ew', 'sum', 940, 132, { signs: '+-' }, 'eω'),
      node(
        'rate',
        'pid',
        1080,
        140,
        { Kp: 2.8, Ki: 0, Kd: 0.03, Tf: 0.02, limitOutput: true, upperLimit: 2.2, lowerLimit: -2.2 },
        'Rate PID'
      ),
      node('tausat', 'saturation', 1240, 140, { upperLimit: 2.2, lowerLimit: -2.2 }, 'τ sat'),

      // —— Altitude: hover + PN az feedforward + track target z ——
      node('zbias', 'manual', 200, 420, { value: 0, min: -2, max: 2 }, 'Alt bias'),
      node('zref', 'sum', 360, 400, { signs: '++' }, 'z ref'),
      node('ez', 'sum', 500, 400, { signs: '+-' }, 'ez'),
      node(
        'alt',
        'pid',
        640,
        408,
        { Kp: 6, Ki: 2.5, Kd: 3.5, Tf: 0.05, limitOutput: true, upperLimit: 6, lowerLimit: -6 },
        'Altitude PID'
      ),
      node('azff', 'fcn', 640, 520, { expr: '1.2*u1' }, 'm·az FF'),
      node('azsat', 'saturation', 780, 520, { upperLimit: 5, lowerLimit: -5 }, 'az FF sat'),
      node('hover', 'constant', 780, 600, { value: hoverT }, 'mg hover'),
      node('gust', 'pulse', 900, 600, { amplitude: 4, delay: 1e9, width: 0.25, period: 0 }, 'Gust'),
      node('tsum', 'sum', 900, 420, { signs: '++++' }, 'Σ T'),
      node('tsat', 'saturation', 1060, 420, { upperLimit: 22, lowerLimit: 4 }, 'T sat'),

      // —— Plant: planar quadrotor + target ——
      node(
        'plant',
        'ode',
        1240,
        360,
        { ...QUADROTOR_ODE, ...numeric },
        'Quad + target',
        'plant',
        {
          m: unc('percent', 8102, 8),
          Iyy: unc('percent', 8103, 15),
        }
      ),

      node('scope', 'scope', 1480, 80, { inputCount: 3, timeSpan: 10, autoScale: true, yMin: -1, yMax: 16 }, 'x / xt / z'),
      node('scope2', 'scope', 1480, 280, { inputCount: 2, timeSpan: 10, autoScale: true, yMin: -1.2, yMax: 1.2 }, 'θ / a_cmd'),
      node('meter', 'meter', 1480, 480, { digits: 2 }, 'range proxy'),
      node('rng', 'fcn', 1320, 520, { expr: 'hypot(u1,u2)' }, 'Range'),
      // Stage link angles are from vertical; add π/2 so θ=0 draws a level nose.
      node('noseang', 'fcn', 1480, 560, { expr: 'u1+1.57079632679' }, 'nose ∠'),
      node('stage', 'stage', 1680, 300, { ...SCENE_QUAD }, 'Stage'),
    ],
    edges: [
      // Relative geometry from plant outputs y0..y9 = x,z,vx,vz,θ,ω,xt,zt,vxt,vzt
      edge('plant', 'y6', 'rx', 'in0'),
      edge('plant', 'y0', 'rx', 'in1'),
      edge('plant', 'y7', 'rz', 'in0'),
      edge('plant', 'y1', 'rz', 'in1'),
      edge('plant', 'y8', 'vrx', 'in0'),
      edge('plant', 'y2', 'vrx', 'in1'),
      edge('plant', 'y9', 'vrz', 'in0'),
      edge('plant', 'y3', 'vrz', 'in1'),

      // Outer PN
      edge('rx', 'out', 'pn', 'rx'),
      edge('rz', 'out', 'pn', 'rz'),
      edge('vrx', 'out', 'pn', 'vrx'),
      edge('vrz', 'out', 'pn', 'vrz'),
      edge('pn', 'ax', 'thcmd', 'u1'),
      edge('thcmd', 'out', 'thsat', 'in'),

      // Mid attitude
      edge('thsat', 'out', 'eth', 'in0'),
      edge('plant', 'y4', 'eth', 'in1'),
      edge('eth', 'out', 'att', 'in'),

      // Inner rate
      edge('att', 'out', 'ew', 'in0'),
      edge('plant', 'y5', 'ew', 'in1'),
      edge('ew', 'out', 'rate', 'in'),
      edge('rate', 'out', 'tausat', 'in'),
      edge('tausat', 'out', 'plant', 'u2'),

      // Altitude (track target z + PN az feedforward)
      edge('plant', 'y7', 'zref', 'in0'),
      edge('zbias', 'out', 'zref', 'in1'),
      edge('zref', 'out', 'ez', 'in0'),
      edge('plant', 'y1', 'ez', 'in1'),
      edge('ez', 'out', 'alt', 'in'),
      edge('pn', 'az', 'azff', 'u1'),
      edge('azff', 'out', 'azsat', 'in'),
      edge('alt', 'out', 'tsum', 'in0'),
      edge('azsat', 'out', 'tsum', 'in1'),
      edge('hover', 'out', 'tsum', 'in2'),
      edge('gust', 'out', 'tsum', 'in3'),
      edge('tsum', 'out', 'tsat', 'in'),
      edge('tsat', 'out', 'plant', 'u1'),

      // Scopes / Stage
      edge('plant', 'y0', 'scope', 'in0'),
      edge('plant', 'y6', 'scope', 'in1'),
      edge('plant', 'y1', 'scope', 'in2'),
      edge('plant', 'y4', 'scope2', 'in0'),
      edge('pn', 'ax', 'scope2', 'in1'),
      edge('rx', 'out', 'rng', 'u1'),
      edge('rz', 'out', 'rng', 'u2'),
      edge('rng', 'out', 'meter', 'in'),
      edge('plant', 'y0', 'stage', 'x'),
      edge('plant', 'y1', 'stage', 'z'),
      edge('plant', 'y4', 'stage', 'theta'),
      edge('plant', 'y4', 'noseang', 'u1'),
      edge('noseang', 'out', 'stage', 'nose'),
      edge('plant', 'y6', 'stage', 'xt'),
      edge('plant', 'y7', 'stage', 'zt'),
      edge('tsat', 'out', 'stage', 'thrust'),
    ],
  };
}

/** Luenberger observer + discrete Kalman on an uncertain second-order plant. */
export function observerDocument(): SimDocument {
  // Plant: ÿ + 2ζωẏ + ω²y = u  → companion A = [[0,1],[-ω²,-2ζω]], B=[[0],[1]], C=[1,0]
  // Observer L chosen for faster error poles than plant.
  return {
    name: 'Observer & Kalman',
    description:
      'Second-order plant with Monte Carlo on ωn/ζ. Luenberger observer estimates (y,ẏ); discrete Kalman runs in parallel. Lab pane: step experiment + sensitivity.',
    config: mcConfig({ stepSize: 0.002, stopTime: 8, mcCampaignSize: 800, mcOverlayCount: 64 }),
    design: designConfig({ Q: [20, 4, 0, 0, 0, 0], R: 0.4 }),
    nodes: [
      node('note', 'note', 16, 8, {
        text: 'Plant y vs observer x̂0 / Kalman x̂0. Design → Analyze MC. Lab → experiment / PID tune / share link.',
      }),
      node('ref', 'step', 16, 120, { stepTime: 0.2, initialValue: 0, finalValue: 1 }, 'u step'),
      node(
        'plant',
        'secondorder',
        200,
        112,
        { wn: 2, zeta: 0.35, K: 1, y0: 0, dy0: 0 },
        'Plant',
        'plant',
        {
          wn: unc('percent', 5101, 10),
          zeta: unc('percent', 5102, 20),
        }
      ),
      node(
        'obs',
        'observer',
        420,
        40,
        {
          A: '0 1; -4 -1.4',
          B: '0; 1',
          C: '1 0',
          D: '0',
          L: '4; 6',
          x0: '0 0',
        },
        'Luenberger'
      ),
      node(
        'kf',
        'kalman',
        420,
        260,
        {
          A: '1 0.02; -0.08 0.972',
          B: '0; 0.02',
          C: '1 0',
          D: '0',
          Q: '1e-5 0; 0 1e-4',
          R: '1e-3',
          x0: '0 0',
          sampleTime: 0.02,
        },
        'Kalman'
      ),
      node('scope', 'scope', 680, 80, { inputCount: 3, timeSpan: 8, autoScale: true, yMin: -0.2, yMax: 1.4 }, 'y / obs / KF'),
      node('meter', 'meter', 680, 300, { digits: 3 }, 'y'),
    ],
    edges: [
      edge('ref', 'out', 'plant', 'u'),
      edge('plant', 'y', 'obs', 'y0'),
      edge('ref', 'out', 'obs', 'u0'),
      edge('plant', 'y', 'kf', 'y0'),
      edge('ref', 'out', 'kf', 'u0'),
      edge('plant', 'y', 'scope', 'in0'),
      edge('obs', 'x0', 'scope', 'in1'),
      edge('kf', 'x0', 'scope', 'in2'),
      edge('plant', 'y', 'meter', 'in'),
    ],
  };
}

export function blankDocument(): SimDocument {
  return {
    name: 'Untitled',
    description: 'Empty diagram — add Dynamics blocks, enable MC distributions, then Design → Analyze.',
    config: mcConfig({ stopTime: 10, mcCampaignSize: 500 }),
    design: designConfig(),
    nodes: [
      node('note', 'note', 80, 80, {
        text: 'Drag Dynamics blocks to build a plant. On Properties, set parameter distributions. Design pane runs stability + MC campaigns; Stage binds control/disturbance as data.',
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
    summary: 'LQR ODE plant with MC uncertainty, Design campaigns, and Stage kicks.',
    create: pendulumDocument,
  },
  {
    id: 'motor',
    name: 'DC motor speed control',
    summary: 'PID motor with MC on R/J/b/Kt and Stage Va trim / load kick.',
    create: motorDocument,
  },
  {
    id: 'pneumatic',
    name: 'Pneumatic tank charge',
    summary: 'Valve + tank with MC on Cd/C and Stage valve trim.',
    create: pneumaticDocument,
  },
  {
    id: 'pid',
    name: 'PID on second-order plant',
    summary: 'Uncertain second-order plant, Stage hand u, Design Bode/Nyquist.',
    create: pidDocument,
  },
  {
    id: 'oscillator',
    name: 'Mass-spring-damper',
    summary: 'm/c/k Monte Carlo with Stage force / impulse.',
    create: oscillatorDocument,
  },
  {
    id: 'harmonic',
    name: 'Harmonic oscillator',
    summary: 'Uncertain −ω² gain — Design pole-cloud campaign.',
    create: harmonicDocument,
  },
  {
    id: 'observer',
    name: 'Observer & Kalman',
    summary: 'Luenberger + discrete Kalman on an uncertain second-order plant.',
    create: observerDocument,
  },
  {
    id: 'quadrotor',
    name: 'Quadrotor Pro-Nav chase',
    summary: '3-loop planar quadrotor: Pro-Nav guidance → attitude → rate (+ altitude).',
    create: quadrotorDocument,
  },
  {
    id: 'aircraft',
    name: 'Aircraft 6-DoF',
    summary: 'NASA H-1391 rigid 6-DoF plant; Design FD-linearizes about wings-level trim.',
    create: aircraftDocument,
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
      uncertainty: item.uncertainty,
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
