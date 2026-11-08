import React, { useEffect, useRef, useState } from 'react';
import { McCampaignStats, PercentileBand } from '../engine/mcStats';
import {
  ChartAxisBounds,
  formatTick,
  logDecadeTicks,
  niceBounds,
  niceTicks,
  nicholsPhaseSeries,
  resolveAxisBounds,
  symmetricLimit,
  wrapNicholsPhase,
} from '../engine/plotAxes';
import { FreqPoint, RootLocusBranch, StabilityReport } from '../engine/stability';

export type ChartKind = 'bode-mag' | 'bode-phase' | 'nyquist' | 'nichols' | 'poles' | 'rlocus';
export type { ChartAxisBounds };

type PlotTheme = {
  bg: string;
  axis: string;
  mc: string;
  nom: string;
  sel: string;
  band: string;
  bandInner: string;
  label: string;
};

const FALLBACK: PlotTheme = {
  bg: '#f4f6f8',
  axis: '#c5cbd3',
  mc: '#9aa3b2',
  nom: '#111827',
  sel: '#c45c26',
  band: 'rgba(154,163,178,0.22)',
  bandInner: 'rgba(154,163,178,0.35)',
  label: '#6b7785',
};

function readPlotTheme(el: HTMLElement | null): PlotTheme {
  if (!el) return FALLBACK;
  const s = getComputedStyle(el);
  const pick = (name: string, fallback: string) => {
    const v = s.getPropertyValue(name).trim();
    return v || fallback;
  };
  return {
    bg: pick('--plot-bg', FALLBACK.bg),
    axis: pick('--plot-axis', FALLBACK.axis),
    mc: pick('--plot-mc', FALLBACK.mc),
    nom: pick('--plot-nom', FALLBACK.nom),
    sel: pick('--plot-sel', FALLBACK.sel),
    band: pick('--plot-band', FALLBACK.band),
    bandInner: pick('--plot-band-inner', FALLBACK.bandInner),
    label: pick('--plot-label', FALLBACK.label),
  };
}

function drawBand(
  ctx: CanvasRenderingContext2D,
  band: PercentileBand,
  toX: (x: number) => number,
  toY: (y: number) => number,
  lo: keyof PercentileBand,
  hi: keyof PercentileBand,
  fill: string
) {
  const xs = band.x;
  if (xs.length < 2) return;
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < xs.length; i++) {
    const y = band[lo][i] as number;
    if (!Number.isFinite(y)) continue;
    const x = toX(xs[i]);
    const yy = toY(y);
    if (!started) {
      ctx.moveTo(x, yy);
      started = true;
    } else ctx.lineTo(x, yy);
  }
  for (let i = xs.length - 1; i >= 0; i--) {
    const y = band[hi][i] as number;
    if (!Number.isFinite(y)) continue;
    ctx.lineTo(toX(xs[i]), toY(y));
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function strokeSeries(
  ctx: CanvasRenderingContext2D,
  pts: { x: number; y: number }[],
  color: string,
  width: number,
  alpha = 1,
  dash?: number[]
) {
  if (pts.length < 2) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
  ctx.restore();
}

type Pad = { l: number; r: number; t: number; b: number };

function drawFrame(ctx: CanvasRenderingContext2D, w: number, h: number, pad: Pad, color: string) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(pad.l, pad.t, w - pad.l - pad.r, h - pad.t - pad.b);
}

