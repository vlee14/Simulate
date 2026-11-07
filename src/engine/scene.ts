import { PortDef, PortDomain } from './types';

export interface SceneElement {
  type: string;
  id?: string;
  /** Numeric or `$port` reference. */
  x?: number | string;
  y?: number | string;
  w?: number | string;
  h?: number | string;
  angle?: number | string;
  length?: number | string;
  radius?: number | string;
  value?: number | string;
  capacity?: number | string;
  stroke?: number | string;
  from?: string;
  color?: string;
  label?: string;
}

export interface StageConfig {
  inputs: PortDef[];
  elements: SceneElement[];
  /** Element id whose tip is trailed. */
  trail?: string;
  /** World units per pixel scale hint. */
  scale?: number;
  nudge: { label: string; index: number; amount: number }[];
  /** Optional plant id/role for nudge; empty → first dynamics plant. */
  nudgePlant: string;
  readouts: { label: string; port: string; format: 'number' | 'deg' }[];
}

function parsePortList(raw: string): PortDef[] {
  const parts = raw
    .split(/[,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.map((part) => {
    const [name, domain] = part.split(':').map((s) => s.trim());
    return {
      id: name,
      name,
      domain: (domain as PortDomain) || 'signal',
    };
  });
}

function parseNudge(raw: string): { label: string; index: number; amount: number }[] {
  return raw
    .split(/[;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const [label, indexText, amountText] = part.split('|').map((s) => s.trim());
      const index = Number(indexText);
      const amount = Number(amountText);
      if (!label || !Number.isFinite(index) || !Number.isFinite(amount)) return [];
      return [{ label, index: Math.round(index), amount }];
    });
}

function parseReadouts(raw: string): { label: string; port: string; format: 'number' | 'deg' }[] {
  return raw
    .split(/[;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const [label, port, format] = part.split('|').map((s) => s.trim());
      if (!label || !port) return [];
      return [{ label, port, format: format === 'deg' ? 'deg' : 'number' }];
    });
}

export function parseScene(raw: string): SceneElement[] {
  const text = raw.trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item === 'object' && typeof (item as SceneElement).type === 'string') as SceneElement[];
  } catch {
    return [];
  }
}

export function parseStageConfig(parameters: Record<string, string | number | boolean>): StageConfig {
  const inputsRaw = String(parameters.inputs ?? 'u');
  const inputs = parsePortList(inputsRaw);
  const elements = parseScene(String(parameters.scene ?? '[]'));
  const nudge = parseNudge(String(parameters.nudge ?? ''));
  const readouts = parseReadouts(String(parameters.readouts ?? ''));
  const trail = String(parameters.trail ?? '').trim();
  const scale = Number(parameters.scale);
  return {
    inputs: inputs.length ? inputs : [{ id: 'u', name: 'u', domain: 'signal' }],
    elements,
    trail: trail || undefined,
    scale: Number.isFinite(scale) && scale > 0 ? scale : undefined,
    nudge,
    nudgePlant: String(parameters.nudgePlant ?? '').trim(),
    readouts:
      readouts.length > 0
        ? readouts
        : inputs.map((port) => ({ label: port.name, port: port.id, format: 'number' as const })),
  };
}

/** Resolve `$port` or numeric literals against live signals. */
export function resolveRef(value: number | string | undefined, signals: Record<string, number>, fallback = 0): number {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  const text = String(value).trim();
  if (text.startsWith('$')) {
    const key = text.slice(1);
    const v = signals[key];
    return Number.isFinite(v) ? v : fallback;
  }
  const n = Number(text);
  return Number.isFinite(n) ? n : fallback;
}

interface Pose {
  tipX: number;
  tipY: number;
}

/** World-space tip of the configured trail element, if any. */
export function stageTrailTip(config: StageConfig, signals: Record<string, number>): { x: number; y: number } | null {
  if (!config.trail) return null;
  const poses = new Map<string, Pose>();
  for (const element of config.elements) {
    if (element.type === 'box') {
      const x = resolveRef(element.x, signals);
      const y = resolveRef(element.y, signals);
      const hh = resolveRef(element.h, signals, 0.2);
      if (element.id) poses.set(element.id, { tipX: x, tipY: y + hh });
    } else if (element.type === 'disk') {
      const x = resolveRef(element.x, signals);
      const y = resolveRef(element.y, signals, 0.4);
      if (element.id) poses.set(element.id, { tipX: x, tipY: y });
    } else if (element.type === 'link') {
      const angle = resolveRef(element.angle, signals);
      const length = resolveRef(element.length, signals, 0.4);
      let baseX = 0;
      let baseY = 0.2;
      if (element.from && poses.has(element.from)) {
        const parent = poses.get(element.from)!;
        baseX = parent.tipX;
        baseY = parent.tipY;
      }
      const tipX = baseX + Math.sin(angle) * length;
      const tipY = baseY + Math.cos(angle) * length;
      if (element.id) poses.set(element.id, { tipX, tipY });
    }
  }
  const tip = poses.get(config.trail);
  return tip ? { x: tip.tipX, y: tip.tipY } : null;
}
