import { DesignConfig, Param, SimConfig } from '../engine/types';

export interface DocNode {
  id: string;
  blockType: string;
  x: number;
  y: number;
  parameters?: Record<string, Param>;
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
};

export const DEFAULT_DESIGN: DesignConfig = {
  Q: [40, 20, 20, 10, 0.5, 0.5],
  R: 0.8,
};
