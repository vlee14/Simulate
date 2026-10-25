import { RingBuffer, TrailPoint } from '../engine/telemetry';

export interface StageView {
  x: number;
  th1: number;
  th2: number;
  l1: number;
  l2: number;
  force: number;
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

export function drawStage(canvas: HTMLCanvasElement, view: StageView): void {
  const surface = prep(canvas);
  if (!surface) return;
  const { ctx, w, h } = surface;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0c1016';
  ctx.fillRect(0, 0, w, h);

  const scale = Math.max(70, Math.min(w * 0.22, (h * 0.42) / Math.max(0.3, view.l1 + view.l2)));
  const ground = h * 0.72;
  const cartX = w * 0.5;
  const worldToX = (wx: number) => cartX + (wx - view.x) * scale;

  ctx.strokeStyle = '#243041';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(16, ground);
  ctx.lineTo(w - 16, ground);
  ctx.stroke();

  ctx.font = '11px "Cascadia Mono", Consolas, monospace';
  ctx.fillStyle = '#667386';
  ctx.textAlign = 'center';
  const start = Math.floor((view.x - w / scale) * 2) / 2;
  const end = view.x + w / scale;
  for (let mark = start; mark < end; mark += 0.25) {
    const px = worldToX(mark);
    if (px < 8 || px > w - 8) continue;
    const major = Math.abs(mark % 0.5) < 1e-6;
    ctx.beginPath();
    ctx.moveTo(px, ground);
    ctx.lineTo(px, ground + (major ? 8 : 4));
    ctx.stroke();
    if (major) ctx.fillText(mark.toFixed(1), px, ground + 20);
  }

  const pivotY = ground - 18;
  const x1 = cartX + Math.sin(view.th1) * view.l1 * scale;
  const y1 = pivotY - Math.cos(view.th1) * view.l1 * scale;
  const x2 = x1 + Math.sin(view.th2) * view.l2 * scale;
  const y2 = y1 - Math.cos(view.th2) * view.l2 * scale;

  if (view.trail.length > 1) {
    ctx.beginPath();
    view.trail.forEach((point, index) => {
      const px = worldToX(point.x);
      const tipY = ground - 18 - point.y * scale;
      if (index === 0) ctx.moveTo(px, tipY);
      else ctx.lineTo(px, tipY);
    });
    ctx.strokeStyle = 'rgba(94, 200, 255, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  ctx.strokeStyle = '#2c3544';
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(cartX, pivotY);
  ctx.lineTo(cartX, pivotY - (view.l1 + view.l2) * scale);
  ctx.stroke();
  ctx.setLineDash([]);

  roundRect(ctx, cartX - 36, ground - 32, 72, 26, 6, '#1c2633', '#8b97a8');
  ctx.fillStyle = '#10141a';
  ctx.strokeStyle = '#8b97a8';
  for (const wheel of [-20, 20]) {
    ctx.beginPath();
    ctx.arc(cartX + wheel, ground - 4, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  ctx.lineCap = 'round';
  ctx.strokeStyle = '#e7a23a';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(cartX, pivotY);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.strokeStyle = '#5ec8ff';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  dot(ctx, cartX, pivotY, 4, '#e7edf5');
  dot(ctx, x1, y1, 6, '#e7a23a');
  dot(ctx, x2, y2, 7, '#5ec8ff');

  const arrow = Math.max(-42, Math.min(42, view.force * 0.45));
  if (Math.abs(view.force) > 0.2) {
    ctx.strokeStyle = view.force >= 0 ? '#e7a23a' : '#ff6b8a';
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = 2;
    const y = ground + 28;
    ctx.beginPath();
    ctx.moveTo(cartX, y);
    ctx.lineTo(cartX + arrow, y);
    ctx.stroke();
    const dir = Math.sign(arrow) || 1;
    ctx.beginPath();
    ctx.moveTo(cartX + arrow, y);
    ctx.lineTo(cartX + arrow - dir * 6, y - 4);
    ctx.lineTo(cartX + arrow - dir * 6, y + 4);
    ctx.closePath();
    ctx.fill();
  }

  ctx.textAlign = 'left';
  ctx.font = '12px "Cascadia Mono", Consolas, monospace';
  ctx.fillStyle = '#e7a23a';
  ctx.fillText(`θ1 ${(view.th1 * 180 / Math.PI).toFixed(1)}°`, 12, 20);
  ctx.fillStyle = '#5ec8ff';
  ctx.fillText(`θ2 ${(view.th2 * 180 / Math.PI).toFixed(1)}°`, 12, 38);
  ctx.fillStyle = '#c5d0de';
  ctx.fillText(`x ${view.x.toFixed(3)} m`, 12, 56);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#e7edf5';
  ctx.fillText(`${view.force.toFixed(1)} N`, w - 12, 20);
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
