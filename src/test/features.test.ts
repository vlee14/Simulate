/**
 * Minimal feature coverage — one focused check per product area.
 * Prefer short assertions; deep demos live in their own cases below.
 */
import { describe, expect, it } from 'vitest';
import { PLANT_RECIPES } from '../model/builder';
import {
  EXAMPLES,
  documentGraph,
  harmonicDocument,
  motorDocument,
  observerDocument,
  oscillatorDocument,
  pendulumDocument,
  pidDocument,
  pneumaticDocument,
  quadrotorDocument,
} from '../model/examples';
import { QUADROTOR_ODE, CART_DOUBLE_PENDULUM_ODE } from '../model/plants';
import { SCENE_CART_PENDULUM, SCENE_QUAD, SCENE_ROTOR, SCENE_TANK } from '../model/scenes';
import { HistoryStack } from '../sim/history';
import { SimCompileError, compile } from '../engine/compile';
import { eigenvalues } from '../engine/eig';
import { runExperiment } from '../engine/experiments';
import { decodeDocumentShare, encodeDocumentShare, traceToCsv } from '../engine/exportShare';
import { compileExpression } from '../engine/expr';
import { frequencyResponseBatchCpu, packPlant } from '../engine/freqBatch';
import { designDynamicsLqr, lqr } from '../engine/lqr';
import { linearizeBlock } from '../engine/linearize';
import { sampleMcRange } from '../engine/mcSample';
import { aggregateCampaign, clampCampaignSize, percentile, pickOverlayRuns } from '../engine/mcStats';
import { applyMonteCarlo, countUncertainParams, drawNumeric, recommendMcRuns } from '../engine/montecarlo';
import { SimulationEngine } from '../engine/runtime';
import {
  fitStageCamera,
  parseStageConfig,
  stageFollowPoint,
  stageTrailTip,
  stageWorldBounds,
  worldToCanvas,
} from '../engine/scene';
import { runSensitivity } from '../engine/sensitivity';
import { analyzeStability, logspace, parseVector } from '../engine/stability';
import { expandGraph, stringifyBlueprint } from '../engine/subsystem';
import { parsePoleList, placePolesSiso, tunePidImc } from '../engine/synthesis';
import { close, runEngine } from './helpers';

describe('core numerics', () => {
  it('eigenvalues and scalar LQR', () => {
    const reals = eigenvalues([
      [0, 1],
      [-2, -3],
    ])
      .map((e) => e.real)
      .sort((a, b) => a - b);
    close(reals[0], -2, 1e-6);
    close(reals[1], -1, 1e-6);
    close(lqr([[0]], [[1]], [1], 1).K[0], 1, 1e-5);
  });

  it('expressions and algebraic-loop detection', () => {
    const expr = compileExpression('sin(u1)^2 + cos(u1)^2 + 0.5*u2');
    close(expr({ u1: 0.4, u2: 4 }), 3, 1e-9);
    expect(() =>
      compile(
        [
          { id: 'a', blockType: 'gain', parameters: { k: 1 } },
          { id: 'b', blockType: 'gain', parameters: { k: 1 } },
        ],
        [
          { id: 'e1', source: 'a', sourceHandle: 'out', target: 'b', targetHandle: 'in' },
          { id: 'e2', source: 'b', sourceHandle: 'out', target: 'a', targetHandle: 'in' },
        ]
      )
    ).toThrow(SimCompileError);
  });
});

