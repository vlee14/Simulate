import { getBlock } from '../engine/blocks';
import { structureSignature, SimCompileError } from '../engine/compile';
import { designDynamicsLqr } from '../engine/lqr';
import { linearizeBlock } from '../engine/linearize';
import { SimulationEngine } from '../engine/runtime';
import { analyzeStability, formatVector, parseVector } from '../engine/stability';
import { telemetry } from '../engine/telemetry';
import { DesignConfig, GraphNode } from '../engine/types';
import { toGraph } from '../model/elements';
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

const DESIGNABLE = new Set(['ode', 'statespace', 'secondorder', 'mass', 'inertia', 'dcmotor', 'rlc']);

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

function findDynamicsPlant(preferred?: string) {
  const { elements } = useStore.getState();
  const nodes = elements.filter((element) => !('source' in element));
  if (preferred) {
    const hit = nodes.find((element) => {
      const data = element.data as { blockType?: string; role?: string };
      return element.id === preferred || data.role === preferred;
    });
    if (hit) return hit;
  }
  return nodes.find((element) => {
    const type = (element.data as { blockType?: string })?.blockType;
    return !!type && DESIGNABLE.has(type);
  });
}

/** Nudge continuous state index on a Dynamics plant (or its x0 when idle). */
export function nudgeState(index: number, amount: number, plantRef?: string): void {
  const { status, updateParam } = useStore.getState();
  const plant = findDynamicsPlant(plantRef);
  if (!plant) return;
  const data = plant.data as { blockType?: string; parameters: Record<string, string | number> };
  if (engine && (status === 'running' || status === 'paused')) {
    engine.nudge(plant.id, index, amount);
    telemetry.publish();
    return;
  }
  const key = data.blockType === 'ode' || data.blockType === 'statespace' ? 'x0' : null;
  if (!key) {
    updateParam(plant.id, 'x0', amount);
    return;
  }
  const parts = String(data.parameters.x0 ?? '0')
    .trim()
    .split(/[\s,;]+/)
    .map(Number);
  while (parts.length <= index) parts.push(0);
  parts[index] = (Number.isFinite(parts[index]) ? parts[index] : 0) + amount;
  updateParam(plant.id, 'x0', parts.join(' '));
}

function findNode(ref: string) {
  const { elements } = useStore.getState();
  return elements.find((element) => {
    if ('source' in element) return false;
    const data = element.data as { role?: string };
    return element.id === ref || data.role === ref;
  });
}

export function simTime(): number {
  return engine?.time ?? useStore.getState().time;
}

/** Write a live value onto a Manual (or any `value` parameter) source. */
export function setControlValue(blockRef: string, value: number): void {
  const node = findNode(blockRef);
  if (!node) return;
  const data = node.data as { parameters?: Record<string, string | number | boolean> };
  const min = Number(data.parameters?.min);
  const max = Number(data.parameters?.max);
  let next = value;
  if (Number.isFinite(min) && Number.isFinite(max)) {
    next = Math.max(Math.min(min, max), Math.min(Math.max(min, max), value));
  }
  useStore.getState().updateParam(node.id, 'value', next);
}

/**
 * Fire a Stage disturbance: retrigger a Pulse at the current sim time, or nudge plant state.
 */
export function fireDisturbance(
  item: { kind: 'pulse' | 'nudge'; block: string; amount: number; index: number },
  plantRef?: string
): void {
  if (item.kind === 'nudge') {
    nudgeState(item.index, item.amount, plantRef);
    return;
  }
  const node = findNode(item.block || 'pulse');
  if (!node) return;
  const t = simTime();
  const { updateParam } = useStore.getState();
  updateParam(node.id, 'amplitude', item.amount);
  updateParam(node.id, 'delay', t);
  // Ensure a one-shot pulse width if the block was already spent.
  const data = node.data as { parameters?: Record<string, string | number | boolean> };
  const width = Number(data.parameters?.width);
  if (!Number.isFinite(width) || width <= 0) updateParam(node.id, 'width', 0.18);
  if (engine) engine.rebuildParams(graphNow().nodes);
}

