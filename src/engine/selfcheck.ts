import { PLANT_RECIPES } from '../model/builder';
import { documentGraph, pendulumDocument, oscillatorDocument, motorDocument, pneumaticDocument } from '../model/examples';
import { CART_DOUBLE_PENDULUM_ODE } from '../model/plants';
import { SCENE_CART_PENDULUM } from '../model/scenes';
import { compileExpression } from './expr';
import { SimCompileError, compile } from './compile';
import { eigenvalues } from './eig';
import { designDynamicsLqr, lqr } from './lqr';
import { linearizeBlock } from './linearize';
import { SimulationEngine } from './runtime';
import { parseStageConfig, stageTrailTip } from './scene';
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

  console.log('selfcheck ok');
}

main();
