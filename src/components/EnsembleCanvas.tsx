import React, { useEffect, useRef, useState } from 'react';
import { McCampaignStats, PercentileBand } from '../engine/mcStats';
import { FreqPoint, RootLocusBranch, StabilityReport } from '../engine/stability';

export type ChartKind = 'bode-mag' | 'bode-phase' | 'nyquist' | 'nichols' | 'poles' | 'rlocus';

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
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const [autoWidth, setAutoWidth] = useState(width ?? 280);

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

    const padL = kind === 'bode-mag' || kind === 'bode-phase' || kind === 'nichols' ? 34 : 18;
    const padR = 10;
    const padT = 14;
    const padB = 22;

    const drawAxes = (toX: (v: number) => number, toY: (v: number) => number, x0: number, y0: number) => {
      ctx.strokeStyle = theme.axis;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(toX(x0), padT);
      ctx.lineTo(toX(x0), plotH - padB);
      ctx.moveTo(padL, toY(y0));
      ctx.lineTo(plotW - padR, toY(y0));
      ctx.stroke();
    };

    if (kind === 'poles') {
      const pts = [
        ...(nominal?.polesOpen ?? []),
        ...(nominal?.polesClosed ?? []),
        ...(campaign?.poleCloud ?? []),
        ...(selected?.polesClosed ?? []),
      ];
      if (!pts.length) return;
      const lim = Math.max(1, ...pts.map((p) => Math.max(Math.abs(p.real), Math.abs(p.imag)))) * 1.15;
      const toX = (re: number) => padL + ((re + lim) / (2 * lim)) * (plotW - padL - padR);
      const toY = (im: number) => plotH - padB - ((im + lim) / (2 * lim)) * (plotH - padT - padB);
      drawAxes(toX, toY, 0, 0);
      const cloud = campaign?.poleCloud ?? [];
      ctx.fillStyle = theme.mc;
      ctx.globalAlpha = cloud.length > 2000 ? 0.08 : cloud.length > 400 ? 0.15 : 0.35;
      for (const p of cloud) {
        ctx.beginPath();
        ctx.arc(toX(p.real), toY(p.imag), cloud.length > 2000 ? 1.2 : 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
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
      if (selected) {
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
      let yMin = Math.min(...ys.filter(Number.isFinite));
      let yMax = Math.max(...ys.filter(Number.isFinite));
      if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) return;
      if (yMax - yMin < 8) {
        const mid = 0.5 * (yMax + yMin);
        yMin = mid - 4;
        yMax = mid + 4;
      }
      const xMin = band?.x[0] ?? Math.log10(nom[0]?.w ?? 1e-3);
      const xMax = band?.x[(band?.x.length ?? 1) - 1] ?? Math.log10(nom[nom.length - 1]?.w ?? 1e3);
      const toX = (lx: number) => padL + ((lx - xMin) / (xMax - xMin || 1)) * (plotW - padL - padR);
      const toY = (y: number) => padT + ((yMax - y) / (yMax - yMin || 1)) * (plotH - padT - padB);
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
      ctx.fillStyle = theme.label;
      ctx.font = '9px system-ui, sans-serif';
      ctx.fillText(kind === 'bode-mag' ? 'dB' : 'deg', 4, padT + 8);
      ctx.textAlign = 'right';
      ctx.fillText('ω', plotW - padR, plotH - 6);
      return;
    }

    if (kind === 'nyquist') {
      const nom = nominal?.freq ?? [];
      const vals = [
        ...nom.flatMap((p) => [p.re, p.im]),
        ...(ensembleFreq ?? []).flatMap((t) => t.freq.flatMap((p) => [p.re, p.im])),
      ];
      let lim = Math.max(1, ...vals.map((v) => Math.abs(v))) * 1.15;
      lim = Math.min(lim, 20);
      const toX = (re: number) => padL + ((re + lim) / (2 * lim)) * (plotW - padL - padR);
      const toY = (im: number) => plotH - padB - ((im + lim) / (2 * lim)) * (plotH - padT - padB);
      drawAxes(toX, toY, 0, 0);
      ctx.strokeStyle = 'rgba(196,92,38,0.4)';
      ctx.beginPath();
      ctx.arc(toX(-1), toY(0), 8, 0, Math.PI * 2);
      ctx.stroke();
      const alpha = (ensembleFreq?.length ?? 0) > 80 ? 0.1 : 0.35;
      for (const t of ensembleFreq ?? []) {
        strokeSeries(
          ctx,
          t.freq.filter((p) => Math.abs(p.re) <= lim * 1.05 && Math.abs(p.im) <= lim * 1.05).map((p) => ({ x: toX(p.re), y: toY(p.im) })),
          theme.mc,
          1,
          alpha
        );
      }
      if (nom.length) strokeSeries(ctx, nom.map((p) => ({ x: toX(p.re), y: toY(p.im) })), theme.nom, 2.1);
      if (selected?.freq?.length) strokeSeries(ctx, selected.freq.map((p) => ({ x: toX(p.re), y: toY(p.im) })), theme.sel, 1.8);
      return;
    }

    if (kind === 'nichols') {
      const nom = nominal?.freq ?? [];
      const all = [...nom, ...(ensembleFreq ?? []).flatMap((t) => t.freq)];
      if (all.length < 2) return;
      let phMin = Math.min(...all.map((p) => p.phaseDeg), -270);
      let phMax = Math.max(...all.map((p) => p.phaseDeg), 0);
      let magMin = Math.min(...all.map((p) => p.magDb), -40);
      let magMax = Math.max(...all.map((p) => p.magDb), 20);
      const toX = (ph: number) => padL + ((ph - phMin) / (phMax - phMin || 1)) * (plotW - padL - padR);
      const toY = (db: number) => padT + ((magMax - db) / (magMax - magMin || 1)) * (plotH - padT - padB);
      ctx.strokeStyle = theme.axis;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(toX(-180), padT);
      ctx.lineTo(toX(-180), plotH - padB);
      ctx.moveTo(padL, toY(0));
      ctx.lineTo(plotW - padR, toY(0));
      ctx.stroke();
      ctx.setLineDash([]);
      const alpha = (ensembleFreq?.length ?? 0) > 80 ? 0.1 : 0.35;
      for (const t of ensembleFreq ?? []) {
        strokeSeries(ctx, t.freq.map((p) => ({ x: toX(p.phaseDeg), y: toY(p.magDb) })), theme.mc, 1, alpha);
      }
      if (nom.length) strokeSeries(ctx, nom.map((p) => ({ x: toX(p.phaseDeg), y: toY(p.magDb) })), theme.nom, 2.1);
      if (selected?.freq?.length) strokeSeries(ctx, selected.freq.map((p) => ({ x: toX(p.phaseDeg), y: toY(p.magDb) })), theme.sel, 1.8);
      return;
    }

    if (kind === 'rlocus') {
      const branches: RootLocusBranch[] = nominal?.rootLocus ?? [];
      const pts = [
        ...(nominal?.polesOpen ?? []),
        ...(nominal?.polesClosed ?? []),
        ...branches.flatMap((b) => b.points),
      ];
      if (!pts.length) return;
      const lim = Math.max(1, ...pts.map((p) => Math.max(Math.abs(p.real), Math.abs(p.imag)))) * 1.2;
      const toX = (re: number) => padL + ((re + lim) / (2 * lim)) * (plotW - padL - padR);
      const toY = (im: number) => plotH - padB - ((im + lim) / (2 * lim)) * (plotH - padT - padB);
      drawAxes(toX, toY, 0, 0);
      for (const b of branches) {
        strokeSeries(ctx, b.points.map((p) => ({ x: toX(p.real), y: toY(p.imag) })), theme.nom, 1.8);
      }
      if (nominal) {
        ctx.strokeStyle = theme.nom;
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
    }
  }, [kind, plotW, plotH, nominal, selected, ensembleFreq, campaign, showAllLines]);

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
