import { RingBuffer, TrailPoint } from '../engine/telemetry';
import { resolveRef, SceneElement, StageConfig } from '../engine/scene';

export interface StageView {
  config: StageConfig;
  signals: Record<string, number>;
  trail: TrailPoint[];
}

export function prep(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w < 2 || h < 2) return null;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const bw = Math.floor(w * dpr);
  const bh = Math.floor(h * dpr);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

interface Pose {
  x: number;
  y: number;
  tipX: number;
  tipY: number;
}

export function drawStage(canvas: HTMLCanvasElement, view: StageView): void {
  const surface = prep(canvas);
  if (!surface) return;
  const { ctx, w, h } = surface;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0c1016';
  ctx.fillRect(0, 0, w, h);

  const signals = view.signals;
  const scale = view.config.scale ?? 100;
  const originX = w * 0.5;
  const originY = h * 0.72;
  const toX = (wx: number) => originX + wx * scale;
  const toY = (wy: number) => originY - wy * scale;
  const poses = new Map<string, Pose>();

  // Trail under elements
  if (view.trail.length > 1) {
    ctx.beginPath();
    view.trail.forEach((point, index) => {
      const px = toX(point.x);
      const py = toY(point.y);
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.strokeStyle = 'rgba(94, 200, 255, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  for (const element of view.config.elements) {
    drawElement(ctx, element, signals, poses, toX, toY, originX, originY, scale, w, h);
  }
}

function drawElement(
  ctx: CanvasRenderingContext2D,
  element: SceneElement,
  signals: Record<string, number>,
  poses: Map<string, Pose>,
  toX: (x: number) => number,
  toY: (y: number) => number,
  originX: number,
  originY: number,
  scale: number,
  w: number,
  h: number
): void {
  const color = element.color ?? '#8b97a8';
  if (element.type === 'ground') {
    ctx.strokeStyle = '#243041';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(16, originY);
    ctx.lineTo(w - 16, originY);
    ctx.stroke();
    return;
  }
  if (element.type === 'box') {
    const x = resolveRef(element.x, signals);
    const y = resolveRef(element.y, signals);
    const bw = resolveRef(element.w, signals, 0.5) * scale;
    const bh = resolveRef(element.h, signals, 0.2) * scale;
    const px = toX(x) - bw / 2;
    const py = toY(y) - bh;
    roundRect(ctx, px, py, bw, bh, 6, '#1c2633', color);
    ctx.fillStyle = '#10141a';
    ctx.strokeStyle = color;
    for (const wheel of [-bw * 0.28, bw * 0.28]) {
      ctx.beginPath();
      ctx.arc(toX(x) + wheel, originY - 4, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    if (element.id) poses.set(element.id, { x, y: y + resolveRef(element.h, signals, 0.2), tipX: x, tipY: y + resolveRef(element.h, signals, 0.2) });
    return;
  }
  if (element.type === 'link') {
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
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(toX(baseX), toY(baseY));
    ctx.lineTo(toX(tipX), toY(tipY));
    ctx.stroke();
    dot(ctx, toX(baseX), toY(baseY), 4, '#e7edf5');
    dot(ctx, toX(tipX), toY(tipY), 6, color);
    if (element.id) poses.set(element.id, { x: baseX, y: baseY, tipX, tipY });
    return;
  }
  if (element.type === 'disk') {
    const x = resolveRef(element.x, signals);
    const y = resolveRef(element.y, signals, 0.4);
    const radius = resolveRef(element.radius, signals, 0.35);
    const cx = toX(x);
    const cy = toY(y);
    const r = radius * scale;
    ctx.strokeStyle = '#243041';
    ctx.beginPath();
    ctx.arc(cx, cy, r + 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    dot(ctx, cx, cy, 5, '#e7edf5');
    if (element.id) poses.set(element.id, { x, y, tipX: x, tipY: y });
    return;
  }
  if (element.type === 'tank') {
    const tw = resolveRef(element.w, signals, 1.2) * scale;
    const th = resolveRef(element.h, signals, 1.6) * scale;
    const left = originX - tw / 2;
    const top = originY - th - 20;
    const capacity = Math.max(1e-6, resolveRef(element.capacity, signals, 5));
    const level = resolveRef(element.value, signals);
    const frac = Math.max(0, Math.min(1, level / capacity));
    roundRect(ctx, left, top, tw, th, 8, '#121821', color);
    const fillH = th * frac;
    ctx.fillStyle = 'rgba(125, 222, 160, 0.55)';
    ctx.fillRect(left + 2, top + th - fillH, tw - 4, fillH);
    return;
  }
  if (element.type === 'piston') {
    const stroke = resolveRef(element.stroke as number | string | undefined, signals, 0.5);
    const x = resolveRef(element.x, signals);
    const force = resolveRef(element.value, signals);
    const left = w * 0.18;
    const length = w * 0.64;
    const cy = h * 0.5;
    const pos = Math.max(0, Math.min(1, (x + stroke) / (2 * stroke)));
    roundRect(ctx, left, cy - 28, length, 56, 6, '#121821', '#8b97a8');
    const px = left + 20 + pos * (length - 60);
    roundRect(ctx, px, cy - 22, 40, 44, 4, '#1c2633', color);
    ctx.strokeStyle = '#5ec8ff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(px + 40, cy);
    ctx.lineTo(left + length - 8, cy);
    ctx.stroke();
    void force;
    return;
  }
  if (element.type === 'springmass') {
    const x = resolveRef(element.x, signals);
    const cy = h * 0.5;
    const wall = w * 0.16;
    const massX = wall + 80 + x * scale;
    ctx.strokeStyle = '#8b97a8';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(wall, cy - 40);
    ctx.lineTo(wall, cy + 40);
    ctx.stroke();
    ctx.strokeStyle = '#5ec8ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const coils = 8;
    for (let i = 0; i <= coils; i++) {
      const t = i / coils;
      const sx = wall + t * (massX - 24 - wall);
      const sy = cy + (i % 2 === 0 ? -12 : 12);
      if (i === 0) ctx.moveTo(sx, cy);
      else ctx.lineTo(sx, sy);
    }
    ctx.lineTo(massX - 24, cy);
    ctx.stroke();
    roundRect(ctx, massX - 24, cy - 24, 48, 48, 6, '#1c2633', color);
    return;
  }
  if (element.type === 'arrow') {
    const force = resolveRef(element.value, signals);
    const arrow = Math.max(-42, Math.min(42, force * 0.45));
    if (Math.abs(force) <= 0.2) return;
    ctx.strokeStyle = force >= 0 ? '#e7a23a' : '#ff6b8a';
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = 2;
    const y = originY + 28;
    ctx.beginPath();
    ctx.moveTo(originX, y);
    ctx.lineTo(originX + arrow, y);
    ctx.stroke();
    const dir = Math.sign(arrow) || 1;
    ctx.beginPath();
    ctx.moveTo(originX + arrow, y);
    ctx.lineTo(originX + arrow - dir * 6, y - 4);
    ctx.lineTo(originX + arrow - dir * 6, y + 4);
    ctx.closePath();
    ctx.fill();
  }
}

export interface ScopeSeries {
  label: string;
  color: string;
  ring: RingBuffer | undefined;
}

export function drawScope(
  canvas: HTMLCanvasElement,
  series: ScopeSeries[],
  opts: { timeSpan: number; now: number; auto: boolean; yMin: number; yMax: number }
): void {
  const surface = prep(canvas);
  if (!surface) return;
  const { ctx, w, h } = surface;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0c1016';
  ctx.fillRect(0, 0, w, h);
  const padL = 42;
  const padR = 10;
  const padT = 12;
  const padB = 22;
  const plotW = Math.max(1, w - padL - padR);
  const plotH = Math.max(1, h - padT - padB);
  const t1 = opts.now;
  const t0 = t1 - Math.max(0.1, opts.timeSpan);

  let yMin = opts.yMin;
  let yMax = opts.yMax;
  if (opts.auto) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const item of series) {
      item.ring?.forEach((t, y) => {
        if (t < t0 || t > t1 || !Number.isFinite(y)) return;
        if (y < lo) lo = y;
        if (y > hi) hi = y;
      });
    }
    if (lo === Infinity) {
      lo = -1;
      hi = 1;
    }
    if (hi - lo < 1e-6) {
      lo -= 1;
      hi += 1;
    }
    const pad = (hi - lo) * 0.12;
    yMin = lo - pad;
    yMax = hi + pad;
  }
  const span = yMax - yMin || 1;

  ctx.strokeStyle = '#1c2633';
  ctx.lineWidth = 1;
  ctx.font = '10px "Cascadia Mono", Consolas, monospace';
  ctx.fillStyle = '#667386';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const y = padT + (plotH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
    const value = yMax - (span * i) / 4;
    ctx.fillText(compact(value), padL - 6, y + 3);
  }
  ctx.textAlign = 'center';
  for (let i = 0; i <= 4; i++) {
    const x = padL + (plotW * i) / 4;
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + plotH);
    ctx.stroke();
    const time = t0 + ((t1 - t0) * i) / 4;
    ctx.fillText(time.toFixed(1), x, h - 6);
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(padL, padT, plotW, plotH);
  ctx.clip();
  series.forEach((item) => {
    if (!item.ring || item.ring.count < 2) return;
    ctx.beginPath();
    let started = false;
    const buckets = new Map<number, { min: number; max: number }>();
    item.ring.forEach((t, y) => {
      if (t < t0 || t > t1 || !Number.isFinite(y)) return;
      const px = Math.round(padL + ((t - t0) / (t1 - t0)) * plotW);
      const hit = buckets.get(px);
      if (!hit) buckets.set(px, { min: y, max: y });
      else {
        if (y < hit.min) hit.min = y;
        if (y > hit.max) hit.max = y;
      }
    });
    const xs = [...buckets.keys()].sort((a, b) => a - b);
    for (const x of xs) {
      const hit = buckets.get(x)!;
      const y1 = padT + ((yMax - hit.max) / span) * plotH;
      const y2 = padT + ((yMax - hit.min) / span) * plotH;
      if (!started) {
        ctx.moveTo(x, y1);
        started = true;
      } else ctx.lineTo(x, y1);
      if (y2 !== y1) ctx.lineTo(x, y2);
    }
    ctx.strokeStyle = item.color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });
  ctx.restore();

  ctx.textAlign = 'left';
  series.forEach((item, index) => {
    ctx.fillStyle = item.color;
    ctx.fillText(item.label, padL + index * 78, 11);
  });
}

export function drawXY(canvas: HTMLCanvasElement, xRing: RingBuffer | undefined, yRing: RingBuffer | undefined, timeSpan: number, now: number): void {
  const surface = prep(canvas);
  if (!surface) return;
  const { ctx, w, h } = surface;
  ctx.fillStyle = '#0c1016';
  ctx.fillRect(0, 0, w, h);
  const pad = 16;
  const t0 = now - Math.max(0.1, timeSpan);
  const pts: { x: number; y: number }[] = [];
  const count = Math.min(xRing?.count ?? 0, yRing?.count ?? 0);
  for (let i = 0; i < count; i++) {
    const xs = xRing!.at(i);
    const ys = yRing!.at(i);
    if (!xs || !ys || xs.t < t0) continue;
    pts.push({ x: xs.y, y: ys.y });
  }
  let loX = Infinity;
  let hiX = -Infinity;
  let loY = Infinity;
  let hiY = -Infinity;
  for (const p of pts) {
    loX = Math.min(loX, p.x);
    hiX = Math.max(hiX, p.x);
    loY = Math.min(loY, p.y);
    hiY = Math.max(hiY, p.y);
  }
  if (loX === Infinity) {
    loX = -0.5;
    hiX = 0.5;
    loY = -0.5;
    hiY = 0.5;
  }
  const padX = Math.max(0.05, (hiX - loX) * 0.15);
  const padY = Math.max(0.05, (hiY - loY) * 0.15);
  loX -= padX;
  hiX += padX;
  loY -= padY;
  hiY += padY;
  const mapX = (v: number) => pad + ((v - loX) / (hiX - loX || 1)) * (w - pad * 2);
  const mapY = (v: number) => h - pad - ((v - loY) / (hiY - loY || 1)) * (h - pad * 2);
  if (0 >= loX && 0 <= hiX) {
    ctx.strokeStyle = '#1c2633';
    ctx.beginPath();
    ctx.moveTo(mapX(0), pad);
    ctx.lineTo(mapX(0), h - pad);
    ctx.stroke();
  }
  if (0 >= loY && 0 <= hiY) {
    ctx.strokeStyle = '#1c2633';
    ctx.beginPath();
    ctx.moveTo(pad, mapY(0));
    ctx.lineTo(w - pad, mapY(0));
    ctx.stroke();
  }
  if (pts.length > 1) {
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(mapX(p.x), mapY(p.y)) : ctx.lineTo(mapX(p.x), mapY(p.y))));
    ctx.strokeStyle = '#e7a23a';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    const last = pts[pts.length - 1];
    dot(ctx, mapX(last.x), mapY(last.y), 3.5, '#5ec8ff');
  }
  ctx.fillStyle = '#667386';
  ctx.font = '10px "Cascadia Mono", Consolas, monospace';
  ctx.textAlign = 'left';
  ctx.fillText('θ₁ →', pad, h - 4);
  ctx.fillText('θ₂ ↑', pad, 12);
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
  stroke: string
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  ctx.fill();
  ctx.stroke();
}

function compact(value: number): string {
  if (!Number.isFinite(value)) return '';
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 1000 || abs < 0.01)) return value.toExponential(1);
  return value.toFixed(abs >= 10 ? 1 : 2);
}
