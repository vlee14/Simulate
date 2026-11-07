import { PLANT_RECIPES } from '../model/builder';
import {
  documentGraph,
  EXAMPLES,
  harmonicDocument,
  motorDocument,
  observerDocument,
  oscillatorDocument,
  pendulumDocument,
  pidDocument,
  pneumaticDocument,
  quadrotorDocument,
} from '../model/examples';
import { SCENE_QUAD } from '../model/scenes';
import { QUADROTOR_ODE } from '../model/plants';
import { runExperiment } from './experiments';
import { encodeDocumentShare, decodeDocumentShare, traceToCsv } from './exportShare';
import { HistoryStack } from '../sim/history';
import { runSensitivity } from './sensitivity';
import { parsePoleList, placePolesSiso, tunePidImc } from './synthesis';
import { CART_DOUBLE_PENDULUM_ODE } from '../model/plants';
import { SCENE_CART_PENDULUM, SCENE_ROTOR, SCENE_TANK } from '../model/scenes';
import { compileExpression } from './expr';
import { SimCompileError, compile } from './compile';
import { eigenvalues } from './eig';
import { designDynamicsLqr, lqr } from './lqr';
import { linearizeBlock } from './linearize';
import { SimulationEngine } from './runtime';
import { fitStageCamera, parseStageConfig, stageFollowPoint, stageTrailTip, stageWorldBounds, worldToCanvas } from './scene';
import { analyzeStability, logspace, parseVector } from './stability';
import { frequencyResponseBatchCpu, packPlant } from './freqBatch';
import { sampleMcRange } from './mcSample';
import { applyMonteCarlo, countUncertainParams, drawNumeric, mixSeed, mulberry32, recommendMcRuns } from './montecarlo';
import { aggregateCampaign, clampCampaignSize, percentile, pickOverlayRuns } from './mcStats';
import { expandGraph, stringifyBlueprint } from './subsystem';

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

function close(a: number, b: number, tol: number, message: string): void {
  if (Math.abs(a - b) > tol) throw new Error(`${message}: got ${a}, expected ${b} ± ${tol}`);
}

function runEngine(doc: ReturnType<typeof pendulumDocument>, seconds: number): SimulationEngine {
  const graph = documentGraph(doc);
  const engine = new SimulationEngine(graph.nodes, graph.edges, doc.config);
  engine.compile();
  engine.reset();
  const h = doc.config.stepSize;
  while (engine.time < seconds - 1e-9) {
    engine.step(Math.min(h, seconds - engine.time));
  }
  return engine;
}

