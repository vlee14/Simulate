import { stringifyBlueprint, SubsystemBlueprint } from '../engine/subsystem';
import { Param, ParamUncertainty } from '../engine/types';
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
  SCENE_TANK,
} from './scenes';

const QUAD_NUMERIC = { m: 1.2, Iyy: 0.03, g: 9.81, bw: 0.04 } as const;

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

function unc(kind: ParamUncertainty['kind'], seed: number, spread: number): ParamUncertainty {
  return { kind, seed, spread };
}

export interface BuilderNode {
  id: string;
  blockType: string;
  x: number;
  y: number;
  parameters?: Record<string, Param>;
  alias?: string;
  role?: string;
  uncertainty?: Record<string, ParamUncertainty>;
}

export interface BuilderEdge {
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
}

export interface PlantRecipe {
  id: string;
  name: string;
  summary: string;
  domain: string;
  /** Flat diagram fragment to drop on the canvas. */
  create: (origin: { x: number; y: number }) => { nodes: BuilderNode[]; edges: BuilderEdge[] };
  /** Optional packaged subsystem blueprint for the same plant. */
  blueprint?: () => SubsystemBlueprint;
}

function at(origin: { x: number; y: number }, dx: number, dy: number) {
  return { x: origin.x + dx, y: origin.y + dy };
}

function n(
  id: string,
  blockType: string,
  origin: { x: number; y: number },
  dx: number,
  dy: number,
  parameters?: Record<string, Param>,
  alias?: string,
  uncertainty?: Record<string, ParamUncertainty>
): BuilderNode {
  const p = at(origin, dx, dy);
  return { id, blockType, x: p.x, y: p.y, parameters, alias, role: id, uncertainty };
}

function e(source: string, sourceHandle: string, target: string, targetHandle: string): BuilderEdge {
  return { source, sourceHandle, target, targetHandle };
}

