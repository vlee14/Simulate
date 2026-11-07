import { applyMonteCarlo, countUncertainParams, drawNumeric } from './montecarlo';
import { GraphEdge, GraphNode, Param, ParamUncertainty, SimConfig } from './types';
import { runExperiment, ExperimentKind } from './experiments';

export interface UncertainParamRef {
  nodeId: string;
  key: string;
  nominal: number;
  uncertainty: ParamUncertainty;
  label: string;
}

export interface TornadoBar {
  id: string;
  label: string;
  low: number;
  high: number;
  /** |high-low| effect size on the chosen metric. */
  effect: number;
}

export interface Sweep1DResult {
  param: UncertainParamRef;
  values: number[];
  metrics: number[];
}

export interface SensitivityReport {
  params: UncertainParamRef[];
  tornado: TornadoBar[];
  sweep: Sweep1DResult | null;
  sobolFirst: { id: string; label: string; S: number }[];
  summary: string[];
}

export function listUncertainParams(nodes: GraphNode[]): UncertainParamRef[] {
  const out: UncertainParamRef[] = [];
  for (const node of nodes) {
    if (!node.uncertainty) continue;
    for (const [key, unc] of Object.entries(node.uncertainty)) {
      if (!unc || unc.kind === 'none') continue;
      const raw = node.parameters[key];
      if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
      out.push({
        nodeId: node.id,
        key,
        nominal: raw,
        uncertainty: unc,
        label: `${node.id}.${key}`,
      });
    }
  }
  return out;
}

function setParam(nodes: GraphNode[], nodeId: string, key: string, value: number): GraphNode[] {
  return nodes.map((node) => {
    if (node.id !== nodeId) return node;
    return { ...node, parameters: { ...node.parameters, [key]: value } as Record<string, Param> };
  });
}

function metricOf(
  nodes: GraphNode[],
  edges: GraphEdge[],
  config: SimConfig,
  outputBlock: string,
  outputPort: string,
  inputBlock: string | undefined,
  kind: ExperimentKind,
  which: 'riseTime' | 'settlingTime' | 'overshoot' | 'peak'
): number {
  const result = runExperiment(nodes, edges, config, {
    kind,
    outputBlock,
    outputPort,
    inputBlock,
    stopTime: Math.min(config.stopTime || 8, 8),
    stepSize: Math.max(0.001, config.stepSize || 0.002),
    mcRuns: 0,
  });
  const v = result.nominal.metrics[which];
  return v == null || !Number.isFinite(v) ? 0 : v;
}

/** One-at-a-time tornado: ±1σ (or spread) about nominal for each uncertain parameter. */
export function tornadoAnalysis(
  nodes: GraphNode[],
  edges: GraphEdge[],
  config: SimConfig,
  opts: {
    outputBlock: string;
    outputPort: string;
    inputBlock?: string;
    kind?: ExperimentKind;
    metric?: 'riseTime' | 'settlingTime' | 'overshoot' | 'peak';
  }
): TornadoBar[] {
  const params = listUncertainParams(nodes);
  const kind = opts.kind ?? 'step';
  const metric = opts.metric ?? 'settlingTime';
  const bars: TornadoBar[] = [];
  for (const p of params) {
    const lowVal = drawNumeric(p.nominal, { ...p.uncertainty, kind: p.uncertainty.kind === 'uniform' ? 'uniform' : 'normal' }, 1);
    // Deterministic low/high via ±spread proxies
    const spread =
      p.uncertainty.kind === 'percent'
        ? Math.abs(p.nominal) * (p.uncertainty.spread / 100)
        : Math.abs(p.uncertainty.spread);
    const lo = p.nominal - spread;
    const hi = p.nominal + spread;
    void lowVal;
    const yLo = metricOf(setParam(nodes, p.nodeId, p.key, lo), edges, config, opts.outputBlock, opts.outputPort, opts.inputBlock, kind, metric);
    const yHi = metricOf(setParam(nodes, p.nodeId, p.key, hi), edges, config, opts.outputBlock, opts.outputPort, opts.inputBlock, kind, metric);
    bars.push({
      id: `${p.nodeId}.${p.key}`,
      label: p.label,
      low: yLo,
      high: yHi,
      effect: Math.abs(yHi - yLo),
    });
  }
  return bars.sort((a, b) => b.effect - a.effect);
}