function drawLinearAxes(
  ctx: CanvasRenderingContext2D,
  opts: {
    w: number;
    h: number;
    pad: Pad;
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
    toX: (v: number) => number;
    toY: (v: number) => number;
    xTicks: number[];
    yTicks: number[];
    xFormat?: (v: number) => string;
    yFormat?: (v: number) => string;
    xUnit: string;
    yUnit: string;
    color: string;
    labelColor: string;
    crosshair?: { x: number; y: number };
  }
) {
  const {
    w,
    h,
    pad,
    toX,
    toY,
    xTicks,
    yTicks,
    xFormat = (v) => formatTick(v),
    yFormat = (v) => formatTick(v),
    xUnit,
    yUnit,
    color,
    labelColor,
    crosshair,
  } = opts;
  drawFrame(ctx, w, h, pad, color);
  if (crosshair) {
    ctx.strokeStyle = color;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(toX(crosshair.x), pad.t);
    ctx.lineTo(toX(crosshair.x), h - pad.b);
    ctx.moveTo(pad.l, toY(crosshair.y));
    ctx.lineTo(w - pad.r, toY(crosshair.y));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.fillStyle = labelColor;
  ctx.strokeStyle = color;
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const v of xTicks) {
    const x = toX(v);
    if (x < pad.l - 1 || x > w - pad.r + 1) continue;
    ctx.beginPath();
    ctx.moveTo(x, h - pad.b);
    ctx.lineTo(x, h - pad.b + 4);
    ctx.stroke();
    ctx.fillText(xFormat(v), x, h - pad.b + 5);
  }
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const v of yTicks) {
    const y = toY(v);
    if (y < pad.t - 1 || y > h - pad.b + 1) continue;
    ctx.beginPath();
    ctx.moveTo(pad.l - 4, y);
    ctx.lineTo(pad.l, y);
    ctx.stroke();
    ctx.fillText(yFormat(v), pad.l - 6, y);
  }
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText(xUnit, w - pad.r, h - 2);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(yUnit, 4, 4);
}

/** WebGL2 line batch for dense MC polylines (log-x already baked into xy pack). */
function drawWebGlLines(
  canvas: HTMLCanvasElement,
  xy: Float32Array,
  toX: (x: number) => number,
  toY: (y: number) => number,
  color: [number, number, number, number]
) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: false });
  if (!gl) return false;
  const pixels = new Float32Array(xy.length);
  for (let i = 0; i < xy.length; i += 2) {
    const x = xy[i];
    const y = xy[i + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      pixels[i] = NaN;
      pixels[i + 1] = NaN;
    } else {
      pixels[i] = toX(x);
      pixels[i + 1] = toY(y);
    }
  }
  const w = canvas.width;
  const h = canvas.height;
  const vsSource = `#version 300 es
  in vec2 a_pos;
  void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }`;
  const fsSource = `#version 300 es
  precision mediump float;
  uniform vec4 u_color;
  out vec4 outColor;
  void main(){ outColor = u_color; }`;
  const compile = (type: number, src: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return sh;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, vsSource));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSource));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  const loc = gl.getAttribLocation(prog, 'a_pos');
  const uColor = gl.getUniformLocation(prog, 'u_color');
  gl.uniform4f(uColor, color[0], color[1], color[2], color[3]);
  gl.viewport(0, 0, w, h);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  let start = 0;
  const flush = (end: number) => {
    if (end - start < 4) {
      start = end + 2;
      return;
    }
    const slice = pixels.subarray(start, end);
    const ndc = new Float32Array(slice.length);
    for (let i = 0; i < slice.length; i += 2) {
      ndc[i] = (slice[i] / w) * 2 - 1;
      ndc[i + 1] = 1 - (slice[i + 1] / h) * 2;
    }
    gl.bufferData(gl.ARRAY_BUFFER, ndc, gl.STREAM_DRAW);
    gl.drawArrays(gl.LINE_STRIP, 0, ndc.length / 2);
    start = end + 2;
  };
  for (let i = 0; i < pixels.length; i += 2) {
    if (!Number.isFinite(pixels[i]) || !Number.isFinite(pixels[i + 1])) flush(i);
  }
  flush(pixels.length);
  return true;
}