describe('dynamics + LQR + stability', () => {
  it('ODE plant falls open-loop and LQR stabilizes upright', () => {
    const openLoop = new SimulationEngine(
      [{ id: 'plant', blockType: 'ode', parameters: { ...CART_DOUBLE_PENDULUM_ODE, x0: '0 0.08 0 0 0 0' } }],
      [],
      { solver: 'rk4', stepSize: 0.001, stopTime: 0.5, startTime: 0, speed: 1 }
    );
    openLoop.compile();
    openLoop.reset();
    while (openLoop.time < 0.45 - 1e-9) openLoop.step(0.001);
    expect(Math.abs(openLoop.compiled!.byId.get('plant')!.outputs.y1)).toBeGreaterThan(0.15);

    const { A, B } = linearizeBlock('ode', { ...CART_DOUBLE_PENDULUM_ODE });
    expect(eigenvalues(A).some((e) => e.real > 0.5)).toBe(true);
    const designed = designDynamicsLqr('ode', { ...CART_DOUBLE_PENDULUM_ODE }, [40, 20, 20, 10, 0.5, 0.5], 0.8);
    expect(designed.polesClosed.every((e) => e.real < 0)).toBe(true);

    const report = analyzeStability(
      A,
      B.map((row) => [row[0] ?? 0]),
      designed.K,
      ['poles', 'ctrb', 'margins', 'bode', 'nyquist', 'nichols', 'rlocus']
    );
    expect(report.closedStable).toBe(true);
    expect(report.freq.length).toBeGreaterThan(20);
    expect(report.rootLocus.length).toBe(6);
    expect(parseVector('0 0.2 -0.1 0 0 0', 6)[1]).toBeCloseTo(0.2);
  });
});

describe('stage DSL + camera', () => {
  it('parses scene data and follows cart / chase subjects', () => {
    const stage = pendulumDocument().nodes.find((n) => n.blockType === 'stage')!;
    const cfg = parseStageConfig(stage.parameters ?? {});
    expect(cfg.elements.length).toBeGreaterThanOrEqual(3);
    expect(cfg.control?.block).toBe('manual');
    expect(stageTrailTip(cfg, { x: 0.1, th1: 0.2, th2: -0.1, force: 1 })).toBeTruthy();
    expect(SCENE_CART_PENDULUM.inputs.includes('th1')).toBe(true);

    const far = { x: 2.4, th1: 0.15, th2: -0.1, force: 0 };
    const bounds = stageWorldBounds(cfg, far)!;
    expect((bounds.minX + bounds.maxX) / 2).toBeGreaterThan(1.5);
    const cam = fitStageCamera(cfg, far, 640, 220, null);
    expect(cam.lookX).toBeGreaterThan(1.2);

    const quadCfg = parseStageConfig({ ...SCENE_QUAD });
    const chase = { x: 12.9, z: 2.9, theta: 0, nose: 1.57, xt: 1.4, zt: 2.9, thrust: 12 };
    const follow = stageFollowPoint(quadCfg, chase)!;
    const chaseCam = fitStageCamera(quadCfg, chase, 420, 220, {
      scale: 56,
      lookX: follow.x - 3,
      lookY: follow.y - 1,
      originX: 210,
      originY: 110,
    });
    expect(chaseCam.lookX).toBeCloseTo(follow.x, 5);
    const px = worldToCanvas(chaseCam, follow.x, follow.y);
    expect(Math.abs(px.x - 210)).toBeLessThan(1);
  });
});

describe('runtime blocks', () => {
  it('manual+pulse feedthrough and sensor gain/bias', () => {
    const control = new SimulationEngine(
      [
        { id: 'manual', blockType: 'manual', parameters: { value: 0, min: -10, max: 10 } },
        { id: 'pulse', blockType: 'pulse', parameters: { amplitude: 5, delay: 1e9, width: 0.2, period: 0 } },
        { id: 'sum', blockType: 'sum', parameters: { signs: '++' } },
      ],
      [
        { id: 'e1', source: 'manual', sourceHandle: 'out', target: 'sum', targetHandle: 'in0' },
        { id: 'e2', source: 'pulse', sourceHandle: 'out', target: 'sum', targetHandle: 'in1' },
      ],
      { solver: 'rk4', stepSize: 0.01, stopTime: 1, startTime: 0, speed: 1 }
    );
    control.compile();
    control.reset();
    control.rebuildParams([
      { id: 'manual', blockType: 'manual', parameters: { value: 3, min: -10, max: 10 } },
      { id: 'pulse', blockType: 'pulse', parameters: { amplitude: 5, delay: 0, width: 0.2, period: 0 } },
      { id: 'sum', blockType: 'sum', parameters: { signs: '++' } },
    ]);
    control.step(0.01);
    close(control.compiled!.byId.get('sum')!.outputs.out, 8, 1e-9);

    const sens = new SimulationEngine(
      [
        { id: 'c', blockType: 'constant', parameters: { value: 1 } },
        { id: 's', blockType: 'sensor', parameters: { gain: 2, bias: 0.5, noise: 0, tau: 0 } },
      ],
      [{ id: 'e', source: 'c', sourceHandle: 'out', target: 's', targetHandle: 'in' }],
      { solver: 'rk4', stepSize: 0.01, stopTime: 0.05, startTime: 0, speed: 1 }
    );
    sens.compile();
    sens.reset();
    sens.step(0.01);
    close(sens.compiled!.byId.get('s')!.outputs.out, 2.5, 1e-9);
  });

  it('expands plant recipe subsystems', () => {
    const recipe = PLANT_RECIPES.find((item) => item.id === 'cart-pendulum')!;
    const expanded = expandGraph(
      [{ id: 'pack', blockType: 'subsystem', parameters: { blueprint: stringifyBlueprint(recipe.blueprint!()) } }],
      []
    );
    expect(expanded.nodes.some((n) => n.blockType === 'ode')).toBe(true);
    expect(expanded.nodes.some((n) => n.blockType === 'subsystem')).toBe(false);
  });
});

