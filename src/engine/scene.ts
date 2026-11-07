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

export interface StageControl {
  label: string;
  /** Manual (or any value-source) block id / role. */
  block: string;
  min: number;
  max: number;
  /** Spring back to 0 when pointer / key released. */
  spring: boolean;
}

export interface StageDisturbance {
  label: string;
  /** `pulse` retriggers a Pulse block; `nudge` kicks plant state. */
  kind: 'pulse' | 'nudge';
  /** Pulse block id/role, or unused for nudge. */
  block: string;
  /** Pulse amplitude, or nudge amount. */
  amount: number;
  /** State index for nudge kind. */
  index: number;
}

export interface StageInteract {
  /** Scene element id, or `*` for empty-canvas drag → control. */
  target: string;
  kind: 'nudge' | 'control';
  index: number;
  amount: number;
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
  control: StageControl | null;
  disturbance: StageDisturbance[];
  interact: StageInteract[];
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

/** `label|blockId|min|max` or `label|blockId|min|max|hold` (hold = no spring). */
export function parseControl(raw: string): StageControl | null {
  const text = raw.trim();
  if (!text) return null;
  const [label, block, minText, maxText, mode] = text.split('|').map((s) => s.trim());
  const min = Number(minText);
  const max = Number(maxText);
  if (!label || !block || !Number.isFinite(min) || !Number.isFinite(max) || min === max) return null;
  return {
    label,
    block,
    min: Math.min(min, max),
    max: Math.max(min, max),
    spring: mode !== 'hold',
  };
}

/**
 * `label|pulse|blockId|amplitude` or `label|nudge|stateIndex|amount`
 * (legacy shorthand `label|amplitude` → pulse on block `pulse`).
 */
export function parseDisturbance(raw: string): StageDisturbance[] {
  const out: StageDisturbance[] = [];
  for (const part of raw.split(/[;\n]+/)) {
    const text = part.trim();
    if (!text) continue;
    const bits = text.split('|').map((s) => s.trim());
    if (bits.length < 2) continue;
    const [label, a, b, c] = bits;
    if (!label) continue;
    if (a === 'pulse') {
      const amount = Number(c ?? b);
      const block = c !== undefined ? b : 'pulse';
      if (!Number.isFinite(amount)) continue;
      out.push({ label, kind: 'pulse', block: block || 'pulse', amount, index: 0 });
      continue;
    }
    if (a === 'nudge') {
      const index = Number(b);
      const amount = Number(c);
      if (!Number.isFinite(index) || !Number.isFinite(amount)) continue;
      out.push({ label, kind: 'nudge', block: '', amount, index: Math.round(index) });
      continue;
    }
    // Shorthand: label|±amp → pulse on "pulse"
    const amount = Number(a);
    if (!Number.isFinite(amount)) continue;
    out.push({ label, kind: 'pulse', block: b || 'pulse', amount, index: 0 });
  }
  return out;
}

/** `elementId|nudge|index|amount` or `*|control` for canvas drag → control source. */
export function parseInteract(raw: string): StageInteract[] {
  const out: StageInteract[] = [];
  for (const part of raw.split(/[;\n]+/)) {
    const text = part.trim();
    if (!text) continue;
    const bits = text.split('|').map((s) => s.trim());
    const [target, kind, indexText, amountText] = bits;
    if (!target) continue;
    if (kind === 'control' || (target === '*' && (!kind || kind === 'control'))) {
      out.push({ target: '*', kind: 'control', index: 0, amount: Number(amountText) || 1 });
      continue;
    }
    if (kind === 'nudge' || bits.length === 3) {
      // elementId|index|amount  OR  elementId|nudge|index|amount
      const index = Number(kind === 'nudge' ? indexText : kind);
      const amount = Number(kind === 'nudge' ? amountText : indexText);
      if (!Number.isFinite(index) || !Number.isFinite(amount)) continue;
      out.push({ target, kind: 'nudge', index: Math.round(index), amount });
    }
  }
  return out;
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
  const control = parseControl(String(parameters.control ?? ''));
  const disturbance = parseDisturbance(String(parameters.disturbance ?? ''));
  let interact = parseInteract(String(parameters.interact ?? ''));
  if (!interact.length && control) {
    interact = [{ target: '*', kind: 'control', index: 0, amount: 1 }];
  }
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
    control,
    disturbance,
    interact,
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
  baseX?: number;
  baseY?: number;
  kind?: string;
  radius?: number;
}

export interface StageHitTarget {
  id: string;
  kind: string;
  /** World-space center / tip used for hit tests. */
  x: number;
  y: number;
  /** Optional segment for links. */
  x0?: number;
  y0?: number;
  radius: number;
}

function collectPoses(config: StageConfig, signals: Record<string, number>): Map<string, Pose> {
  const poses = new Map<string, Pose>();
  for (const element of config.elements) {
    if (element.type === 'box') {
      const x = resolveRef(element.x, signals);
      const y = resolveRef(element.y, signals);
      const hh = resolveRef(element.h, signals, 0.2);
      const hw = resolveRef(element.w, signals, 0.5) / 2;
      if (element.id) poses.set(element.id, { tipX: x, tipY: y + hh, baseX: x, baseY: y + hh / 2, kind: 'box', radius: Math.max(hw, hh) });
    } else if (element.type === 'disk') {
      const x = resolveRef(element.x, signals);
      const y = resolveRef(element.y, signals, 0.4);
      const radius = resolveRef(element.radius, signals, 0.35);
      if (element.id) poses.set(element.id, { tipX: x, tipY: y, baseX: x, baseY: y, kind: 'disk', radius });
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
      if (element.id) poses.set(element.id, { tipX, tipY, baseX, baseY, kind: 'link', radius: 0.12 });
    } else if (element.type === 'springmass' || element.type === 'piston' || element.type === 'tank') {
      const x = resolveRef(element.x, signals);
      if (element.id) poses.set(element.id, { tipX: x, tipY: 0.4, baseX: x, baseY: 0.4, kind: element.type, radius: 0.35 });
    }
  }
  return poses;
}

/** World-space tip of the configured trail element, if any. */
export function stageTrailTip(config: StageConfig, signals: Record<string, number>): { x: number; y: number } | null {
  if (!config.trail) return null;
  const poses = collectPoses(config, signals);
  const tip = poses.get(config.trail);
  return tip ? { x: tip.tipX, y: tip.tipY } : null;
}

export interface WorldBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Canvas camera: world `look` maps to pixel `origin`. */
export interface StageCamera {
  scale: number;
  lookX: number;
  lookY: number;
  originX: number;
  originY: number;
}

/** True when the scene uses world-space geometry that should be framed. */
export function stageUsesWorldCamera(config: StageConfig): boolean {
  return config.elements.some((element) => element.type === 'box' || element.type === 'disk' || element.type === 'link');
}

/** Axis-aligned bounds of live world-space stage geometry. */
export function stageWorldBounds(config: StageConfig, signals: Record<string, number>): WorldBounds | null {
  if (!stageUsesWorldCamera(config)) return null;
  const poses = collectPoses(config, signals);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const include = (x: number, y: number, r = 0) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    minX = Math.min(minX, x - r);
    maxX = Math.max(maxX, x + r);
    minY = Math.min(minY, y - r);
    maxY = Math.max(maxY, y + r);
  };
  for (const pose of poses.values()) {
    const r = pose.radius ?? 0.1;
    include(pose.tipX, pose.tipY, r);
    if (pose.baseX !== undefined && pose.baseY !== undefined) include(pose.baseX, pose.baseY, r * 0.5);
  }
  // Ground is a full-width line at y=0 — keep it in the vertical frame without pinning x to the origin.
  if (config.elements.some((element) => element.type === 'ground') && Number.isFinite(minX)) {
    const mid = (minX + maxX) / 2;
    include(mid, 0, 0);
  }
  if (!Number.isFinite(minX)) return null;
  // Keep a usable minimum extent so a single point still frames.
  const pad = 0.35;
  if (maxX - minX < pad) {
    const cx = (minX + maxX) / 2;
    minX = cx - pad / 2;
    maxX = cx + pad / 2;
  }
  if (maxY - minY < pad) {
    const cy = (minY + maxY) / 2;
    minY = cy - pad / 2;
    maxY = cy + pad / 2;
  }
  return { minX, maxX, minY, maxY };
}

