export type Param = number | string | boolean;

export interface PortDef {
  id: string;
  name: string;
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
}

export interface DesignConfig {
  Q: number[];
  R: number;
}

export const SIGNAL_COLORS = ['#e7a23a', '#5ec8ff', '#ff6b8a', '#7ddea0', '#d2a8ff', '#ffb085'];
