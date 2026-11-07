import { getBlock } from '../engine/blocks';
import { structureSignature, SimCompileError } from '../engine/compile';
import { designDynamicsLqr } from '../engine/lqr';
import { linearizeBlock } from '../engine/linearize';
import { runMcCampaign, sampleToFreqPoints } from '../engine/mcCampaignRunner';
import { applyMonteCarlo, countUncertainParams, recommendMcRuns } from '../engine/montecarlo';
import {
  clampCampaignSize,
  freqFlatToPoints,
  MC_CAMPAIGN_MAX,
  MC_OVERLAY_DEFAULT,
  MC_OVERLAY_MAX,
  McRunSample,
} from '../engine/mcStats';
import { SimulationEngine } from '../engine/runtime';
import { analyzeStability, formatVector, parseVector, StabilityReport } from '../engine/stability';
import { telemetry } from '../engine/telemetry';
import { DesignConfig, GraphNode } from '../engine/types';
import { toGraph } from '../model/elements';
import { describePoles, useStore } from '../store';

let campaignAbort: AbortController | null = null;
let campaignToken = 0;

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

/** Graph with Monte Carlo draws applied for the current `config.mcRun` (0 = nominal). */
function graphForSim() {
  const graph = graphNow();
  const run = useStore.getState().config.mcRun ?? 0;
  return { nodes: applyMonteCarlo(graph.nodes, run), edges: graph.edges };
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
  engine.rebuildParams(graphForSim().nodes);
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
      engine.rebuildParams(graphForSim().nodes);
    }
  });
}