function findDesignPlant(): GraphNode | null {
  const state = useStore.getState();
  const graph = graphNow();
  const selected = state.selectedIds[0];
  return (
    graph.nodes.find((node) => node.id === selected && DESIGNABLE.has(node.blockType)) ??
    graph.nodes.find((node) => DESIGNABLE.has(node.blockType)) ??
    null
  );
}

function plantStateDim(plant: GraphNode): number {
  const def = getBlock(plant.blockType);
  return def?.continuousStates(plant.parameters) ?? 0;
}

function plantInputDim(plant: GraphNode): number {
  const def = getBlock(plant.blockType);
  return Math.max(1, def?.ports(plant.parameters).inputs.length ?? 1);
}

function defaultPlantX0(plant: GraphNode, n: number): number[] {
  const p = plant.parameters;
  if (plant.blockType === 'ode' || plant.blockType === 'statespace') {
    return parseVector(String(p.x0 ?? ''), n, 0);
  }
  if (plant.blockType === 'secondorder') return [Number(p.y0) || 0, Number(p.dy0) || 0].slice(0, n);
  if (plant.blockType === 'mass') return [Number(p.x0) || 0, Number(p.v0) || 0].slice(0, n);
  if (plant.blockType === 'inertia') return [Number(p.theta0) || 0, Number(p.w0) || 0].slice(0, n);
  if (plant.blockType === 'dcmotor') return [Number(p.i0) || 0, Number(p.w0) || 0].slice(0, n);
  if (plant.blockType === 'rlc') return parseVector(String(p.x0 ?? ''), n, 0);
  return new Array(n).fill(0);
}

function resolveOperatingPoint(plant: GraphNode, design: DesignConfig): { x: number[]; u: number[]; label: string } {
  const n = plantStateDim(plant);
  const m = plantInputDim(plant);
  const mode = design.opMode ?? 'equilibrium';
  if (mode === 'equilibrium') {
    return { x: new Array(n).fill(0), u: new Array(m).fill(0), label: 'equilibrium (0)' };
  }
  if (mode === 'x0') {
    return { x: defaultPlantX0(plant, n), u: parseVector(design.uOp || '0', m, 0), label: 'plant x₀' };
  }
  if (mode === 'live') {
    const live = engine?.readState(plant.id) ?? [];
    if (live.length === n) {
      return { x: live, u: parseVector(design.uOp || '0', m, 0), label: `live @ t=${(engine?.time ?? 0).toFixed(3)} s` };
    }
    return { x: defaultPlantX0(plant, n), u: parseVector(design.uOp || '0', m, 0), label: 'live unavailable — used x₀' };
  }
  return {
    x: parseVector(design.xOp || '', n, 0),
    u: parseVector(design.uOp || '0', m, 0),
    label: 'custom breakpoint',
  };
}

function readControllerGains(n: number): number[] {
  const graph = graphNow();
  const K = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const role = `k${i}`;
    const node = graph.nodes.find((item) => item.id === role || item.role === role);
    if (!node || node.blockType !== 'gain') continue;
    // Stored gain is −Kᵢ for u = Σ ki zi
    K[i] = -Number(node.parameters.k ?? 0);
  }
  return K;
}

function publishDesignView(args: {
  summary: string;
  plant: GraphNode;
  K: number[];
  appliedGains: { id: string; value: number }[];
  opLabel: string;
  A: number[][];
  B: number[][];
}): void {
  const design = useStore.getState().design;
  const report = analyzeStability(args.A, args.B, args.K, design.analysis?.length ? design.analysis : undefined);
  useStore.getState().setDesignView({
    summary: args.summary,
    open: describePoles(report.polesOpen),
    closed: describePoles(report.polesClosed),
    gains: args.appliedGains.length
      ? args.appliedGains
      : args.K.map((value, index) => ({ id: `k${index}`, value: -value })),
    opLabel: args.opLabel,
    report,
  });
}