export function EnsembleChart({
  kind,
  title,
  hint,
  width,
  height = 160,
  nominal,
  selected,
  ensembleFreq,
  campaign,
  showAllLines,
  fill = false,
  compact = true,
  expandable = false,
  onOpen,
  axisBounds = null,
  onAutoBounds,
}: {
  kind: ChartKind;
  title: string;
  hint?: string;
  width?: number;
  height?: number;
  nominal?: StabilityReport | null;
  selected?: StabilityReport | null;
  ensembleFreq?: { run: number; freq: FreqPoint[] }[];
  campaign?: McCampaignStats | null;
  showAllLines?: boolean;
  /** Stretch to parent width via ResizeObserver. */
  fill?: boolean;
  compact?: boolean;
  expandable?: boolean;
  onOpen?: () => void;
  /** Manual axis window in plot-native units (Bode x = log₁₀ ω). */
  axisBounds?: Partial<ChartAxisBounds> | null;
  /** Fires with the auto-computed window (before manual overrides). */
  onAutoBounds?: (bounds: ChartAxisBounds) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const onAutoBoundsRef = useRef(onAutoBounds);
  onAutoBoundsRef.current = onAutoBounds;
  const [autoWidth, setAutoWidth] = useState(width ?? 280);

  const publishAuto = (auto: ChartAxisBounds): ChartAxisBounds => {
    onAutoBoundsRef.current?.(auto);
    return resolveAxisBounds(auto, axisBounds);
  };

  useEffect(() => {
    if (!fill || width != null) {
      if (width != null) setAutoWidth(width);
      return;
    }
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && Number.isFinite(w)) setAutoWidth(Math.max(180, Math.floor(w)));
    });
    ro.observe(el);
    setAutoWidth(Math.max(180, Math.floor(el.clientWidth || 280)));
    return () => ro.disconnect();
  }, [fill, width]);

  const plotW = width ?? autoWidth;
  const plotH = height;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const theme = readPlotTheme(wrapRef.current);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(plotW * dpr);
    canvas.height = Math.round(plotH * dpr);
    canvas.style.width = `${plotW}px`;
    canvas.style.height = `${plotH}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, plotW, plotH);

    const pad: Pad = {
      l: kind === 'bode-mag' || kind === 'bode-phase' || kind === 'nichols' ? 42 : 36,
      r: 12,
      t: 16,
      b: 28,
    };

    if (kind === 'poles' || kind === 'rlocus') {
      const branches: RootLocusBranch[] = kind === 'rlocus' ? nominal?.rootLocus ?? [] : [];
      const pts = [
        ...(nominal?.polesOpen ?? []),
        ...(nominal?.polesClosed ?? []),
        ...(kind === 'poles' ? campaign?.poleCloud ?? [] : []),
        ...(selected?.polesClosed ?? []),
        ...branches.flatMap((b) => b.points),
      ];
      if (!pts.length) return;
      const focus = [
        ...(nominal?.polesOpen ?? []),
        ...(nominal?.polesClosed ?? []),
        ...(selected?.polesClosed ?? []),
      ];
      const lim = symmetricLimit(
        pts.map((p) => Math.max(Math.abs(p.real), Math.abs(p.imag))),
        {
          floor: 1,
          padFrac: kind === 'rlocus' ? 0.15 : 0.12,
          percentile: kind === 'poles' && (campaign?.poleCloud?.length ?? 0) > 40 ? 0.92 : 0.98,
          include: focus.map((p) => Math.max(Math.abs(p.real), Math.abs(p.imag))),
        }
      );
      const { xMin, xMax, yMin, yMax } = publishAuto({ xMin: -lim, xMax: lim, yMin: -lim, yMax: lim });
      const toX = (re: number) => pad.l + ((re - xMin) / (xMax - xMin || 1)) * (plotW - pad.l - pad.r);
      const toY = (im: number) => plotH - pad.b - ((im - yMin) / (yMax - yMin || 1)) * (plotH - pad.t - pad.b);
      drawLinearAxes(ctx, {
        w: plotW,
        h: plotH,
        pad,
        xMin,
        xMax,
        yMin,
        yMax,
        toX,
        toY,
        xTicks: niceTicks(xMin, xMax, 5),
        yTicks: niceTicks(yMin, yMax, 5),
        xUnit: 'Re (1/s)',
        yUnit: 'Im (1/s)',
        color: theme.axis,
        labelColor: theme.label,
        crosshair: { x: 0, y: 0 },
      });
      if (kind === 'poles') {
        const cloud = campaign?.poleCloud ?? [];
        ctx.fillStyle = theme.mc;
        ctx.globalAlpha = cloud.length > 2000 ? 0.08 : cloud.length > 400 ? 0.15 : 0.35;
        for (const p of cloud) {
          ctx.beginPath();
          ctx.arc(toX(p.real), toY(p.imag), cloud.length > 2000 ? 1.2 : 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      } else {
        for (const b of branches) {
          strokeSeries(ctx, b.points.map((p) => ({ x: toX(p.real), y: toY(p.imag) })), theme.nom, 1.8);
        }
      }
      if (nominal) {
        ctx.strokeStyle = theme.nom;
        ctx.lineWidth = 1.6;
        for (const p of nominal.polesOpen) {
          ctx.beginPath();
          ctx.arc(toX(p.real), toY(p.imag), 4, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.fillStyle = theme.nom;
        for (const p of nominal.polesClosed) {
          ctx.beginPath();
          ctx.arc(toX(p.real), toY(p.imag), 3.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (selected && kind === 'poles') {
        ctx.strokeStyle = theme.sel;
        ctx.lineWidth = 1.8;
        for (const p of selected.polesClosed) {
          ctx.beginPath();
          ctx.arc(toX(p.real), toY(p.imag), 3.5, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      return;
    }

    if (kind === 'bode-mag' || kind === 'bode-phase') {
      const nom = nominal?.freq ?? [];
      const band = kind === 'bode-mag' ? campaign?.bodeMag : campaign?.bodePhase;
      const ys: number[] = [];
      if (band) ys.push(...band.p05, ...band.p95, ...band.p50);
      for (const p of nom) ys.push(kind === 'bode-mag' ? p.magDb : p.phaseDeg);
      for (const t of ensembleFreq ?? []) for (const p of t.freq) ys.push(kind === 'bode-mag' ? p.magDb : p.phaseDeg);
      const yRawMin = Math.min(...ys.filter(Number.isFinite));
      const yRawMax = Math.max(...ys.filter(Number.isFinite));
      if (!Number.isFinite(yRawMin) || !Number.isFinite(yRawMax)) return;
      const yWin = niceBounds(yRawMin, yRawMax, {
        padFrac: 0.12,
        minSpan: kind === 'bode-mag' ? 10 : 30,
        anchors: [0],
        targetTicks: 5,
      });
      const autoXMin = band?.x[0] ?? Math.log10(nom[0]?.w ?? 1e-3);
      const autoXMax = band?.x[(band?.x.length ?? 1) - 1] ?? Math.log10(nom[nom.length - 1]?.w ?? 1e3);
      const { xMin, xMax, yMin, yMax } = publishAuto({
        xMin: autoXMin,
        xMax: autoXMax,
        yMin: yWin.min,
        yMax: yWin.max,
      });
      const toX = (lx: number) => pad.l + ((lx - xMin) / (xMax - xMin || 1)) * (plotW - pad.l - pad.r);
      const toY = (y: number) => pad.t + ((yMax - y) / (yMax - yMin || 1)) * (plotH - pad.t - pad.b);
      if (band) {
        drawBand(ctx, band, toX, toY, 'p05', 'p95', theme.band);
        drawBand(ctx, band, toX, toY, 'p25', 'p75', theme.bandInner);
        strokeSeries(
          ctx,
          band.x.map((x, i) => ({ x: toX(x), y: toY(band.p50[i]) })),
          theme.mc,
          1.2,
          0.9,
          [3, 2]
        );
      }

      const glCanvas = glRef.current;
      const pack = campaign?.linePack;
      const wantAll = showAllLines && pack && pack.kind === 'bode-mag' && kind === 'bode-mag' && pack.runs.length > 200;
      if (wantAll && glCanvas) {
        glCanvas.width = canvas.width;
        glCanvas.height = canvas.height;
        glCanvas.style.width = `${plotW}px`;
        glCanvas.style.height = `${plotH}px`;
        drawWebGlLines(glCanvas, pack.xy, toX, toY, [0.6, 0.64, 0.7, 0.12]);
      } else {
        if (glCanvas) {
          const g = glCanvas.getContext('webgl2');
          g?.clear(g.COLOR_BUFFER_BIT);
        }
        const alpha = (ensembleFreq?.length ?? 0) > 80 ? 0.12 : 0.35;
        for (const t of ensembleFreq ?? []) {
          strokeSeries(
            ctx,
            t.freq.map((p) => ({
              x: toX(Math.log10(Math.max(1e-12, p.w))),
              y: toY(kind === 'bode-mag' ? p.magDb : p.phaseDeg),
            })),
            theme.mc,
            1,
            alpha
          );
        }
      }

      if (nom.length) {
        strokeSeries(
          ctx,
          nom.map((p) => ({
            x: toX(Math.log10(Math.max(1e-12, p.w))),
            y: toY(kind === 'bode-mag' ? p.magDb : p.phaseDeg),
          })),
          theme.nom,
          2,
          1,
          kind === 'bode-phase' ? [4, 2] : undefined
        );
      }
      if (selected?.freq?.length) {
        strokeSeries(
          ctx,
          selected.freq.map((p) => ({
            x: toX(Math.log10(Math.max(1e-12, p.w))),
            y: toY(kind === 'bode-mag' ? p.magDb : p.phaseDeg),
          })),
          theme.sel,
          1.8
        );
      }
      drawLinearAxes(ctx, {
        w: plotW,
        h: plotH,
        pad,
        xMin,
        xMax,
        yMin,
        yMax,
        toX,
        toY,
        xTicks: logDecadeTicks(xMin, xMax),
        yTicks: niceTicks(yMin, yMax, 5),
        xFormat: (v) => formatTick(v, 'log10'),
        yFormat: (v) => (kind === 'bode-phase' ? formatTick(v, 'deg') : formatTick(v)),
        xUnit: 'ω (rad/s)',
        yUnit: kind === 'bode-mag' ? '|L| (dB)' : '∠L (°)',
        color: theme.axis,
        labelColor: theme.label,
      });
      return;
    }

    if (kind === 'nyquist') {
      const nom = nominal?.freq ?? [];
      // Focus near the critical point; ignore huge low-frequency |L| outliers.
      const near = [
        ...nom.filter((p) => p.magDb <= 20),
        ...(ensembleFreq ?? []).flatMap((t) => t.freq.filter((p) => p.magDb <= 20)),
      ];
      const focusVals = (near.length >= 8 ? near : [...nom, ...(ensembleFreq ?? []).flatMap((t) => t.freq)]).flatMap(
        (p) => [p.re, p.im]
      );
      const lim = symmetricLimit(focusVals, { floor: 2, ceil: 12, padFrac: 0.1, percentile: 0.9, include: [1] });
      const { xMin, xMax, yMin, yMax } = publishAuto({ xMin: -lim, xMax: lim, yMin: -lim, yMax: lim });
      const toX = (re: number) => pad.l + ((re - xMin) / (xMax - xMin || 1)) * (plotW - pad.l - pad.r);
      const toY = (im: number) => plotH - pad.b - ((im - yMin) / (yMax - yMin || 1)) * (plotH - pad.t - pad.b);
      const alpha = (ensembleFreq?.length ?? 0) > 80 ? 0.1 : 0.35;
      const padX = 0.02 * (xMax - xMin);
      const padY = 0.02 * (yMax - yMin);
      const clipSeries = (series: { re: number; im: number }[]) =>
        series
          .filter((p) => p.re >= xMin - padX && p.re <= xMax + padX && p.im >= yMin - padY && p.im <= yMax + padY)
          .map((p) => ({ x: toX(p.re), y: toY(p.im) }));
      for (const t of ensembleFreq ?? []) {
        strokeSeries(ctx, clipSeries(t.freq), theme.mc, 1, alpha);
      }
      if (nom.length) strokeSeries(ctx, clipSeries(nom), theme.nom, 2.1);
      if (selected?.freq?.length) strokeSeries(ctx, clipSeries(selected.freq), theme.sel, 1.8);
      ctx.strokeStyle = 'rgba(196,92,38,0.55)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(toX(-1), toY(0), 6, 0, Math.PI * 2);
      ctx.stroke();
      drawLinearAxes(ctx, {
        w: plotW,
        h: plotH,
        pad,
        xMin,
        xMax,
        yMin,
        yMax,
        toX,
        toY,
        xTicks: niceTicks(xMin, xMax, 5),
        yTicks: niceTicks(yMin, yMax, 5),
        xUnit: 'Re(L)',
        yUnit: 'Im(L)',
        color: theme.axis,
        labelColor: theme.label,
        crosshair: { x: 0, y: 0 },
      });
      return;
    }

    if (kind === 'nichols') {
      const nom = nominal?.freq ?? [];
      const all = [...nom, ...(ensembleFreq ?? []).flatMap((t) => t.freq)];
      if (all.length < 2) return;
      // Nichols: wrap into [−180°, 180°] and frame around the critical point (−180°, 0 dB).
      const wrapped = all.map((p) => ({ phaseDeg: wrapNicholsPhase(p.phaseDeg), magDb: p.magDb }));
      const critPh = -180;
      const critMag = 0;
      const phWin = niceBounds(
        Math.min(critPh, ...wrapped.map((p) => p.phaseDeg)),
        Math.max(critPh, ...wrapped.map((p) => p.phaseDeg)),
        {
          padFrac: 0.12,
          minSpan: 120,
          anchors: [-180, 0, 180],
          clamp: { min: -180, max: 180 },
          targetTicks: 5,
        }
      );
      const magWin = niceBounds(
        Math.min(critMag, ...wrapped.map((p) => p.magDb)),
        Math.max(critMag, ...wrapped.map((p) => p.magDb)),
        { padFrac: 0.15, minSpan: 24, anchors: [0], targetTicks: 5 }
      );
      const { xMin: phMin, xMax: phMax, yMin: magMin, yMax: magMax } = publishAuto({
        xMin: phWin.min,
        xMax: phWin.max,
        yMin: magWin.min,
        yMax: magWin.max,
      });
      const toX = (ph: number) => pad.l + ((ph - phMin) / (phMax - phMin || 1)) * (plotW - pad.l - pad.r);
      const toY = (db: number) => pad.t + ((magMax - db) / (magMax - magMin || 1)) * (plotH - pad.t - pad.b);
      const alpha = (ensembleFreq?.length ?? 0) > 80 ? 0.1 : 0.35;
      const strokeWrapped = (
        series: { phaseDeg: number; magDb: number }[],
        color: string,
        width: number,
        a = 1
      ) => {
        for (const seg of nicholsPhaseSeries(series)) {
          strokeSeries(
            ctx,
            seg.map((p) => ({ x: toX(p.phaseDeg), y: toY(p.magDb) })),
            color,
            width,
            a
          );
        }
      };
      for (const t of ensembleFreq ?? []) strokeWrapped(t.freq, theme.mc, 1, alpha);
      if (nom.length) strokeWrapped(nom, theme.nom, 2.1);
      if (selected?.freq?.length) strokeWrapped(selected.freq, theme.sel, 1.8);
      drawLinearAxes(ctx, {
        w: plotW,
        h: plotH,
        pad,
        xMin: phMin,
        xMax: phMax,
        yMin: magMin,
        yMax: magMax,
        toX,
        toY,
        xTicks: niceTicks(phMin, phMax, 5),
        yTicks: niceTicks(magMin, magMax, 5),
        xFormat: (v) => formatTick(v, 'deg'),
        yFormat: (v) => formatTick(v),
        xUnit: '∠L (°)',
        yUnit: '|L| (dB)',
        color: theme.axis,
        labelColor: theme.label,
        crosshair: { x: critPh, y: critMag },
      });
      // Mark 0 dB / −180° crossings that define PM (ω_gc) and GM (ω_pc).
      const margins = (selected?.margins ?? nominal?.margins) ?? null;
      const mark = (ph: number, db: number, color: string) => {
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(toX(ph), toY(db), 4, 0, Math.PI * 2);
        ctx.stroke();
      };
      if (margins?.phaseMarginDeg != null) {
        mark(wrapNicholsPhase(margins.phaseMarginDeg - 180), 0, theme.nom);
      }
      if (margins?.phaseMarginHighDeg != null) {
        mark(wrapNicholsPhase(margins.phaseMarginHighDeg - 180), 0, theme.sel);
      }
      if (margins?.gainMarginDb != null) {
        mark(critPh, -margins.gainMarginDb, theme.nom);
      }
    }
  }, [kind, plotW, plotH, nominal, selected, ensembleFreq, campaign, showAllLines, axisBounds]);

  const interactive = expandable && !!onOpen;
  const stack = (
    <div className="ensemble-chart-stack" style={{ position: 'relative', width: '100%', maxWidth: plotW, height: plotH }}>
      <canvas ref={canvasRef} width={plotW} height={plotH} role="img" aria-label={title} />
      <canvas
        ref={glRef}
        width={plotW}
        height={plotH}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        aria-hidden
      />
    </div>
  );

  return (
    <div
      ref={wrapRef}
      className={`pole-map stability-plot${compact ? ' compact' : ''}${interactive ? ' expandable' : ''}`}
    >
      <div className="stability-plot-head">
        <h3>{title}</h3>
        {interactive ? (
          <button type="button" className="plot-expand" onClick={onOpen} aria-label={`Open ${title} detail`}>
            Open
          </button>
        ) : null}
      </div>
      {interactive ? (
        <button type="button" className="ensemble-chart-hit" onClick={onOpen} aria-label={`Expand ${title}`}>
          {stack}
        </button>
      ) : (
        stack
      )}
      {hint ? <p className={`hint${compact ? ' plot-hint' : ''}`}>{hint}</p> : null}
    </div>
  );
}
