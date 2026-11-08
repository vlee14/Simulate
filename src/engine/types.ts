export type Param = number | string | boolean;

/** Monte Carlo distribution kind for a numeric parameter. */
export type DistKind = 'none' | 'normal' | 'uniform' | 'percent' | 'lognormal';

/**
 * Per-parameter uncertainty. `seed` is assigned once when a distribution is enabled
 * so adding/removing other parameters does not change this parameter’s draws.
 */
export interface ParamUncertainty {
  kind: DistKind;
  seed: number;
  /**
   * Scale for the draw:
   * - normal: σ (absolute)
   * - uniform: half-width around nominal
   * - percent: ±% of |nominal| used as Normal σ
   * - lognormal: σ of underlying Normal (median = nominal)
   */
  spread: number;
}

/** Physical / signal domain for port coloring and connection checks. */
export type PortDomain = 'signal' | 'mechanical' | 'electrical' | 'pneumatic' | 'hydraulic' | 'thermal';

export interface PortDef {
  id: string;
  name: string;
  domain?: PortDomain;
}

export interface ParamSpec {
  key: string;
  label: string;
  type: 'number' | 'string' | 'boolean' | 'select';
  group?: string;
  step?: number;
  min?: number;
  max?: number;
  options?: { value: string; label: string }[];
  help?: string;
  wide?: boolean;
}

export const DOMAIN_COLOR: Record<PortDomain, string> = {
  signal: '#8b97a8',
  mechanical: '#e7a23a',
  electrical: '#5ec8ff',
  pneumatic: '#7ddea0',
  hydraulic: '#d2a8ff',
  thermal: '#ff6b8a',
};

export interface BlockContext {
  id: string;
  t: number;
  dt: number;
  inputs: Record<string, number>;
  outputs: Record<string, number>;
  parameters: Record<string, Param>;
  state: Float64Array;
  discrete: Float64Array;
  deriv: Float64Array;
}

export interface BlockDefinition {
  type: string;
  category: string;
  name: string;
  description: string;
  renderer: 'sim' | 'scope' | 'xy' | 'note' | 'plant' | 'meter';
  defaultParameters: Record<string, Param>;
  parameters: ParamSpec[];
  hasDirectFeedthrough: (parameters: Record<string, Param>) => boolean;
  ports: (parameters: Record<string, Param>) => { inputs: PortDef[]; outputs: PortDef[] };
  continuousStates: (parameters: Record<string, Param>) => number;
  discreteStates: (parameters: Record<string, Param>) => number;
  init?: (ctx: BlockContext) => void;
  outputs: (ctx: BlockContext) => void;
  derivatives?: (ctx: BlockContext) => void;
  updateDiscrete?: (ctx: BlockContext) => void;
}

export interface GraphNode {
  id: string;
  blockType: string;
  parameters: Record<string, Param>;
  role?: string;
  /** Optional per-parameter Monte Carlo distributions (seeded). */
  uncertainty?: Record<string, ParamUncertainty>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
}

export interface SimConfig {
  solver: 'rk4' | 'euler';
  stepSize: number;
  stopTime: number;
  startTime: number;
  speed: number;
  /**
   * Monte Carlo simulation index.
   * 0 / omitted = always nominal parameter values.
   * n>0 = seeded draws from each parameter’s distribution (same seed ⇒ same draw).
   */
  mcRun?: number;
  /** Confidence level for MC sample-size formulas (default 0.95). */
  mcConfidence?: number;
  /** Target relative half-width ε for the mean CI (default 0.05). */
  mcRelError?: number;
  /** Tail quantile for percentile sample-size sizing (default 0.95). */
  mcTailQuantile?: number;
  /**
   * Monte Carlo stability campaign size (runs 1…N). Cap 10 000.
   * Analyze uses workers (+ WebGPU Bode when helpful); plots show bands + overlay subset.
   */
  mcCampaignSize?: number;
  /** How many grey overlay traces to draw from the campaign (default ~96). */
  mcOverlayCount?: number;
  /** When true, WebGL packs all campaign Bode magnitude lines (up to 10k). */
  mcShowAllLines?: boolean;
}

/** Where to linearize the plant for LQR / stability analysis. */
export type LinearizationPoint = 'equilibrium' | 'x0' | 'live' | 'custom';

export type AnalysisOption =
  | 'poles'
  | 'margins'
  | 'damping'
  | 'ctrb'
  | 'polemap'
  | 'bode'
  | 'nyquist'
  | 'nichols'
  | 'rlocus';

/** Controller synthesis method shown in Design → Controller. */
export type ControllerKind =
  | 'lqr'
  | 'lqi'
  | 'lqg'
  | 'poleplace'
  | 'pid-imc'
  | 'pid-zn'
  | 'pi-imc'
  | 'pd'
  | 'p'
  | 'lead'
  | 'lag'
  | 'leadlag'
  | 'observer-lqr'
  | 'hinf-loop'
  | 'deadbeat';

export interface DesignConfig {
  Q: number[];
  R: number;
  /** Operating / linearization point for A,B. */
  opMode: LinearizationPoint;
  /** Custom state vector when opMode is `custom` (space-separated). */
  xOp: string;
  /** Custom input vector when opMode is `custom` (space-separated). */
  uOp: string;
  /**
   * Analysis time t* (s). Freezes time-varying plant parameters and controller
   * gain schedules when linearizing — e.g. “is the loop stable at t = 10 s?”.
   * Ignored for `live` mode, which uses the simulator clock.
   */
  tOp: number;
  /**
   * Frozen measured schedule parameter s* for gain schedules that depend on `s`
   * (altitude, dynamic pressure, …). Simulation still reads the live `s` port.
   */
  sOp: number;
  /** Which stability reports to compute / show. */
  analysis: AnalysisOption[];
  /** Active controller synthesis method. */
  controller: ControllerKind;
  /** Desired closed-loop poles for Ackermann / deadbeat (text). */
  poles: string;
  /** IMC closed-loop speed λ (fraction of plant τ when ≤1). */
  pidLambda: number;
  /** Integral state weight for LQI. */
  Qi: number;
  /** Desired gain-crossover / lead frequency (rad/s). */
  omegaC: number;
  /** Lead phase boost (degrees) for lead / H∞ loop-shaping. */
  phaseBoostDeg: number;
  /** Sample time for discrete deadbeat (s). */
  sampleTime: number;
}

export const SIGNAL_COLORS = ['#e7a23a', '#5ec8ff', '#ff6b8a', '#7ddea0', '#d2a8ff', '#ffb085'];