/** Capture plant x₀ or live state into the custom linearization breakpoint fields. */
export function captureLinearizationPoint(source: 'x0' | 'live' = 'x0'): void {
  const plant = findDesignPlant();
  if (!plant) {
    useStore.getState().setStatus(useStore.getState().status, 'Select a Dynamics plant to capture an operating point.');
    return;
  }
  const n = plantStateDim(plant);
  const m = plantInputDim(plant);
  const design = useStore.getState().design;
  if (source === 'live') {
    const live = engine?.readState(plant.id) ?? [];
    if (live.length !== n) {
      useStore.getState().setStatus(useStore.getState().status, 'Run the model to capture a live linearization point.');
      return;
    }
    useStore.getState().setDesignOp({ xOp: formatVector(live), uOp: design.uOp || formatVector(new Array(m).fill(0)) });
    useStore.getState().setDesignOpMode('custom');
    useStore.getState().setStatus(useStore.getState().status, `Captured live state at t=${(engine?.time ?? 0).toFixed(3)} s`);
    return;
  }
  useStore.getState().setDesignOp({ xOp: formatVector(defaultPlantX0(plant, n)), uOp: design.uOp || '0' });
  useStore.getState().setDesignOpMode('custom');
  useStore.getState().setStatus(useStore.getState().status, 'Captured plant x₀ into the custom breakpoint.');
}

/** Analyze open/closed-loop stability about the selected linearization point (uses current k0… gains). */
export function analyzeController(): void {
  const state = useStore.getState();
  const plant = findDesignPlant();
  if (!plant) {
    state.setStatus(state.status, 'Select a Dynamics plant (ODE, State-Space, …) to analyze.');
    return;
  }
  try {
    const op = resolveOperatingPoint(plant, state.design);
    const { A, B } = linearizeBlock(plant.blockType, plant.parameters, op.x, op.u);
    const B1 = B.map((row) => [row[0] ?? 0]);
    const K = readControllerGains(A.length);
    publishDesignView({
      summary: `Stability about ${op.label} on “${plant.blockType}” (current controller gains).`,
      plant,
      K,
      appliedGains: K.map((value, index) => ({ id: `k${index}`, value: -value })),
      opLabel: op.label,
      A,
      B: B1,
    });
    const report = useStore.getState().designView?.report;
    const status = useStore.getState().status;
    const next = status === 'running' || status === 'paused' ? status : 'idle';
    useStore.getState().setStatus(next, report?.closedStable ? 'Closed loop looks stable' : 'Closed loop is not Hurwitz', []);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Stability analysis failed';
    useStore.getState().setDesignView(null);
    useStore.getState().setStatus(useStore.getState().status, message);
  }
}

/**
 * LQR writes −Kᵢ onto gain blocks with role/id `k0`…`k{n-1}`.
 * Optional role `kref` receives +K₀ for reference feedforward on the first state.
 * Linearizes about the Design-pane operating point.
 */
export function computeLqr(): void {
  const state = useStore.getState();
  const graph = graphNow();
  const plant = findDesignPlant();
  if (!plant) {
    state.setStatus(state.status, 'Select a Dynamics plant (ODE, State-Space, …) to design a controller.');
    return;
  }
  try {
    const op = resolveOperatingPoint(plant, state.design);
    const result = designDynamicsLqr(plant.blockType, plant.parameters, state.design.Q, state.design.R, op.x, op.u);
    const appliedGains: { id: string; value: number }[] = [];
    let applied = 0;
    result.K.forEach((value, index) => {
      const role = `k${index}`;
      const node = graph.nodes.find((item) => item.id === role || item.role === role);
      if (!node || node.blockType !== 'gain') return;
      const next = -value;
      useStore.getState().applyGain(node.id, next);
      appliedGains.push({ id: role, value: next });
      applied++;
    });
    const refNode = graph.nodes.find((item) => item.id === 'kref' || item.role === 'kref');
    if (refNode && refNode.blockType === 'gain' && result.K.length) {
      useStore.getState().applyGain(refNode.id, result.K[0]);
      appliedGains.push({ id: 'kref', value: result.K[0] });
      applied++;
    }
    const { A, B } = linearizeBlock(plant.blockType, plant.parameters, op.x, op.u);
    const B1 = B.map((row) => [row[0] ?? 0]);
    publishDesignView({
      summary:
        applied > 0
          ? `LQR about ${op.label} on “${plant.blockType}” — wrote ${applied} gain${applied === 1 ? '' : 's'} (k0… / kref).`
          : `LQR about ${op.label} on “${plant.blockType}”. Add gain blocks with roles k0, k1, … (and optional kref).`,
      plant,
      K: result.K,
      appliedGains,
      opLabel: op.label,
      A,
      B: B1,
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