function main(): void {
  const ev = eigenvalues([
    [0, 1],
    [-2, -3],
  ]);
  const reals = ev.map((e) => e.real).sort((a, b) => a - b);
  close(reals[0], -2, 1e-6, 'eig real 1');
  close(reals[1], -1, 1e-6, 'eig real 2');
  const imag = eigenvalues([
    [0, -2],
    [2, 0],
  ]);
  assert(imag.every((e) => Math.abs(Math.abs(e.imag) - 2) < 1e-6 && Math.abs(e.real) < 1e-6), `rotation eig ${JSON.stringify(imag)}`);

  const scalar = lqr([[0]], [[1]], [1], 1);
  close(scalar.K[0], 1, 1e-5, 'scalar LQR');

  // Uncontrolled mass-matrix ODE tip-up should fall — pure ODE block, no special plant code.
  const openLoop = new SimulationEngine(
    [{ id: 'plant', blockType: 'ode', parameters: { ...CART_DOUBLE_PENDULUM_ODE, x0: '0 0.08 0 0 0 0' } }],
    [],
    { solver: 'rk4', stepSize: 0.001, stopTime: 0.5, startTime: 0, speed: 1 }
  );
  openLoop.compile();
  openLoop.reset();
  while (openLoop.time < 0.45 - 1e-9) openLoop.step(0.001);
  const fallenTh1 = openLoop.compiled!.byId.get('plant')!.outputs.y1;
  assert(Math.abs(fallenTh1) > 0.15, `uncontrolled ODE plant should fall, θ1=${fallenTh1}`);

  const { A } = linearizeBlock('ode', { ...CART_DOUBLE_PENDULUM_ODE });
  const open = eigenvalues(A);
  assert(open.length === 6, `expected 6 open-loop poles, got ${open.length}`);
  assert(open.some((e) => e.real > 0.5), `upright equilibrium should be unstable ${JSON.stringify(open)}`);

  const weights = [40, 20, 20, 10, 0.5, 0.5];
  const odeLqr = designDynamicsLqr('ode', { ...CART_DOUBLE_PENDULUM_ODE }, weights, 0.8);
  assert(odeLqr.polesClosed.length === 6, `expected 6 closed-loop poles from ODE, got ${odeLqr.polesClosed.length}`);
  assert(odeLqr.polesClosed.every((e) => e.real < 0), 'ODE LQR closed loop should be stable');

  const { A: Aeq, B: Beq } = linearizeBlock('ode', { ...CART_DOUBLE_PENDULUM_ODE }, new Array(6).fill(0), [0]);
  const reportEq = analyzeStability(Aeq, Beq.map((row) => [row[0] ?? 0]), odeLqr.K);
  assert(!reportEq.openStable, 'upright open loop should be unstable');
  assert(reportEq.closedStable, 'LQR closed loop should be Hurwitz');
  assert(reportEq.controllable, 'cart–pendulum should be controllable at equilibrium');
  assert(reportEq.modes.length > 0, 'damping analysis should report modes');

  // Custom breakpoint (near tip) still linearizes and yields a report.
  const xTip = parseVector('0 0.2 -0.1 0 0 0', 6);
  const { A: Atip, B: Btip } = linearizeBlock('ode', { ...CART_DOUBLE_PENDULUM_ODE }, xTip, [0]);
  const reportTip = analyzeStability(
    Atip,
    Btip.map((row) => [row[0] ?? 0]),
    odeLqr.K,
    ['poles', 'ctrb', 'margins', 'bode', 'nyquist', 'nichols', 'rlocus']
  );
  assert(reportTip.polesOpen.length === 6, 'breakpoint linearization should keep state dim');
  assert(reportTip.margins != null, 'margins option should produce a margins block');
  assert(reportTip.freq.length > 20, `Bode/Nyquist need frequency samples, got ${reportTip.freq.length}`);
  assert(reportTip.rootLocus.length === 6, `root locus should track ${6} branches`);
  assert(reportTip.rootLocus[0].points.length > 10, 'root locus branches should be sampled');

  const doc = pendulumDocument();
  const designed = designDynamicsLqr('ode', { ...CART_DOUBLE_PENDULUM_ODE }, doc.design.Q, doc.design.R);
  assert(designed.polesClosed.length === 6, `expected 6 closed-loop poles, got ${designed.polesClosed.length}`);
  console.log('K', designed.K.map((v) => Number(v.toFixed(3))).join(', '));
  console.log(
    'closed poles',
    designed.polesClosed.map((e) => `${e.real.toFixed(2)}${e.imag ? (e.imag > 0 ? '+' : '') + e.imag.toFixed(2) + 'j' : ''}`).join('  ')
  );
  for (let i = 0; i < designed.K.length; i++) {
    const item = doc.nodes.find((entry) => entry.id === `k${i}`);
    assert(!!item, `missing k${i}`);
    close(Number(item!.parameters?.k), -designed.K[i], 1e-6, `baked gain k${i}`);
  }
  const kref = doc.nodes.find((entry) => entry.id === 'kref');
  assert(!!kref, 'missing kref');
  close(Number(kref!.parameters?.k), designed.K[0], 1e-6, 'baked gain kref');

  const stage = doc.nodes.find((entry) => entry.blockType === 'stage');
  assert(!!stage, 'pendulum demo needs a Stage');
  const stageCfg = parseStageConfig(stage!.parameters ?? {});
  assert(stageCfg.elements.length >= 3, 'Stage scene should parse to elements');
  assert(stageCfg.nudge.length >= 1, 'Stage nudge buttons should parse');
  assert(!!stageCfg.control && stageCfg.control.block === 'manual', 'Stage control should bind to Manual');
  assert(stageCfg.disturbance.some((item) => item.kind === 'pulse'), 'Stage disturbances should include pulse kicks');
  assert(stageCfg.interact.some((item) => item.target === 'cart' && item.kind === 'nudge'), 'Stage interact should hit cart');
  const tip = stageTrailTip(stageCfg, { x: 0.1, th1: 0.2, th2: -0.1, force: 1 });
  assert(!!tip && Number.isFinite(tip.x) && Number.isFinite(tip.y), 'trail tip should resolve from scene data');
  assert(String(stage!.parameters?.scene ?? '').includes('"type"'), 'Stage scene is JSON data');
  assert(SCENE_CART_PENDULUM.inputs.includes('th1'), 'scene preset is shared data');

  // Stage camera should follow / fit world geometry instead of a fixed origin.
  const farSignals = { x: 2.4, th1: 0.15, th2: -0.1, force: 0 };
  const bounds = stageWorldBounds(stageCfg, farSignals);
  assert(!!bounds && (bounds.minX + bounds.maxX) / 2 > 1.5, 'world bounds should track cart x');
  const cam = fitStageCamera(stageCfg, farSignals, 640, 220, null);
  assert(cam.lookX > 1.2 && cam.lookX < 3.2, 'camera lookX should sit near the cart cluster');
  const tight = fitStageCamera(stageCfg, farSignals, 200, 120, null);
  assert(tight.scale < (stageCfg.scale ?? 140), 'camera should zoom out when the dock is small');
  const stale = fitStageCamera(stageCfg, farSignals, 640, 220, {
    scale: 140,
    lookX: 12,
    lookY: 4,
    originX: 320,
    originY: 110,
  });
  assert(Math.abs(stale.lookX - cam.lookX) < 0.05, 'camera should snap when the previous look is far away');

  // Airborne chase: keep the trailed quad centered even when the target is far away.
  const quadCfg = parseStageConfig({ ...SCENE_QUAD });
  const chase = { x: 12.9, z: 2.9, theta: 0, xt: 1.4, zt: 2.9, thrust: 12 };
  const follow = stageFollowPoint(quadCfg, chase);
  assert(!!follow && Math.abs(follow.x - 12.9) < 0.05, 'follow point should track the quad body');
  const chaseCam = fitStageCamera(quadCfg, chase, 420, 220, null);
  assert(Math.abs(chaseCam.lookX - follow!.x) < 0.05, 'chase lookX pins the quad');
  assert(Math.abs(chaseCam.lookY - follow!.y) < 0.05, 'chase lookY pins the quad');
  assert(chaseCam.scale >= (quadCfg.scale ?? 42) * 0.9, 'chase should keep near-authored scale when target is far');
  const quadPx = worldToCanvas(chaseCam, follow!.x, follow!.y);
  assert(Math.abs(quadPx.x - 210) < 1 && Math.abs(quadPx.y - 110) < 1, 'quad should map to canvas center');
  const lagged = fitStageCamera(quadCfg, chase, 420, 220, {
    scale: chaseCam.scale,
    lookX: follow!.x - 3,
    lookY: follow!.y - 1,
    originX: 210,
    originY: 110,
  });
  assert(Math.abs(lagged.lookX - follow!.x) < 0.05, 'chase look must not ease behind the craft');
  const laggedPx = worldToCanvas(lagged, follow!.x, follow!.y);
  assert(Math.abs(laggedPx.x - 210) < 1, 'quad stays centered even after a lagged previous camera');

  // Live control + pulse disturbance should update sources without special plant code.
  const controlProbe = new SimulationEngine(
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
  controlProbe.compile();
  controlProbe.reset();
  controlProbe.rebuildParams([
    { id: 'manual', blockType: 'manual', parameters: { value: 3, min: -10, max: 10 } },
    { id: 'pulse', blockType: 'pulse', parameters: { amplitude: 5, delay: 0, width: 0.2, period: 0 } },
    { id: 'sum', blockType: 'sum', parameters: { signs: '++' } },
  ]);
  controlProbe.step(0.01);
  close(controlProbe.compiled!.byId.get('sum')!.outputs.out, 8, 1e-9, 'manual+pulse feedthrough');

  const engine = runEngine(doc, 14);
  const plant = engine.compiled!.byId.get('plant')!;
  const x = plant.outputs.y0;
  const th1 = plant.outputs.y1;
  const th2 = plant.outputs.y2;
  console.log('engine t', engine.time.toFixed(3), 'x', x.toFixed(4), 'th', th1.toFixed(4), th2.toFixed(4), 'F', engine.compiled!.byId.get('sum-f')!.outputs.out.toFixed(3));
  assert(Math.abs(th1) < 0.06 && Math.abs(th2) < 0.06, `engine did not balance (${th1}, ${th2})`);
  assert(Math.abs(x) < 0.25, `engine cart at ${x}`);

  const massDoc = oscillatorDocument();
  const massEngine = runEngine(massDoc, 14);
  const massX = massEngine.compiled!.byId.get('mass')!.outputs.x;
  assert(Math.abs(massX - 1) < 0.2, `mass-spring should settle near 1, got ${massX}`);

  const motorEng = runEngine(motorDocument(), 3.5);
  const w = motorEng.compiled!.byId.get('motor')!.outputs.w;
  assert(Math.abs(w - 5) < 1, `motor speed should track 5, got ${w}`);

  const pneuEng = runEngine(pneumaticDocument(), 9);
  const pressure = pneuEng.compiled!.byId.get('tank')!.outputs.p;
  assert(pressure > 2, `tank should charge, p=${pressure}`);

  const expr = compileExpression('sin(u1)^2 + cos(u1)^2 + 0.5*u2');
  close(expr({ u1: 0.4, u2: 4 }), 3, 1e-9, 'expression');

  let looped = false;
  try {
    compile(
      [
        { id: 'a', blockType: 'gain', parameters: { k: 1 } },
        { id: 'b', blockType: 'gain', parameters: { k: 1 } },
      ],
      [
        { id: 'e1', source: 'a', sourceHandle: 'out', target: 'b', targetHandle: 'in' },
        { id: 'e2', source: 'b', sourceHandle: 'out', target: 'a', targetHandle: 'in' },
      ]
    );
  } catch (error) {
    looped = error instanceof SimCompileError;
  }
  assert(looped, 'algebraic loop should be reported');

  const recipe = PLANT_RECIPES.find((item) => item.id === 'cart-pendulum')!;
  const blueprint = recipe.blueprint!();
  const expanded = expandGraph(
    [{ id: 'pack', blockType: 'subsystem', parameters: { blueprint: stringifyBlueprint(blueprint) } }],
    []
  );
  assert(expanded.nodes.some((node) => node.blockType === 'ode'), 'subsystem should expand to an ODE plant');
  assert(!expanded.nodes.some((node) => node.blockType === 'subsystem'), 'subsystem shell should be removed');
  assert(!expanded.nodes.some((node) => node.blockType === 'inport'), 'inports should be spliced away');
  const recipeStage = recipe.create({ x: 0, y: 0 }).nodes.find((node) => node.blockType === 'stage');
  assert(!!recipeStage?.parameters?.scene, 'plant recipe Stage must use scene JSON, not a visual switch');

  const eng = new SimulationEngine(
    [
      { id: 'c', blockType: 'constant', parameters: { value: 1 } },
      { id: 's', blockType: 'sensor', parameters: { gain: 2, bias: 0.5, noise: 0, tau: 0 } },
    ],
    [{ id: 'e', source: 'c', sourceHandle: 'out', target: 's', targetHandle: 'in' }],
    { solver: 'rk4', stepSize: 0.01, stopTime: 0.05, startTime: 0, speed: 1 }
  );
  eng.compile();
  eng.reset();
  eng.step(0.01);
  close(eng.compiled!.byId.get('s')!.outputs.out, 2.5, 1e-9, 'sensor gain/bias');

  // Monte Carlo: run 0 = nominal; seeded draws are stable per parameter seed.
  const unc = { kind: 'normal' as const, seed: 0xc0ffee, spread: 0.5 };
  close(drawNumeric(1, unc, 0), 1, 0, 'MC run 0 is nominal');
  const d1 = drawNumeric(1, unc, 1);
  const d1b = drawNumeric(1, unc, 1);
  close(d1, d1b, 0, 'same seed+run ⇒ same draw');
  assert(Math.abs(d1 - 1) > 1e-6, 'run 1 should differ from nominal (almost surely)');
  const d2 = drawNumeric(1, unc, 2);
  assert(Math.abs(d2 - d1) > 1e-12, 'different runs should differ');
  const otherSeed = { ...unc, seed: 0xbadc0de };
  assert(Math.abs(drawNumeric(1, otherSeed, 1) - d1) > 1e-12, 'different param seeds should differ');
  // Graph apply: only numeric params with uncertainty change; run 0 untouched.
  const mcNodes = [
    {
      id: 'mass',
      blockType: 'mass',
      parameters: { m: 1, x0: 0, v0: 0 } as Record<string, number>,
      uncertainty: { m: unc },
    },
    { id: 'gain', blockType: 'gain', parameters: { k: 3 } as Record<string, number> },
  ];
  const nominalGraph = applyMonteCarlo(mcNodes, 0);
  close(Number(nominalGraph[0].parameters.m), 1, 0, 'MC graph run 0 keeps m');
  const run1 = applyMonteCarlo(mcNodes, 1);
  close(Number(run1[0].parameters.m), d1, 1e-12, 'MC graph uses same draw as drawNumeric');
  close(Number(run1[1].parameters.k), 3, 0, 'params without uncertainty stay nominal');
  // RNG mix is deterministic
  close(mixSeed(1, 1), mixSeed(1, 1), 0, 'mixSeed stable');
  const u = mulberry32(1)();
  assert(u >= 0 && u < 1, 'mulberry32 in [0,1)');

  close(countUncertainParams(mcNodes), 1, 0, 'one uncertain param counted');
  const noneAdvice = recommendMcRuns([]);
  assert(noneAdvice.recommended === 0, 'no-params recommendation is 0');

  // CLT: N = (z·CV/ε)² with CV from percent spread 10% on one param → CV=0.1
  const cltNodes = [
    {
      id: 'm',
      blockType: 'mass',
      parameters: { m: 2, x0: 0, v0: 0 } as Record<string, number>,
      uncertainty: { m: { kind: 'percent' as const, seed: 1, spread: 10 } },
    },
  ];
  const clt = recommendMcRuns(cltNodes, { confidence: 0.95, relError: 0.05, tailQuantile: 0.95, tailCdfError: 0.02 });
  close(clt.cv, 0.1, 1e-9, 'percent 10 → CV 0.1');
  // (1.96*0.1/0.05)^2 ≈ 15.37 → ceil 16 → floored at 30
  close(clt.mean, 30, 0, 'CLT mean floored at 30');
  assert(clt.tails >= clt.mean, 'tails N ≥ mean N');
  assert(clt.screening === clt.mean * (2 * clt.params + 2), 'Saltelli N=M(2p+2)');
  close(clt.recommended, clt.mean, 0, 'primary recommendation is CLT mean');

  // Two uncorrelated 10% params → CV = √2 · 0.1
  const two = recommendMcRuns(
    [
      ...cltNodes,
      {
        id: 'c',
        blockType: 'damper',
        parameters: { c: 1 } as Record<string, number>,
        uncertainty: { c: { kind: 'percent' as const, seed: 2, spread: 10 } },
      },
    ],
    { confidence: 0.95, relError: 0.05 }
  );
  close(two.cv, Math.SQRT2 * 0.1, 1e-9, 'RSS CV for two 10% params');
  assert(two.mean > clt.mean, 'more variance ⇒ larger CLT N');

  close(clampCampaignSize(50_000), 10_000, 0, 'campaign cap 10k');
  close(percentile([1, 2, 3, 4, 5], 0.5), 3, 0, 'median');
  assert(pickOverlayRuns(1000, 8).length === 8, 'overlay picker length');
  const overlayHasSelected = pickOverlayRuns(100, 10, 42);
  assert(!!overlayHasSelected.includes(42), 'overlay keeps selected run');

  // Tiny second-order plant campaign samples
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
    nodes: plantNodes as any,
    xOp: [0, 0],
    uOp: [0],
    K: [1, 0.5],
    runStart: 1,
    runEnd: 12,
    computeFreq: true,
    nOmega: 32,
  });
  assert(samples.length >= 8, `expected MC samples, got ${samples.length}`);
  const ws = logspace(1e-3, 1e3, 32);
  const stats = aggregateCampaign(samples, ws, { overlayCount: 6, backend: 'cpu', elapsedMs: 1 });
  assert(stats.ok === samples.length, 'aggregate ok count');
  assert(!!(stats.bodeMag && stats.bodeMag.p50.length === 32), 'bode band width');
  assert(stats.overlayRuns.length <= 6, 'overlay capped');

  const packed = samples.filter((s) => s.n).map((s) => {
    // rebuild from poles path — pack via linearize already in sample when keepAB
    return packPlant(
      [
        [0, 1],
        [-4, -1.2],
      ],
      [[0], [1]]
    );
  });
  const batch = frequencyResponseBatchCpu(packed.slice(0, 3), [1, 0.5], ws);
  assert(batch.length === 3 * 32 * 4, 'CPU Bode batch shape');
  assert(Number.isFinite(batch[2]), 'CPU Bode mag finite');

  // Demos ship with MC uncertainty + campaign defaults + Stage bindings.
  for (const example of EXAMPLES) {
    const demo = example.create();
    const graph = documentGraph(demo);
    const uncertain = countUncertainParams(graph.nodes);
    assert(uncertain > 0, `${example.id} should enable Monte Carlo distributions`);
    assert((demo.config.mcCampaignSize ?? 0) >= 500, `${example.id} should set an MC campaign size`);
    assert(demo.design.analysis.includes('bode'), `${example.id} should enable Bode in Design`);
  }
  assert(!!SCENE_ROTOR.control && !!SCENE_ROTOR.disturbance, 'rotor Stage should expose control + disturbance');
  assert(!!SCENE_TANK.control && !!SCENE_TANK.disturbance, 'tank Stage should expose control + disturbance');
  const motorStage = motorDocument().nodes.find((n) => n.blockType === 'stage');
  assert(!!parseStageConfig(motorStage?.parameters ?? {}).control, 'motor demo Stage control parses');
  const pid = pidDocument();
  assert(!!pid.nodes.find((n) => n.blockType === 'stage'), 'PID demo includes Stage');
  const harm = harmonicDocument();
  assert(!!harm.nodes.find((n) => n.blockType === 'secondorder'), 'harmonic demo uses second-order plant');
  const osc = oscillatorDocument();
  assert(countUncertainParams(documentGraph(osc).nodes) >= 3, 'mass-spring demo MC on m,c,k');

  // Quadrotor Pro-Nav 3-loop demo
  const quad = quadrotorDocument();
  assert(!!quad.nodes.find((n) => n.blockType === 'pronav'), 'quad demo has Pro-Nav');
  assert(quad.nodes.filter((n) => n.blockType === 'pid').length >= 3, 'quad demo has 3 PID loops');
  assert(!!quad.nodes.find((n) => n.blockType === 'ode'), 'quad demo uses ODE plant');
  const quadStage = quad.nodes.find((n) => n.blockType === 'stage');
  assert(!!parseStageConfig(quadStage?.parameters ?? {}).control, 'quad Stage control parses');
  assert(!!SCENE_QUAD.disturbance, 'quad Stage disturbance defined');
  const quadEngine = runEngine(quad, 6);
  const plantOut = quadEngine.compiled!.byId.get('plant')!;
  const xi = plantOut.outputs.y0;
  const zi = plantOut.outputs.y1;
  const xt = plantOut.outputs.y6;
  assert(Number.isFinite(xi) && Number.isFinite(xt), 'quad states finite');
  assert(xi > 1, `PN chase should advance interceptor x, got ${xi}`);
  assert(Math.abs(zi) < 12 && Math.abs(xi) < 20, `quad should stay bounded, x=${xi} z=${zi}`);
  const range = Math.hypot(xt - xi, plantOut.outputs.y7 - zi);
  assert(range < 8, `range should close under PN, R=${range}`);
  const pn = quadEngine.compiled!.byId.get('pn')!;
  assert(Number.isFinite(pn.outputs.acmd) && Math.abs(pn.outputs.acmd) < 20, 'PN a_cmd finite/clamped');
  assert(QUADROTOR_ODE.nx === 10 && QUADROTOR_ODE.nu === 2, 'quad ODE size');

  // Lab suite: experiments, sensitivity, synthesis, share, history, observer/kalman.
  const obsDoc = observerDocument();
  assert(!!obsDoc.nodes.find((n) => n.blockType === 'observer'), 'observer demo has Luenberger');
  assert(!!obsDoc.nodes.find((n) => n.blockType === 'kalman'), 'observer demo has Kalman');
  const obsEngine = runEngine(obsDoc, 1.5);
  const obsBlock = obsEngine.compiled!.byId.get('obs')!;
  assert(Number.isFinite(obsBlock.outputs.x0), 'observer x̂0 finite');
  const kfBlock = obsEngine.compiled!.byId.get('kf')!;
  assert(Number.isFinite(kfBlock.outputs.x0), 'kalman x̂0 finite');

  const pidGraph = documentGraph(pidDocument());
  const exp = runExperiment(pidGraph.nodes, pidGraph.edges, pidDocument().config, {
    kind: 'step',
    outputBlock: 'plant',
    outputPort: 'y',
    inputBlock: 'ref',
    stopTime: 4,
    stepSize: 0.005,
    mcRuns: 8,
  });
  assert(exp.nominal.trace.t.length > 10, 'experiment trace length');
  assert(!!exp.envelope && exp.envelope.p50.length > 5, 'experiment MC envelope');
  assert(traceToCsv(exp.nominal.trace.t, exp.nominal.trace.y).includes('\n'), 'CSV export');

  const sens = runSensitivity(pidGraph.nodes, pidGraph.edges, pidDocument().config, {
    outputBlock: 'plant',
    outputPort: 'y',
    inputBlock: 'ref',
    kind: 'step',
    metric: 'settlingTime',
  });
  assert(sens.tornado.length >= 1, 'tornado has bars');
  assert(sens.sobolFirst.length >= 1, 'sobol proxy ranks');

  const poles = parsePoleList('-2 -3');
  assert(poles.length === 2, 'parse real poles');
  const place = placePolesSiso(
    [
      [0, 1],
      [-2, -0.8],
    ],
    [[0], [1]],
    poles
  );
  assert(place.K.length === 2, 'Ackermann K length');
  assert(place.polesClosed.every((p) => p.real < 0), 'placed poles stable');
  const tuned = tunePidImc('secondorder', { wn: 2, zeta: 0.3, K: 1 });
  assert(tuned.Kp !== 0 && tuned.Ki !== 0, 'IMC PID gains');

  const roundTrip = decodeDocumentShare(encodeDocumentShare(obsDoc));
  assert(roundTrip.name === obsDoc.name && roundTrip.nodes.length === obsDoc.nodes.length, 'share encode round-trip');

  const hist = new HistoryStack();
  const snapA = {
    elements: [],
    name: 'A',
    description: '',
    config: { ...obsDoc.config },
    design: { ...obsDoc.design!, Q: (obsDoc.design?.Q ?? []).slice(), analysis: (obsDoc.design?.analysis ?? []).slice() },
  };
  hist.push(snapA);
  const snapB = { ...snapA, name: 'B' };
  const undone = hist.undo(snapB);
  assert(undone?.name === 'A', 'history undo');
  const redone = hist.redo(undone!);
  assert(redone?.name === 'B', 'history redo');

  console.log('selfcheck ok');
}

main();
