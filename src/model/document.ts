import { DesignConfig, Param, ParamUncertainty, SimConfig } from '../engine/types';

export interface DocNode {
  id: string;
  blockType: string;
  x: number;
  y: number;
  parameters?: Record<string, Param>;
  /** Per-parameter Monte Carlo distributions; seeds stay fixed once assigned. */
  uncertainty?: Record<string, ParamUncertainty>;
  alias?: string;
  role?: string;
}

export interface DocEdge {
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
}

export interface SimDocument {
  format?: 'simulate';
  version?: number;
  name: string;
  description: string;
  config: SimConfig;
  design: DesignConfig;
  nodes: DocNode[];
  edges: DocEdge[];
}

export const DEFAULT_CONFIG: SimConfig = {
  solver: 'rk4',
  stepSize: 0.001,
  stopTime: 16,
  startTime: 0,
  speed: 1,
  mcRun: 0,
  mcConfidence: 0.95,
  mcRelError: 0.05,
  mcTailQuantile: 0.95,
  mcCampaignSize: 1000,
  mcOverlayCount: 96,
  mcShowAllLines: false,
};

export const DEFAULT_DESIGN: DesignConfig = {
  Q: [40, 20, 20, 10, 0.5, 0.5],
  R: 0.8,
  opMode: 'equilibrium',
  xOp: '',
  uOp: '0',
  tOp: 0,
  analysis: ['poles', 'ctrb', 'damping', 'margins', 'polemap', 'bode', 'nyquist', 'nichols', 'rlocus'],
  controller: 'lqr',
  poles: '-2 -3 -4 -5',
  pidLambda: 0,
  Qi: 20,
  omegaC: 3,
  phaseBoostDeg: 45,
  sampleTime: 0.02,
};
