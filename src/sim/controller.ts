import { structureSignature, SimCompileError } from '../engine/compile';
import { designPendulumLqr } from '../engine/lqr';
import { readPendulumParams } from '../engine/physics';
import { SimulationEngine } from '../engine/runtime';
import { telemetry } from '../engine/telemetry';
import { toGraph } from '../model/elements';
import { regulatorGains } from '../model/examples';
import { describePoles, useStore } from '../store';

let engine: SimulationEngine | null = null;
let raf = 0;
let acc = 0;
let lastWall = 0;
let lastUi = 0;
let rateSim = 0;
let rateWall = 0;
let signature = '';
let installed = false;

function graphNow() {
  return toGraph(useStore.getState().elements);
}

function fail(error: unknown) {
  cancelAnimationFrame(raf);
  raf = 0;
  const ids = error instanceof SimCompileError ? error.ids : [];
  const message = error instanceof Error ? error.message : 'Simulation failed';
  useStore.getState().setStatus('error', message, ids);
  useStore.getState().setAnimated(false);
}

function loop(now: number) {
  const state = useStore.getState();
  if (!engine || state.status !== 'running') return;
  const elapsed = Math.min(0.05, (now - lastWall) / 1000);
  lastWall = now;
  const speed = state.config.speed > 0 ? state.config.speed : 1;
  acc += elapsed * speed;
  const dt = Math.min(0.05, Math.max(1e-5, state.config.stepSize));
  engine.config = { ...state.config, stepSize: dt };
  engine.rebuildParams(graphNow().nodes);
  let steps = 0;
  try {
    while (acc >= dt && engine.time < state.config.stopTime - 1e-9 && steps < 5000) {
      const h = Math.min(dt, state.config.stopTime - engine.time);
      engine.step(h);
      acc -= h;
      steps++;
    }
  } catch (error) {
    fail(error);
    telemetry.publish();
    return;
  }
  if (acc > 0.25) acc = 0;
  telemetry.publish();
  if (now - lastUi > 80) {
    const wall = Math.max(1e-3, (now - rateWall) / 1000);
    const rate = (engine.time - rateSim) / wall;
    rateSim = engine.time;
    rateWall = now;
    useStore.getState().setTime(engine.time, rate);
    lastUi = now;
  }
  if (engine.time >= state.config.stopTime - 1e-8) {
    useStore.getState().setTime(engine.time, 0);
    useStore.getState().setStatus('done', 'Reached stop time');
    useStore.getState().setAnimated(false);
    return;
  }
  raf = requestAnimationFrame(loop);
}

export function installSimulation(): void {
  if (installed) return;
  installed = true;
  useStore.subscribe((state, prev) => {
    if (state.elements === prev.elements) return;
    if (state.status !== 'running' && state.status !== 'paused') return;
    const next = structureSignature(graphNow().nodes, graphNow().edges);
    if (next !== signature) {
      cancelAnimationFrame(raf);
      engine = null;
      useStore.getState().setAnimated(false);
      useStore.getState().setStatus('idle', 'Diagram changed. Run again to simulate it.');
    } else if (engine) {
      engine.rebuildParams(graphNow().nodes);
    }
  });
}

export function play(): void {
  const state = useStore.getState();
  if (state.status === 'running') return;
  if (!engine || state.status === 'idle' || state.status === 'done' || state.status === 'error') {
    const graph = graphNow();
    const config = { ...state.config };
    if (!(config.stepSize > 0)) {
      state.setStatus('error', 'Step size must be positive.');
      return;
    }
    engine = new SimulationEngine(graph.nodes, graph.edges, config);
    try {
      engine.compile();
      engine.rebuildParams(graph.nodes);
      engine.reset();
      signature = structureSignature(graph.nodes, graph.edges);
    } catch (error) {
      engine = null;
      fail(error);
      return;
    }
    state.setTime(0, 0);
  }
  acc = 0;
  lastWall = performance.now();
  lastUi = 0;
  rateWall = lastWall;
  rateSim = engine?.time ?? 0;
  useStore.getState().setStatus('running', 'Running');
  useStore.getState().setAnimated(true);
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(loop);
}

export function pause(): void {
  if (useStore.getState().status !== 'running') return;
  cancelAnimationFrame(raf);
  raf = 0;
  useStore.getState().setStatus('paused', 'Paused');
  useStore.getState().setAnimated(false);
  telemetry.publish();
}

export function toggleRun(): void {
  if (useStore.getState().status === 'running') pause();
  else play();
}

export function resetSim(): void {
  cancelAnimationFrame(raf);
  raf = 0;
  engine = null;
  signature = '';
  telemetry.reset();
  const store = useStore.getState();
  store.setAnimated(false);
  store.setTime(0, 0);
  store.setStatus('idle', 'Ready');
}

export function nudgePlant(which: 'th1' | 'th2' | 'cart'): void {
  const amount = which === 'th1' ? 0.12 : which === 'th2' ? -0.12 : 0.6;
  const index = which === 'th1' ? 1 : which === 'th2' ? 2 : 3;
  const key = which === 'th1' ? 'th1_0' : which === 'th2' ? 'th2_0' : 'dx0';
  const { elements, status, updateParam } = useStore.getState();
  const plant = elements.find((element) => !('source' in element) && (element.data as { blockType?: string })?.blockType === 'pendulum');
  if (!plant) return;
  if (engine && (status === 'running' || status === 'paused')) {
    engine.nudge(plant.id, index, amount);
    telemetry.publish();
    return;
  }
  const params = (plant.data as { parameters: Record<string, number> }).parameters;
  updateParam(plant.id, key, Number(params[key] ?? 0) + amount);
}

export function computeLqr(): void {
  const state = useStore.getState();
  const graph = graphNow();
  const plant = graph.nodes.find((node) => node.blockType === 'pendulum');
  if (!plant) {
    state.setStatus(state.status, 'Add a double pendulum block to design a controller.');
    return;
  }
  try {
    const params = readPendulumParams(plant.parameters);
    const result = designPendulumLqr(params, state.design.Q, state.design.R);
    const gains = regulatorGains(result.K);
    let applied = 0;
    for (const [id, value] of Object.entries(gains)) {
      const node = graph.nodes.find((item) => item.id === id || item.role === id);
      if (!node || node.blockType !== 'gain') continue;
      useStore.getState().applyGain(node.id, value);
      applied++;
    }
    useStore.getState().setDesignView({
      summary: applied === 6 ? 'Gains written onto the six feedback blocks.' : `Updated ${applied} of 6 gain blocks.`,
      open: describePoles(result.polesOpen),
      closed: describePoles(result.polesClosed),
      gains: Object.entries(gains).map(([id, value]) => ({ id, value })),
    });
    const stable = result.polesClosed.every((pole) => pole.real < 0);
    const status = useStore.getState().status;
    const next = status === 'running' || status === 'paused' ? status : 'idle';
    useStore.getState().setStatus(next, stable ? 'LQR gains applied' : 'Closed loop is not stable', []);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'LQR failed';
    useStore.getState().setDesignView(null);
    useStore.getState().setStatus(useStore.getState().status, message);
  }
}