function defaultStageCamera(width: number, height: number, scale: number, grounded: boolean): StageCamera {
  return {
    scale,
    lookX: 0,
    lookY: 0,
    originX: width * 0.5,
    originY: height * (grounded ? 0.68 : 0.5),
  };
}

/**
 * Fit / center the stage camera on live world geometry.
 * Zooms out from the authored scale when content would clip; pans to keep subjects in frame.
 */
export function fitStageCamera(
  config: StageConfig,
  signals: Record<string, number>,
  width: number,
  height: number,
  previous?: StageCamera | null
): StageCamera {
  const preferred = config.scale && config.scale > 0 ? config.scale : 100;
  const grounded = config.elements.some((element) => element.type === 'ground');
  const bounds = stageWorldBounds(config, signals);
  if (!bounds || width < 2 || height < 2) {
    return settleStageCamera(previous, defaultStageCamera(width, height, preferred, grounded));
  }

  const marginX = Math.max(18, width * 0.12);
  const marginY = Math.max(16, height * 0.14);
  const viewW = Math.max(1, width - marginX * 2);
  const viewH = Math.max(1, height - marginY * 2);

  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  // Bias the look toward the trailed subject so chase / tip stay in the sweet spot,
  // while still framing the full bounds via scale.
  const tip = stageTrailTip(config, signals);
  const lookX = tip ? tip.x * 0.4 + cx * 0.6 : cx;
  let lookY = tip ? tip.y * 0.25 + cy * 0.75 : cy;

  const halfW = Math.max(bounds.maxX - lookX, lookX - bounds.minX, 0.3);
  const halfH = Math.max(bounds.maxY - lookY, lookY - bounds.minY, 0.3);
  let scale = Math.min(preferred, viewW / (2 * halfW), viewH / (2 * halfH));
  scale = Math.max(scale, preferred * 0.18);

  const originX = width * 0.5;
  // Grounded scenes sit slightly low so wheels/ground read as a floor; airborne stays mid-frame.
  const originY = grounded ? height * 0.58 : height * 0.5;

  if (grounded) {
    // If y=0 would fall off the bottom after centering, lift lookY just enough to keep it.
    const groundY = originY + lookY * scale;
    const maxGround = height - marginY;
    if (groundY > maxGround) {
      lookY = (maxGround - originY) / scale;
    }
  }

  return settleStageCamera(previous, { scale, lookX, lookY, originX, originY });
}

