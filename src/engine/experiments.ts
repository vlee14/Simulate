import { applyMonteCarlo } from './montecarlo';
import { StepMetrics, stepResponseMetrics } from './metrics';
import { SimulationEngine } from './runtime';
import { RingBuffer } from './telemetry';
import { GraphEdge, GraphNode, SimConfig } from './types';

export type ExperimentKind = 'step' | 'impulse' | 'free';

export interface ExperimentSpec {
  kind: ExperimentKind;
  outputBlock: string;
  outputPort: string;
  /** Optional input source block (step/pulse/constant/manual) to drive. */
  inputBlock?: string;
  stopTime: number;
  stepSize: number;
  /** Monte Carlo runs 1…N (0 = nominal only). Cap 500 for interactivity. */
  mcRuns: number;
  settleBand?: number;
}

export interface TraceSeries {
  t: number[];
  y: number[];
}

export interface ExperimentRunResult {
  run: number;
  metrics: StepMetrics;
  trace: TraceSeries;
}

export interface ExperimentEnvelope {
  t: number[];
  p05: number[];
  p50: number[];
  p95: number[];
}

export interface ExperimentResult {
  nominal: ExperimentRunResult;
  ensemble: ExperimentRunResult[];
  envelope: ExperimentEnvelope | null;
  summary: string[];
}

function metricsFromTrace(trace: TraceSeries, settleBand: number): StepMetrics {
  const ring = new RingBuffer(Math.max(8, trace.t.length));
  for (let i = 0; i < trace.t.length; i++) ring.push(trace.t[i], trace.y[i]);
  return stepResponseMetrics(ring, settleBand);
}

function prepareNodes(nodes: GraphNode[], kind: ExperimentKind, inputBlock?: string): GraphNode[] {
  if (!inputBlock) return nodes;
  return nodes.map((node) => {
    if (node.id !== inputBlock) return node;
    const parameters = { ...node.parameters };
    if (kind === 'step') {
      if (node.blockType === 'step') {
        parameters.stepTime = Number(parameters.stepTime) || 0.1;
        parameters.initialValue = 0;
        if (!(Number(parameters.finalValue) > 0)) parameters.finalValue = 1;
      } else if (node.blockType === 'constant' || node.blockType === 'manual') {
        parameters.value = 1;
      }
    } else if (kind === 'impulse') {
      if (node.blockType === 'pulse') {
        parameters.delay = 0.05;
        parameters.width = Math.max(0.02, Number(parameters.width) || 0.05);
        if (!(Number(parameters.amplitude) > 0)) parameters.amplitude = 1;
      } else if (node.blockType === 'step') {
        parameters.stepTime = 0.05;
        parameters.initialValue = 0;
        parameters.finalValue = 1;
      }
    } else if (kind === 'free') {
      if (node.blockType === 'constant' || node.blockType === 'manual') parameters.value = 0;
      if (node.blockType === 'step') {
        parameters.initialValue = 0;
        parameters.finalValue = 0;
      }
    }
    return { ...node, parameters };
  });
}

function readOutput(engine: SimulationEngine, blockId: string, port: string): number {
  const block = engine.compiled?.byId.get(blockId);
  if (!block) return NaN;
  if (port in block.outputs) return block.outputs[port] ?? NaN;
  if (port in block.inputs) return block.inputs[port] ?? NaN;
  const firstOut = block.outputPorts[0];
  return firstOut ? block.outputs[firstOut] ?? NaN : NaN;
}

function simulateOnce(
  nodes: GraphNode[],
  edges: GraphEdge[],
  config: SimConfig,
  spec: ExperimentSpec,
  run: number
): ExperimentRunResult {
  const prepared = prepareNodes(nodes, spec.kind, spec.inputBlock);
  const engine = new SimulationEngine(prepared, edges, {
    ...config,
    stopTime: spec.stopTime,
    stepSize: spec.stepSize,
    startTime: 0,
    speed: 1,
  });
  engine.compile();
  engine.reset();
  const dt = Math.max(1e-5, spec.stepSize);
  const t: number[] = [];
  const y: number[] = [];
  const push = () => {
    t.push(engine.time);
    y.push(readOutput(engine, spec.outputBlock, spec.outputPort));
  };
  push();
  let guard = 0;
  const stride = Math.max(1, Math.floor(0.002 / dt)); // ~2 ms samples
  let tick = 0;
  while (engine.time < spec.stopTime - 1e-12 && guard < 2_000_000) {
    engine.step(Math.min(dt, spec.stopTime - engine.time));
    guard++;
    tick++;
    if (tick % stride === 0 || engine.time >= spec.stopTime - 1e-12) push();
  }
  const trace = { t, y };
  return { run, metrics: metricsFromTrace(trace, spec.settleBand ?? 0.02), trace };
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const u = Math.min(1, Math.max(0, p)) * (sorted.length - 1);
  const i = Math.floor(u);
  const f = u - i;
  return sorted[i] + (sorted[Math.min(sorted.length - 1, i + 1)] - sorted[i]) * f;
}

function buildEnvelope(runs: ExperimentRunResult[]): ExperimentEnvelope | null {
  if (runs.length < 2) return null;
  const n = Math.min(...runs.map((r) => r.trace.t.length));
  if (n < 2) return null;
  const t = runs[0].trace.t.slice(0, n);
  const p05: number[] = [];
  const p50: number[] = [];
  const p95: number[] = [];
  for (let i = 0; i < n; i++) {
    const col = runs
      .map((r) => r.trace.y[Math.min(i, r.trace.y.length - 1)])
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    p05.push(percentile(col, 0.05));
    p50.push(percentile(col, 0.5));
    p95.push(percentile(col, 0.95));
  }
  return { t, p05, p50, p95 };
}

/** Offline time-domain experiment: nominal + optional MC ensemble with percentile envelopes. */
export function runExperiment(
  nodes: GraphNode[],
  edges: GraphEdge[],
  config: SimConfig,
  spec: ExperimentSpec
): ExperimentResult {
  const nominal = simulateOnce(applyMonteCarlo(nodes, 0), edges, config, spec, 0);
  const ensemble: ExperimentRunResult[] = [];
  const nMc = Math.max(0, Math.min(500, Math.round(spec.mcRuns)));
  for (let run = 1; run <= nMc; run++) {
    try {
      ensemble.push(simulateOnce(applyMonteCarlo(nodes, run), edges, config, spec, run));
    } catch {
      /* skip failed draws */
    }
  }
  const envelope = buildEnvelope(ensemble.length ? [nominal, ...ensemble] : []);
  const m = nominal.metrics;
  const summary = [
    `Nominal: tr=${m.riseTime == null ? '—' : `${m.riseTime.toFixed(3)}s`}, ` +
      `ts=${m.settlingTime == null ? '—' : `${m.settlingTime.toFixed(3)}s`}, ` +
      `Mp=${m.overshoot == null ? '—' : `${m.overshoot.toFixed(1)}%`}`,
  ];
  if (ensemble.length) {
    const rises = ensemble.map((e) => e.metrics.riseTime).filter((v): v is number => v != null).sort((a, b) => a - b);
    const overs = ensemble.map((e) => e.metrics.overshoot).filter((v): v is number => v != null).sort((a, b) => a - b);
    summary.push(
      `MC ${ensemble.length}: tr p50=${rises.length ? `${percentile(rises, 0.5).toFixed(3)}s` : '—'}, ` +
        `Mp p95=${overs.length ? `${percentile(overs, 0.95).toFixed(1)}%` : '—'}`
    );
  }
  return { nominal, ensemble, envelope, summary };
}
