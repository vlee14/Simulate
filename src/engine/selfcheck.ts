import { PLANT_RECIPES } from '../model/builder';
import { documentGraph, pendulumDocument, regulatorGains, oscillatorDocument, motorDocument, pneumaticDocument } from '../model/examples';
import { CART_DOUBLE_PENDULUM_ODE } from '../model/plants';
import { compileExpression } from './expr';
import { SimCompileError, compile } from './compile';
import { eigenvalues } from './eig';
import { designDynamicsLqr, lqr } from './lqr';
import { lagrangianResidual, pendulumDerivatives, DEFAULT_PENDULUM, linearizePendulum } from './physics';
import { SimulationEngine } from './runtime';
import { expandGraph, stringifyBlueprint } from './subsystem';

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

function close(a: number, b: number, tol: number, message: string): void {
  if (Math.abs(a - b) > tol) throw new Error(`${message}: got ${a}, expected ${b} ± ${tol}`);
}

function integrate(z0: number[], seconds: number, force: (z: number[], t: number) => number, h = 0.001): number[] {
  const z = z0.slice();
  const stage = z.slice();
  const k1 = [0, 0, 0, 0, 0, 0];
  const k2 = [0, 0, 0, 0, 0, 0];
  const k3 = [0, 0, 0, 0, 0, 0];
  const k4 = [0, 0, 0, 0, 0, 0];
  const base = z.slice();
  let t = 0;
  const deriv = (tNow: number, state: number[], out: number[]) => {
    pendulumDerivatives(state, force(state, tNow), DEFAULT_PENDULUM, out);
  };
  while (t < seconds - 1e-12) {
    const dt = Math.min(h, seconds - t);
    base.splice(0, 6, ...z);
    deriv(t, base, k1);
    for (let i = 0; i < 6; i++) stage[i] = base[i] + 0.5 * dt * k1[i];
    deriv(t + 0.5 * dt, stage, k2);
    for (let i = 0; i < 6; i++) stage[i] = base[i] + 0.5 * dt * k2[i];
    deriv(t + 0.5 * dt, stage, k3);
    for (let i = 0; i < 6; i++) stage[i] = base[i] + dt * k3[i];
    deriv(t + dt, stage, k4);
    for (let i = 0; i < 6; i++) z[i] = base[i] + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
    t += dt;
  }
  return z;
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

  const samples = [
    [0.2, 0.4, -0.3, 0.1, -0.5, 0.2, 3],
    [0, 0.01, -0.02, 0, 0, 0, 0],
    [-0.4, Math.PI, Math.PI, 0.3, 1.2, -0.7, -4],
    [0.1, 1.2, 2.4, -0.2, 0.4, -1.1, 8],
  ];
  for (const sample of samples) {
    const err = lagrangianResidual(sample.slice(0, 3), sample.slice(3, 6), sample[6], DEFAULT_PENDULUM);
    assert(err < 5e-4, `Lagrangian residual ${err} for ${sample.join(',')}`);
  }

  const fallen = integrate([0, 0.08, 0, 0, 0, 0], 0.45, () => 0);
  assert(Math.abs(fallen[1]) > 0.15, `uncontrolled pendulum should fall, θ1=${fallen[1]}`);

  const { A, B } = linearizePendulum(DEFAULT_PENDULUM);
  const open = eigenvalues(A);
  assert(open.length === 6, `expected 6 open-loop poles, got ${open.length}`);
  assert(open.some((e) => e.real > 0.5), `upright equilibrium should be unstable ${JSON.stringify(open)}`);

  const weights = [40, 20, 20, 10, 0.5, 0.5];
  const odeLqr = designDynamicsLqr('ode', { ...CART_DOUBLE_PENDULUM_ODE }, weights, 0.8);
  assert(odeLqr.polesClosed.length === 6, `expected 6 closed-loop poles from ODE, got ${odeLqr.polesClosed.length}`);
  assert(odeLqr.polesClosed.every((e) => e.real < 0), 'ODE LQR closed loop should be stable');

  const ref = lqr(A, B, weights, 0.8);
  for (let i = 0; i < 6; i++) {
    assert(Math.abs(odeLqr.K[i] - ref.K[i]) < 0.25, `ODE LQR K[${i}]=${odeLqr.K[i]} vs physics ${ref.K[i]}`);
  }

  const doc = pendulumDocument();
  const designed = designDynamicsLqr('ode', { ...CART_DOUBLE_PENDULUM_ODE }, doc.design.Q, doc.design.R);
  assert(designed.polesClosed.length === 6, `expected 6 closed-loop poles, got ${designed.polesClosed.length}`);
  console.log('K', designed.K.map((v) => Number(v.toFixed(3))).join(', '));
  console.log(
    'closed poles',
    designed.polesClosed.map((e) => `${e.real.toFixed(2)}${e.imag ? (e.imag > 0 ? '+' : '') + e.imag.toFixed(2) + 'j' : ''}`).join('  ')
  );
  const gains = regulatorGains(designed.K);
  for (const [id, value] of Object.entries(gains)) {
    const item = doc.nodes.find((entry) => entry.id === id);
    assert(!!item, `missing ${id}`);
    close(Number(item!.parameters?.k), value, 1e-6, `baked gain ${id}`);
  }
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