describe('example demos', () => {
  it('ships MC + Design defaults on every example', () => {
    for (const example of EXAMPLES) {
      const demo = example.create();
      expect(countUncertainParams(documentGraph(demo).nodes)).toBeGreaterThan(0);
      expect(demo.config.mcCampaignSize ?? 0).toBeGreaterThanOrEqual(500);
      expect(demo.design.analysis).toContain('bode');
    }
    expect(SCENE_ROTOR.control && SCENE_ROTOR.disturbance).toBeTruthy();
    expect(SCENE_TANK.control && SCENE_TANK.disturbance).toBeTruthy();
    expect(harmonicDocument().nodes.some((n) => n.blockType === 'secondorder')).toBe(true);
  });

  it('balances pendulum and settles plant demos', () => {
    const eng = runEngine(pendulumDocument(), 14);
    const plant = eng.compiled!.byId.get('plant')!;
    expect(Math.abs(plant.outputs.y1)).toBeLessThan(0.06);
    expect(Math.abs(plant.outputs.y0)).toBeLessThan(0.25);

    expect(Math.abs(runEngine(oscillatorDocument(), 14).compiled!.byId.get('mass')!.outputs.x - 1)).toBeLessThan(0.2);
    expect(Math.abs(runEngine(motorDocument(), 3.5).compiled!.byId.get('motor')!.outputs.w - 5)).toBeLessThan(1);
    expect(runEngine(pneumaticDocument(), 9).compiled!.byId.get('tank')!.outputs.p).toBeGreaterThan(2);
  });

  it('quadrotor Pro-Nav chase closes range', () => {
    const quad = quadrotorDocument();
    expect(quad.nodes.some((n) => n.blockType === 'pronav')).toBe(true);
    expect(quad.nodes.filter((n) => n.blockType === 'pid').length).toBeGreaterThanOrEqual(3);
    expect(QUADROTOR_ODE.nx).toBe(10);

    const out = runEngine(quad, 6).compiled!.byId.get('plant')!;
    const xi = out.outputs.y0;
    const xt = out.outputs.y6;
    expect(xi).toBeGreaterThan(1);
    expect(Math.hypot(xt - xi, out.outputs.y7 - out.outputs.y1)).toBeLessThan(8);
  });

  it('observer + Kalman demo stays finite', () => {
    const eng = runEngine(observerDocument(), 1.5);
    expect(Number.isFinite(eng.compiled!.byId.get('obs')!.outputs.x0)).toBe(true);
    expect(Number.isFinite(eng.compiled!.byId.get('kf')!.outputs.x0)).toBe(true);
  });
});