export function play(): void {
  const state = useStore.getState();
  if (state.status === 'running') return;
  if (!engine || state.status === 'idle' || state.status === 'done' || state.status === 'error') {
    const structural = graphNow();
    const graph = graphForSim();
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
      signature = structureSignature(structural.nodes, structural.edges);
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
  const run = useStore.getState().config.mcRun ?? 0;
  useStore.getState().setStatus('running', run > 0 ? `Running · MC run ${run}` : 'Running');
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

function plantNodeForRun(plantId: string, run: number): GraphNode | null {
  const nodes = applyMonteCarlo(graphNow().nodes, run);
  return nodes.find((node) => node.id === plantId) ?? null;
}

function linearizePlantRun(
  plant: GraphNode,
  run: number,
  design: DesignConfig
): { A: number[][]; B: number[][]; opLabel: string } {
  const drawn = plantNodeForRun(plant.id, run) ?? plant;
  const op = resolveOperatingPoint(drawn, design);
  const { A, B } = linearizeBlock(drawn.blockType, drawn.parameters, op.x, op.u);
  const B1 = B.map((row) => [row[0] ?? 0]);
  return { A, B: B1, opLabel: op.label };
}

function sampleToOverlayReport(sample: McRunSample, ws: number[], nominal: StabilityReport): StabilityReport {
  return {
    ...nominal,
    polesClosed: sample.polesClosed,
    closedStable: sample.closedStable,
    spectralAbscissaClosed: sample.spectralAbscissa,
    freq: sample.freqFlat && (sample.freqFlat as ArrayLike<number>).length ? freqFlatToPoints(sample.freqFlat, ws) : sampleToFreqPoints(sample, ws),
    margins: sample.gainMarginDb != null || sample.phaseMarginDeg != null
      ? {
          gainMarginDb: sample.gainMarginDb,
          phaseMarginDeg: sample.phaseMarginDeg,
          gainCrossoverRad: null,
          phaseCrossoverRad: null,
          note: 'From MC campaign frequency response',
        }
      : nominal.margins,
    rootLocus: [],
    summary: [
      sample.closedStable ? 'Closed loop: asymptotically stable' : 'Closed loop: unstable (or marginally stable)',
      `MC run ${sample.run}`,
    ],
  };
}

function analyzeSelectedPlant(
  plant: GraphNode,
  K: number[],
  design: DesignConfig,
  selectedRun: number,
  opts: Parameters<typeof analyzeStability>[3]
): StabilityReport | null {
  try {
    const { A, B } = linearizePlantRun(plant, selectedRun, design);
    return analyzeStability(A, B, K, opts);
  } catch {
    return null;
  }
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
  const state = useStore.getState();
  const design = state.design;
  const config = state.config;
  const opts = design.analysis?.length ? design.analysis : undefined;
  const nominalReport = analyzeStability(args.A, args.B, args.K, opts);
  const selectedRun = Math.max(0, Math.round(config.mcRun ?? 0));
  const uncertain = countUncertainParams(graphNow().nodes);

  let report = nominalReport;
  if (selectedRun > 0) {
    report = analyzeSelectedPlant(args.plant, args.K, design, selectedRun, opts) ?? nominalReport;
  }

  const overlayN = Math.min(MC_OVERLAY_MAX, Math.max(0, Math.round(config.mcOverlayCount ?? MC_OVERLAY_DEFAULT)));
  const advice = recommendMcRuns(graphNow().nodes, {
    confidence: config.mcConfidence ?? 0.95,
    relError: config.mcRelError ?? 0.05,
    tailQuantile: config.mcTailQuantile ?? 0.95,
  });
  const campaignN = clampCampaignSize(
    config.mcCampaignSize ?? Math.min(MC_CAMPAIGN_MAX, Math.max(advice.mean || 0, advice.explore || 0, overlayN))
  );

  const runNote =
    selectedRun > 0
      ? ` Selected MC run ${selectedRun}.`
      : uncertain > 0
        ? ` Monte Carlo campaign ${campaignN} runs (bands + ${overlayN} overlay lines).`
        : '';

  useStore.getState().setDesignView({
    summary: args.summary + runNote,
    open: describePoles(report.polesOpen),
    closed: describePoles(report.polesClosed),
    gains: args.appliedGains.length
      ? args.appliedGains
      : args.K.map((value, index) => ({ id: `k${index}`, value: -value })),
    opLabel: args.opLabel,
    report,
    nominalReport,
    mcEnsemble: [],
    selectedRun,
    mcCampaign: null,
    mcSamples: null,
    mcCampaignWs: null,
    mcCampaignProgress:
      uncertain > 0 && campaignN > 0
        ? {
            done: 0,
            total: campaignN,
            phase: 'sample',
            startedAt: performance.now(),
            etaMs: null,
            rate: null,
            label: 'Starting workers…',
          }
        : null,
  });

  if (uncertain <= 0 || campaignN <= 0) return;

  campaignAbort?.abort();
  campaignAbort = new AbortController();
  const token = ++campaignToken;
  const op = resolveOperatingPoint(args.plant, design);
  const includeAllLines = !!config.mcShowAllLines;

  void runMcCampaign({
    plantId: args.plant.id,
    blockType: args.plant.blockType,
    nodes: graphNow().nodes,
    xOp: op.x,
    uOp: op.u,
    K: args.K,
    nRuns: campaignN,
    overlayCount: overlayN,
    selectedRun,
    includeAllLines,
    signal: campaignAbort.signal,
    onProgress: (() => {
      let lastUi = 0;
      return (progress) => {
        if (token !== campaignToken) return;
        const now = performance.now();
        const terminal = progress.done >= progress.total || progress.phase !== 'sample';
        if (!terminal && now - lastUi < 100) return;
        lastUi = now;
        const view = useStore.getState().designView;
        if (!view) return;
        useStore.getState().setDesignView({ ...view, mcCampaignProgress: progress });
      };
    })(),
  })
    .then((result) => {
      if (token !== campaignToken) return;
      const view = useStore.getState().designView;
      if (!view?.nominalReport) return;
      const overlay = result.stats.overlayRuns
        .map((run) => {
          const sample = result.samples.find((s) => s.run === run);
          if (!sample) return null;
          return { run, report: sampleToOverlayReport(sample, result.ws, view.nominalReport!) };
        })
        .filter((t): t is { run: number; report: StabilityReport } => !!t);

      if (selectedRun > 0 && !overlay.some((t) => t.run === selectedRun)) {
        const sample = result.samples.find((s) => s.run === selectedRun);
        if (sample) overlay.push({ run: selectedRun, report: sampleToOverlayReport(sample, result.ws, view.nominalReport) });
      }

      let nextReport = view.report ?? view.nominalReport;
      let open = view.open;
      let closed = view.closed;
      if (selectedRun > 0) {
        const hit = overlay.find((t) => t.run === selectedRun);
        if (hit) {
          nextReport = hit.report;
          open = describePoles(hit.report.polesOpen);
          closed = describePoles(hit.report.polesClosed);
        }
      }

      const stablePct = (100 * result.stats.stableFraction).toFixed(1);
      useStore.getState().setDesignView({
        ...view,
        report: nextReport,
        open,
        closed,
        mcEnsemble: overlay,
        mcCampaign: result.stats,
        mcSamples: result.samples,
        mcCampaignWs: result.ws,
        mcCampaignProgress: null,
        summary:
          view.summary.replace(/ Monte Carlo campaign .*/, '').replace(/ Selected MC run \d+\.?/, '').trim() +
          ` Campaign ${result.stats.ok}/${result.stats.total} ok · ${stablePct}% Hurwitz · ${result.stats.backend} · ${result.stats.elapsedMs.toFixed(0)} ms.` +
          (selectedRun > 0 ? ` Selected MC run ${selectedRun}.` : ''),
      });
      const status = useStore.getState().status;
      const next = status === 'running' || status === 'paused' ? status : 'idle';
      useStore.getState().setStatus(next, `MC campaign done · ${stablePct}% closed-loop stable`, []);
    })
    .catch((error) => {
      if (token !== campaignToken) return;
      if (error instanceof Error && error.message === 'aborted') return;
      const view = useStore.getState().designView;
      if (!view) return;
      useStore.getState().setDesignView({ ...view, mcCampaignProgress: null });
      useStore.getState().setStatus(useStore.getState().status, error instanceof Error ? error.message : 'MC campaign failed');
    });
}

/** Set the Monte Carlo run used for analysis detail / simulation, then refresh stability if plots exist. */
export function selectMcRun(run: number): void {
  const next = Math.max(0, Math.round(run));
  useStore.getState().setConfig({ mcRun: next });
  const view = useStore.getState().designView;
  if (!view?.nominalReport) return;

  if (next === 0) {
    const hit = view.nominalReport;
    useStore.getState().setDesignView({
      ...view,
      selectedRun: 0,
      report: hit,
      open: describePoles(hit.polesOpen),
      closed: describePoles(hit.polesClosed),
      summary: view.summary.replace(/ Selected MC run \d+\.?/, '').trim(),
    });
    return;
  }

  const fromOverlay = view.mcEnsemble?.find((t) => t.run === next)?.report;
  if (fromOverlay) {
    useStore.getState().setDesignView({
      ...view,
      selectedRun: next,
      report: fromOverlay,
      open: describePoles(fromOverlay.polesOpen),
      closed: describePoles(fromOverlay.polesClosed),
      summary: view.summary.replace(/ Selected MC run \d+\.?/, '').replace(/\s*$/, '') + ` Selected MC run ${next}.`,
    });
    return;
  }

  const sample = view.mcSamples?.find((s) => s.run === next);
  if (sample && view.mcCampaignWs && view.nominalReport) {
    const hit = sampleToOverlayReport(sample, view.mcCampaignWs, view.nominalReport);
    const ensemble = [...(view.mcEnsemble ?? [])];
    if (!ensemble.some((t) => t.run === next)) ensemble.push({ run: next, report: hit });
    useStore.getState().setDesignView({
      ...view,
      selectedRun: next,
      report: hit,
      mcEnsemble: ensemble,
      open: describePoles(hit.polesOpen),
      closed: describePoles(hit.polesClosed),
      summary: view.summary.replace(/ Selected MC run \d+\.?/, '').replace(/\s*$/, '') + ` Selected MC run ${next}.`,
    });
    return;
  }

  // No campaign yet / miss — re-analyze (kicks a new campaign with this selection).
  analyzeController();
}

/** Reset and simulate the currently selected Monte Carlo run. */
export function runSelectedMc(): void {
  resetSim();
  play();
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