/**
 * Soft-follow with snap on large jumps (demo switch / teleport) so framing
 * does not linger on a previous scene's look point.
 */
export function settleStageCamera(previous: StageCamera | null | undefined, next: StageCamera, alpha = 0.28): StageCamera {
  if (!previous) return next;
  const jump =
    Math.hypot(next.lookX - previous.lookX, next.lookY - previous.lookY) > 2.5 ||
    Math.abs(next.scale - previous.scale) > Math.max(next.scale, previous.scale) * 0.65;
  if (jump) return next;
  const blend = (a: number, b: number) => a + (b - a) * alpha;
  return {
    scale: blend(previous.scale, next.scale),
    lookX: blend(previous.lookX, next.lookX),
    lookY: blend(previous.lookY, next.lookY),
    originX: next.originX,
    originY: next.originY,
  };
}

/** @deprecated Use settleStageCamera. */
export function smoothStageCamera(previous: StageCamera | null | undefined, next: StageCamera, alpha = 0.28): StageCamera {
  return settleStageCamera(previous, next, alpha);
}

export function canvasToWorld(camera: StageCamera, px: number, py: number): { x: number; y: number } {
  return {
    x: camera.lookX + (px - camera.originX) / camera.scale,
    y: camera.lookY + (camera.originY - py) / camera.scale,
  };
}

export function worldToCanvas(camera: StageCamera, wx: number, wy: number): { x: number; y: number } {
  return {
    x: camera.originX + (wx - camera.lookX) * camera.scale,
    y: camera.originY - (wy - camera.lookY) * camera.scale,
  };
}

/** Hit targets for pointer interactions (world units). */
export function stageHitTargets(config: StageConfig, signals: Record<string, number>): StageHitTarget[] {
  const poses = collectPoses(config, signals);
  const targets: StageHitTarget[] = [];
  for (const [id, pose] of poses) {
    targets.push({
      id,
      kind: pose.kind ?? 'point',
      x: pose.tipX,
      y: pose.tipY,
      x0: pose.baseX,
      y0: pose.baseY,
      radius: pose.radius ?? 0.15,
    });
  }
  return targets;
}

function distPointSeg(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return Math.hypot(px - x0, py - y0);
  let t = ((px - x0) * dx + (py - y0) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

/** Pick nearest interactive element under a world-space pointer. */
export function hitTestStage(
  config: StageConfig,
  signals: Record<string, number>,
  worldX: number,
  worldY: number,
  pad = 0.08
): StageInteract | null {
  if (!config.interact.length) return null;
  const byTarget = new Map(config.interact.map((item) => [item.target, item]));
  const targets = stageHitTargets(config, signals);
  let best: { item: StageInteract; dist: number } | null = null;
  for (const target of targets) {
    const item = byTarget.get(target.id);
    if (!item || item.kind !== 'nudge') continue;
    let dist: number;
    if (target.kind === 'link' && target.x0 !== undefined && target.y0 !== undefined) {
      dist = distPointSeg(worldX, worldY, target.x0, target.y0, target.x, target.y);
    } else {
      dist = Math.hypot(worldX - target.x, worldY - target.y);
    }
    if (dist <= target.radius + pad && (!best || dist < best.dist)) best = { item, dist };
  }
  if (best) return best.item;
  return byTarget.get('*') ?? null;
}