describe('monte carlo', () => {
  it('seeded draws, recommendations, and campaign aggregate', () => {
    const unc = { kind: 'normal' as const, seed: 0xc0ffee, spread: 0.5 };
    close(drawNumeric(1, unc, 0), 1, 0);
    close(drawNumeric(1, unc, 1), drawNumeric(1, unc, 1), 0);

    const nodes = [
      {
        id: 'mass',
        blockType: 'mass',
        parameters: { m: 1, x0: 0, v0: 0 } as Record<string, number>,
        uncertainty: { m: unc },
      },
    ];
    close(Number(applyMonteCarlo(nodes, 1)[0].parameters.m), drawNumeric(1, unc, 1), 1e-12);

    const advice = recommendMcRuns(
      [
        {
          id: 'm',
          blockType: 'mass',
          parameters: { m: 2, x0: 0, v0: 0 } as Record<string, number>,
          uncertainty: { m: { kind: 'percent' as const, seed: 1, spread: 10 } },
        },
      ],
      { confidence: 0.95, relError: 0.05 }
    );
    close(advice.cv, 0.1, 1e-9);
    close(clampCampaignSize(50_000), 10_000, 0);
    close(percentile([1, 2, 3, 4, 5], 0.5), 3, 0);
    expect(pickOverlayRuns(100, 10, 42)).toContain(42);

    const plantNodes = [
      {
        id: 'plant',
        blockType: 'secondorder',
        parameters: { wn: 2, zeta: 0.3, y0: 0, dy0: 0 } as Record<string, number>,
        uncertainty: { wn: { kind: 'percent' as const, seed: 9, spread: 5 } },
      },
    ];
    const samples = sampleMcRange({
      plantId: 'plant',
      blockType: 'secondorder',
      nodes: plantNodes as never,
      xOp: [0, 0],
      uOp: [0],
      K: [1, 0.5],
      runStart: 1,
      runEnd: 12,
      computeFreq: true,
      nOmega: 32,
    });
    expect(samples.length).toBeGreaterThanOrEqual(8);
    const ws = logspace(1e-3, 1e3, 32);
    const stats = aggregateCampaign(samples, ws, { overlayCount: 6, backend: 'cpu', elapsedMs: 1 });
    expect(stats.bodeMag?.p50.length).toBe(32);
    const packed = [packPlant([[0, 1], [-4, -1.2]], [[0], [1]])];
    expect(frequencyResponseBatchCpu(packed, [1, 0.5], ws).length).toBe(32 * 4);
  });
});

describe('lab suite', () => {
  it('experiments, sensitivity, synthesis, share, undo', () => {
    const doc = pidDocument();
    const graph = documentGraph(doc);
    const exp = runExperiment(graph.nodes, graph.edges, doc.config, {
      kind: 'step',
      outputBlock: 'plant',
      outputPort: 'y',
      inputBlock: 'ref',
      stopTime: 4,
      stepSize: 0.005,
      mcRuns: 8,
    });
    expect(exp.nominal.trace.t.length).toBeGreaterThan(10);
    expect(traceToCsv(exp.nominal.trace.t, exp.nominal.trace.y)).toContain('\n');

    const sens = runSensitivity(graph.nodes, graph.edges, doc.config, {
      outputBlock: 'plant',
      outputPort: 'y',
      inputBlock: 'ref',
      kind: 'step',
      metric: 'settlingTime',
    });
    expect(sens.tornado.length).toBeGreaterThanOrEqual(1);

    const place = placePolesSiso(
      [
        [0, 1],
        [-2, -0.8],
      ],
      [[0], [1]],
      parsePoleList('-2 -3')
    );
    expect(place.K.length).toBe(2);
    expect(tunePidImc('secondorder', { wn: 2, zeta: 0.3, K: 1 }).Kp).not.toBe(0);

    const obs = observerDocument();
    const shared = decodeDocumentShare(encodeDocumentShare(obs));
    expect(shared.nodes.length).toBe(obs.nodes.length);

    const hist = new HistoryStack();
    const snapA = {
      elements: [] as never[],
      name: 'A',
      description: '',
      config: { ...obs.config },
      design: { ...obs.design },
    };
    hist.push(snapA);
    const snapB = { ...snapA, name: 'B' };
    expect(hist.undo(snapB)?.name).toBe('A');
  });
});