export const PLANT_RECIPES: PlantRecipe[] = [
  {
    id: 'cart-pendulum',
    name: 'Cart–pendulum plant',
    summary: 'Mass-matrix ODE + force actuator + angle encoders + Stage animation.',
    domain: 'mechanical',
    create: (origin) => ({
      nodes: [
        n('act', 'actuator', origin, 0, 40, { kind: 'force', upper: 80, lower: -80, tau: 0.02 }, 'Force actuator'),
        n('manual', 'manual', origin, 0, 160, { value: 0, min: -25, max: 25 }, 'Hand force'),
        n('pulse', 'pulse', origin, 0, 260, { amplitude: 16, delay: 1e9, width: 0.18, period: 0 }, 'Kick'),
        n('sum', 'sum', origin, 180, 120, { signs: '+++' }, 'Σ F'),
        n(
          'plant',
          'ode',
          origin,
          360,
          80,
          { ...CART_DOUBLE_PENDULUM_ODE, ...PENDULUM_NUMERIC },
          'Plant ODE',
          {
            m1: unc('percent', 7101, 8),
            m2: unc('percent', 7102, 8),
            b: unc('percent', 7103, 20),
          }
        ),
        n('enc1', 'encoder', origin, 580, 40, { counts: 4096, noise: 0.002 }, 'θ₁ encoder'),
        n('enc2', 'encoder', origin, 580, 140, { counts: 4096, noise: 0.002 }, 'θ₂ encoder'),
        n('sensX', 'sensor', origin, 580, 240, { kind: 'signal', gain: 1, noise: 0.01, tau: 0.01 }, 'x sensor'),
        n('stage', 'stage', origin, 780, 80, { ...SCENE_CART_PENDULUM }, 'Stage'),
      ],
      edges: [
        e('act', 'out', 'sum', 'in0'),
        e('manual', 'out', 'sum', 'in1'),
        e('pulse', 'out', 'sum', 'in2'),
        e('sum', 'out', 'plant', 'u1'),
        e('plant', 'y1', 'enc1', 'theta'),
        e('plant', 'y2', 'enc2', 'theta'),
        e('plant', 'y0', 'sensX', 'in'),
        e('plant', 'y0', 'stage', 'x'),
        e('plant', 'y1', 'stage', 'th1'),
        e('plant', 'y2', 'stage', 'th2'),
        e('sum', 'out', 'stage', 'force'),
      ],
    }),
    blueprint: (): SubsystemBlueprint => ({
      nodes: [
        { id: 'u', blockType: 'inport', parameters: { name: 'u', domain: 'signal' } },
        { id: 'act', blockType: 'actuator', parameters: { kind: 'force', upper: 80, lower: -80, tau: 0.02 } },
        { id: 'plant', blockType: 'ode', parameters: { ...CART_DOUBLE_PENDULUM_ODE, ...PENDULUM_NUMERIC } },
        { id: 'enc1', blockType: 'encoder', parameters: { counts: 4096, noise: 0.002 } },
        { id: 'enc2', blockType: 'encoder', parameters: { counts: 4096, noise: 0.002 } },
        { id: 'x', blockType: 'outport', parameters: { name: 'x', domain: 'mechanical' } },
        { id: 'th1', blockType: 'outport', parameters: { name: 'th1', domain: 'mechanical' } },
        { id: 'th2', blockType: 'outport', parameters: { name: 'th2', domain: 'mechanical' } },
        { id: 'yth1', blockType: 'outport', parameters: { name: 'th1_hat', domain: 'mechanical' } },
        { id: 'yth2', blockType: 'outport', parameters: { name: 'th2_hat', domain: 'mechanical' } },
      ],
      edges: [
        { source: 'u', sourceHandle: 'out', target: 'act', targetHandle: 'cmd' },
        { source: 'act', sourceHandle: 'out', target: 'plant', targetHandle: 'u1' },
        { source: 'plant', sourceHandle: 'y0', target: 'x', targetHandle: 'in' },
        { source: 'plant', sourceHandle: 'y1', target: 'th1', targetHandle: 'in' },
        { source: 'plant', sourceHandle: 'y2', target: 'th2', targetHandle: 'in' },
        { source: 'plant', sourceHandle: 'y1', target: 'enc1', targetHandle: 'theta' },
        { source: 'plant', sourceHandle: 'y2', target: 'enc2', targetHandle: 'theta' },
        { source: 'enc1', sourceHandle: 'out', target: 'yth1', targetHandle: 'in' },
        { source: 'enc2', sourceHandle: 'out', target: 'yth2', targetHandle: 'in' },
      ],
    }),
  },
  {
    id: 'dc-motor',
    name: 'DC motor plant',
    summary: 'DC motor + voltage actuator + speed sensor + rotor Stage.',
    domain: 'electrical',
    create: (origin) => ({
      nodes: [
        n('act', 'actuator', origin, 0, 100, { kind: 'voltage', upper: 48, lower: -48, tau: 0.01 }, 'Voltage actuator'),
        n(
          'motor',
          'dcmotor',
          origin,
          200,
          80,
          { R: 1, L: 0.05, Kt: 0.1, Kb: 0.1, J: 0.02, b: 0.05 },
          'DC motor',
          {
            R: unc('percent', 7201, 10),
            J: unc('percent', 7202, 15),
            b: unc('percent', 7203, 20),
          }
        ),
        n('load', 'constant', origin, 200, 220, { value: 0 }, 'TL'),
        n('angle', 'integrator', origin, 420, 200, { initialCondition: 0 }, 'θ = ∫ω'),
        n('tach', 'sensor', origin, 420, 40, { kind: 'tachometer', gain: 1, noise: 0.02, tau: 0.01 }, 'Speed sensor'),
        n('curr', 'sensor', origin, 420, 120, { kind: 'current', gain: 1, noise: 0.01 }, 'Current sensor'),
        n('stage', 'stage', origin, 620, 80, { ...SCENE_ROTOR }, 'Stage'),
      ],
      edges: [
        e('act', 'out', 'motor', 'Va'),
        e('load', 'out', 'motor', 'TL'),
        e('motor', 'w', 'tach', 'in'),
        e('motor', 'i', 'curr', 'in'),
        e('motor', 'w', 'angle', 'in'),
        e('angle', 'out', 'stage', 'theta'),
        e('motor', 'T', 'stage', 'torque'),
        e('motor', 'w', 'stage', 'omega'),
      ],
    }),
  },
  {
    id: 'pneumatic-tank',
    name: 'Pneumatic tank plant',
    summary: 'Valve + tank + pressure sensor + tank Stage.',
    domain: 'pneumatic',
    create: (origin) => ({
      nodes: [
        n('supply', 'constant', origin, 0, 40, { value: 5 }, 'Supply'),
        n('open', 'actuator', origin, 0, 160, { kind: 'signal', upper: 1, lower: 0, tau: 0.05 }, 'Opening'),
        n('valve', 'pneumatic_valve', origin, 200, 80, { Cd: 0.35 }, 'Valve', {
          Cd: unc('percent', 7301, 15),
        }),
        n('vent', 'constant', origin, 200, 220, { value: 0 }, 'Vent'),
        n('tank', 'pneumatic_tank', origin, 400, 100, { C: 0.05, p0: 1 }, 'Tank', {
          C: unc('percent', 7302, 12),
        }),
        n('ps', 'sensor', origin, 580, 40, { kind: 'pressure', gain: 1, noise: 0.02, tau: 0.02 }, 'Pressure sensor'),
        n('stage', 'stage', origin, 580, 160, { ...SCENE_TANK }, 'Stage'),
      ],
      edges: [
        e('supply', 'out', 'valve', 'p1'),
        e('tank', 'p', 'valve', 'p2'),
        e('open', 'out', 'valve', 'open'),
        e('valve', 'q', 'tank', 'qin'),
        e('vent', 'out', 'tank', 'qout'),
        e('tank', 'p', 'ps', 'in'),
        e('tank', 'p', 'stage', 'level'),
        e('valve', 'q', 'stage', 'flow'),
      ],
    }),
  },
  {
    id: 'mass-spring',
    name: 'Mass–spring–damper plant',
    summary: 'Mass + spring + damper + force actuator + position sensor + Stage.',
    domain: 'mechanical',
    create: (origin) => ({
      nodes: [
        n('act', 'actuator', origin, 0, 40, { kind: 'force', upper: 5, lower: -5, tau: 0.02 }, 'Force actuator'),
        n('manual', 'manual', origin, 0, 160, { value: 0, min: -5, max: 5 }, 'Hand force'),
        n('sum', 'sum', origin, 180, 70, { signs: '++--' }, 'Σ F'),
        n('mass', 'mass', origin, 360, 80, { m: 1, x0: 0, v0: 0 }, 'Mass', {
          m: unc('percent', 7401, 10),
        }),
        n('damp', 'damper', origin, 180, 220, { c: 0.3 }, 'Damper', {
          c: unc('percent', 7402, 20),
        }),
        n('spring', 'spring', origin, 360, 220, { k: 1 }, 'Spring', {
          k: unc('percent', 7403, 10),
        }),
        n('sens', 'sensor', origin, 540, 40, { kind: 'signal', gain: 1, noise: 0.005, tau: 0.01 }, 'x sensor'),
        n('stage', 'stage', origin, 540, 140, { ...SCENE_MASS_SPRING }, 'Stage'),
      ],
      edges: [
        e('act', 'out', 'sum', 'in0'),
        e('manual', 'out', 'sum', 'in1'),
        e('damp', 'out', 'sum', 'in2'),
        e('spring', 'out', 'sum', 'in3'),
        e('sum', 'out', 'mass', 'F'),
        e('mass', 'v', 'damp', 'in'),
        e('mass', 'x', 'spring', 'in'),
        e('mass', 'x', 'sens', 'in'),
        e('mass', 'x', 'stage', 'x'),
        e('mass', 'v', 'stage', 'v'),
      ],
    }),
  },
  {
    id: 'quadrotor',
    name: 'Quadrotor + target plant',
    summary: 'Planar quadrotor ODE with coasting target + thrust/torque + Stage chase view.',
    domain: 'mechanical',
    create: (origin) => ({
      nodes: [
        n('hover', 'constant', origin, 0, 40, { value: QUAD_NUMERIC.m * QUAD_NUMERIC.g }, 'mg hover'),
        n('manual', 'manual', origin, 0, 140, { value: 0, min: -4, max: 4 }, 'ΔT'),
        n('tau', 'manual', origin, 0, 240, { value: 0, min: -1.5, max: 1.5 }, 'τ'),
        n('tsum', 'sum', origin, 180, 80, { signs: '++' }, 'Σ T'),
        n(
          'plant',
          'ode',
          origin,
          360,
          100,
          { ...QUADROTOR_ODE, ...QUAD_NUMERIC },
          'Quad + target',
          {
            m: unc('percent', 7501, 8),
            Iyy: unc('percent', 7502, 15),
          }
        ),
        n('noseang', 'fcn', origin, 600, 220, { expr: 'u1+1.57079632679' }, 'nose ∠'),
        n('stage', 'stage', origin, 780, 100, { ...SCENE_QUAD }, 'Stage'),
      ],
      edges: [
        e('hover', 'out', 'tsum', 'in0'),
        e('manual', 'out', 'tsum', 'in1'),
        e('tsum', 'out', 'plant', 'u1'),
        e('tau', 'out', 'plant', 'u2'),
        e('plant', 'y0', 'stage', 'x'),
        e('plant', 'y1', 'stage', 'z'),
        e('plant', 'y4', 'stage', 'theta'),
        e('plant', 'y4', 'noseang', 'u1'),
        e('noseang', 'out', 'stage', 'nose'),
        e('plant', 'y6', 'stage', 'xt'),
        e('plant', 'y7', 'stage', 'zt'),
        e('tsum', 'out', 'stage', 'thrust'),
      ],
    }),
  },
  {
    id: 'aircraft',
    name: 'Aircraft 6-DoF',
    summary:
      'NASA H-1391 rigid 6-DoF with linear aero and scheduled ρ(h)/m(t); Design FD-linearizes about trim.',
    domain: 'mechanical',
    create: (origin) => {
      const plant = aircraftPlantParameters({
        V: 60,
        h: 1000,
        paramExprs: AIRCRAFT_SCHEDULE_EXAMPLE,
      });
      const u0 = String(plant.u0)
        .trim()
        .split(/[\s,;]+/)
        .map(Number);
      return {
        nodes: [
          n('de', 'constant', origin, 0, 40, { value: u0[0] ?? 0 }, 'δe trim'),
          n('da', 'constant', origin, 0, 120, { value: 0 }, 'δa'),
          n('dr', 'constant', origin, 0, 200, { value: 0 }, 'δr'),
          n('dt', 'constant', origin, 0, 280, { value: u0[3] ?? 0.4 }, 'δt trim'),
          n('debias', 'manual', origin, 0, 360, { value: 0, min: -0.2, max: 0.2 }, 'δe bias'),
          n('desum', 'sum', origin, 180, 80, { signs: '++' }, 'Σ δe'),
          n(
            'plant',
            'aircraft',
            origin,
            380,
            140,
            { ...plant },
            'Aircraft 6-DoF',
            {
              m: unc('percent', 8801, 5),
              Cma: unc('percent', 8802, 10),
              CLa: unc('percent', 8803, 8),
            }
          ),
          n('stage', 'stage', origin, 700, 140, { ...SCENE_AIRCRAFT }, 'Stage'),
        ],
        edges: [
          e('de', 'out', 'desum', 'in0'),
          e('debias', 'out', 'desum', 'in1'),
          e('desum', 'out', 'plant', 'u1'),
          e('da', 'out', 'plant', 'u2'),
          e('dr', 'out', 'plant', 'u3'),
          e('dt', 'out', 'plant', 'u4'),
          e('plant', 'y10', 'stage', 'xN'),
          e('plant', 'y11', 'stage', 'yE'),
          e('plant', 'y9', 'stage', 'h'),
          e('plant', 'y8', 'stage', 'psi'),
          e('plant', 'y3', 'stage', 'V'),
          e('plant', 'y4', 'stage', 'alpha'),
        ],
      };
    },
  },
];

export function recipeSubsystemNode(recipe: PlantRecipe, origin: { x: number; y: number }): BuilderNode | null {
  if (!recipe.blueprint) return null;
  return {
    id: `plant-${recipe.id}`,
    blockType: 'subsystem',
    x: origin.x,
    y: origin.y,
    alias: recipe.name,
    role: `plant-${recipe.id}`,
    parameters: { blueprint: stringifyBlueprint(recipe.blueprint()) },
  };
}