/** 1D sweep of one parameter across linspace. */
export function sweep1D(
  nodes: GraphNode[],
  edges: GraphEdge[],
  config: SimConfig,
  param: UncertainParamRef,
  opts: {
    outputBlock: string;
    outputPort: string;
    inputBlock?: string;
    kind?: ExperimentKind;
    metric?: 'riseTime' | 'settlingTime' | 'overshoot' | 'peak';
    samples?: number;
  }
): Sweep1DResult {
  const n = Math.max(5, Math.min(41, opts.samples ?? 11));
  const spread =
    param.uncertainty.kind === 'percent'
      ? Math.abs(param.nominal) * (param.uncertainty.spread / 100)
      : Math.abs(param.uncertainty.spread);
  const lo = param.nominal - 2 * spread;
  const hi = param.nominal + 2 * spread;
  const values: number[] = [];
  const metrics: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = lo + ((hi - lo) * i) / Math.max(1, n - 1);
    values.push(v);
    metrics.push(
      metricOf(
        setParam(nodes, param.nodeId, param.key, v),
        edges,
        config,
        opts.outputBlock,
        opts.outputPort,
        opts.inputBlock,
        opts.kind ?? 'step',
        opts.metric ?? 'settlingTime'
      )
    );
  }
  return { param, values, metrics };
}

/**
 * Cheap first-order sensitivity proxy: variance of metric when only that param is drawn
 * (others fixed at nominal), normalized to sum to ~1.
 */
export function sobolFirstProxy(
  nodes: GraphNode[],
  edges: GraphEdge[],
  config: SimConfig,
  opts: {
    outputBlock: string;
    outputPort: string;
    inputBlock?: string;
    kind?: ExperimentKind;
    metric?: 'riseTime' | 'settlingTime' | 'overshoot' | 'peak';
    samples?: number;
  }
): { id: string; label: string; S: number }[] {
  const params = listUncertainParams(nodes);
  const M = Math.max(16, Math.min(64, opts.samples ?? 24));
  const kind = opts.kind ?? 'step';
  const metric = opts.metric ?? 'settlingTime';
  const vars: { id: string; label: string; v: number }[] = [];
  for (const p of params) {
    const samples: number[] = [];
    for (let run = 1; run <= M; run++) {
      const drawn = drawNumeric(p.nominal, p.uncertainty, run);
      samples.push(
        metricOf(setParam(nodes, p.nodeId, p.key, drawn), edges, config, opts.outputBlock, opts.outputPort, opts.inputBlock, kind, metric)
      );
    }
    const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
    const v = samples.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, samples.length - 1);
    vars.push({ id: `${p.nodeId}.${p.key}`, label: p.label, v });
  }
  const total = vars.reduce((s, x) => s + x.v, 0) || 1;
  return vars
    .map((x) => ({ id: x.id, label: x.label, S: x.v / total }))
    .sort((a, b) => b.S - a.S);
}

export function runSensitivity(
  nodes: GraphNode[],
  edges: GraphEdge[],
  config: SimConfig,
  opts: {
    outputBlock: string;
    outputPort: string;
    inputBlock?: string;
    kind?: ExperimentKind;
    metric?: 'riseTime' | 'settlingTime' | 'overshoot' | 'peak';
    sweepParamId?: string;
  }
): SensitivityReport {
  const params = listUncertainParams(nodes);
  if (!params.length) {
    return {
      params: [],
      tornado: [],
      sweep: null,
      sobolFirst: [],
      summary: ['No distributed parameters — enable MC distributions first.'],
    };
  }
  const tornado = tornadoAnalysis(nodes, edges, config, opts);
  const sobolFirst = sobolFirstProxy(nodes, edges, config, opts);
  const sweepTarget =
    params.find((p) => `${p.nodeId}.${p.key}` === opts.sweepParamId) ?? params[0];
  const sweep = sweep1D(nodes, edges, config, sweepTarget, opts);
  const top = sobolFirst[0];
  return {
    params,
    tornado,
    sweep,
    sobolFirst,
    summary: [
      `${params.length} uncertain param${params.length === 1 ? '' : 's'} (of ${countUncertainParams(nodes)} distributed).`,
      top ? `Largest first-order effect: ${top.label} (S≈${top.S.toFixed(2)})` : '',
      tornado[0] ? `Tornado leader: ${tornado[0].label} (Δ=${tornado[0].effect.toFixed(3)})` : '',
    ].filter(Boolean),
  };
}
