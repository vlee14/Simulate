import React from 'react';
import { FreqPoint, RootLocusBranch, StabilityReport } from '../engine/stability';
import { AnalysisOption } from '../engine/types';

const COLORS = ['#5ec8ff', '#e7a23a', '#7ddea0', '#ff6b8a', '#d2a8ff', '#ffb085'];

function pathFrom(points: { x: number; y: number }[]): string {
  if (!points.length) return '';
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
}

function ChartFrame({
  title,
  hint,
  width = 240,
  height = 160,
  children,
}: {
  title: string;
  hint?: string;
  width?: number;
  height?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="pole-map stability-plot">
      <h3>{title}</h3>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label={title}>
        <rect x="0" y="0" width={width} height={height} fill="#0c1016" rx="8" />
        {children}
      </svg>
      {hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

export function PoleMap({ open, closed }: { open: { real: number; imag: number }[]; closed: { real: number; imag: number }[] }) {
  const pts = [...open, ...closed];
  if (!pts.length) return null;
  const maxR = Math.max(1, ...pts.map((p) => Math.abs(p.real)));
  const maxI = Math.max(1, ...pts.map((p) => Math.abs(p.imag)));
  const lim = Math.max(maxR, maxI) * 1.15;
  const W = 240;
  const H = 160;
  const pad = 18;
  const toX = (re: number) => pad + ((re + lim) / (2 * lim)) * (W - 2 * pad);
  const toY = (im: number) => H - pad - ((im + lim) / (2 * lim)) * (H - 2 * pad);
  return (
    <ChartFrame title="Pole map" hint="○ open · ● closed · left half-plane is stable" width={W} height={H}>
      <line x1={toX(0)} y1={pad} x2={toX(0)} y2={H - pad} stroke="#243041" />
      <line x1={pad} y1={toY(0)} x2={W - pad} y2={toY(0)} stroke="#243041" />
      <text x={W - pad} y={toY(0) - 4} fill="#6b7785" fontSize="9" textAnchor="end">
        Re
      </text>
      <text x={toX(0) + 4} y={pad + 8} fill="#6b7785" fontSize="9">
        Im
      </text>
      {open.map((p, i) => (
        <circle key={`o${i}`} cx={toX(p.real)} cy={toY(p.imag)} r="4" fill="none" stroke="#ff6b8a" strokeWidth="1.5" />
      ))}
      {closed.map((p, i) => (
        <circle key={`c${i}`} cx={toX(p.real)} cy={toY(p.imag)} r="3.5" fill="#7ddea0" />
      ))}
    </ChartFrame>
  );
}

export function BodePlot({ freq, margins }: { freq: FreqPoint[]; margins: StabilityReport['margins'] }) {
  if (freq.length < 2) return <p className="hint">Bode needs a nonzero feedback gain.</p>;
  const W = 240;
  const H = 210;
  const padL = 34;
  const padR = 10;
  const padT = 14;
  const mid = 108;
  const padB = 22;
  const logW = (w: number) => Math.log10(Math.max(1e-3, w));
  const x0 = logW(freq[0].w);
  const x1 = logW(freq[freq.length - 1].w);
  const toX = (w: number) => padL + ((logW(w) - x0) / (x1 - x0 || 1)) * (W - padL - padR);

  const mags = freq.map((p) => p.magDb);
  let magMin = Math.min(...mags);
  let magMax = Math.max(...mags);
  if (magMax - magMin < 8) {
    const midM = 0.5 * (magMax + magMin);
    magMin = midM - 4;
    magMax = midM + 4;
  }
  const toYMag = (db: number) => padT + ((magMax - db) / (magMax - magMin || 1)) * (mid - padT - 8);

  const phases = freq.map((p) => p.phaseDeg);
  let phMin = Math.min(...phases, -180);
  let phMax = Math.max(...phases, 0);
  if (phMax - phMin < 40) {
    const midP = 0.5 * (phMax + phMin);
    phMin = midP - 20;
    phMax = midP + 20;
  }
  const toYPh = (deg: number) => mid + 8 + ((phMax - deg) / (phMax - phMin || 1)) * (H - padB - mid - 8);

  const magPath = pathFrom(freq.map((p) => ({ x: toX(p.w), y: toYMag(p.magDb) })));
  const phPath = pathFrom(freq.map((p) => ({ x: toX(p.w), y: toYPh(p.phaseDeg) })));

  return (
    <ChartFrame title="Bode" hint="Top |L| dB · bottom ∠L · dashed = 0 dB / −180°" width={W} height={H}>
      <line x1={padL} y1={toYMag(0)} x2={W - padR} y2={toYMag(0)} stroke="#243041" strokeDasharray="3 3" />
      <line x1={padL} y1={toYPh(-180)} x2={W - padR} y2={toYPh(-180)} stroke="#243041" strokeDasharray="3 3" />
      <line x1={padL} y1={mid} x2={W - padR} y2={mid} stroke="#1a222d" />
      <path d={magPath} fill="none" stroke="#5ec8ff" strokeWidth="1.6" />
      <path d={phPath} fill="none" stroke="#e7a23a" strokeWidth="1.6" />
      {margins?.gainCrossoverRad != null ? (
        <line
          x1={toX(margins.gainCrossoverRad)}
          y1={padT}
          x2={toX(margins.gainCrossoverRad)}
          y2={H - padB}
          stroke="#7ddea0"
          strokeDasharray="2 3"
        />
      ) : null}
      <text x={4} y={padT + 8} fill="#6b7785" fontSize="9">
        dB
      </text>
      <text x={4} y={mid + 16} fill="#6b7785" fontSize="9">
        deg
      </text>
      <text x={W - padR} y={H - 6} fill="#6b7785" fontSize="9" textAnchor="end">
        ω
      </text>
    </ChartFrame>
  );
}

export function NyquistPlot({ freq }: { freq: FreqPoint[] }) {
  if (freq.length < 2) return <p className="hint">Nyquist needs a nonzero feedback gain.</p>;
  const W = 240;
  const H = 180;
  const pad = 18;
  const vals = freq.flatMap((p) => [p.re, p.im, -p.im]);
  let lim = Math.max(1, ...vals.map((v) => Math.abs(v))) * 1.15;
  lim = Math.min(lim, 20);
  const toX = (re: number) => pad + ((re + lim) / (2 * lim)) * (W - 2 * pad);
  const toY = (im: number) => H - pad - ((im + lim) / (2 * lim)) * (H - 2 * pad);
  const clipped = freq.filter((p) => Math.abs(p.re) <= lim * 1.05 && Math.abs(p.im) <= lim * 1.05);
  const pos = pathFrom(clipped.map((p) => ({ x: toX(p.re), y: toY(p.im) })));
  const neg = pathFrom(clipped.map((p) => ({ x: toX(p.re), y: toY(-p.im) })));
  return (
    <ChartFrame title="Nyquist" hint="Solid ω≥0 · dashed mirror · × critical −1" width={W} height={H}>
      <line x1={toX(0)} y1={pad} x2={toX(0)} y2={H - pad} stroke="#243041" />
      <line x1={pad} y1={toY(0)} x2={W - pad} y2={toY(0)} stroke="#243041" />
      <circle cx={toX(-1)} cy={toY(0)} r="8" fill="none" stroke="#ff6b8a" strokeOpacity="0.35" />
      <path d={neg} fill="none" stroke="#5ec8ff" strokeOpacity="0.35" strokeWidth="1.2" strokeDasharray="3 3" />
      <path d={pos} fill="none" stroke="#5ec8ff" strokeWidth="1.6" />
      <g stroke="#ff6b8a" strokeWidth="1.6">
        <line x1={toX(-1) - 4} y1={toY(0) - 4} x2={toX(-1) + 4} y2={toY(0) + 4} />
        <line x1={toX(-1) - 4} y1={toY(0) + 4} x2={toX(-1) + 4} y2={toY(0) - 4} />
      </g>
      <text x={W - pad} y={toY(0) - 4} fill="#6b7785" fontSize="9" textAnchor="end">
        Re
      </text>
      <text x={toX(0) + 4} y={pad + 8} fill="#6b7785" fontSize="9">
        Im
      </text>
    </ChartFrame>
  );
}

export function NicholsPlot({ freq }: { freq: FreqPoint[] }) {
  if (freq.length < 2) return <p className="hint">Nichols needs a nonzero feedback gain.</p>;
  const W = 240;
  const H = 170;
  const padL = 28;
  const padR = 10;
  const padT = 14;
  const padB = 22;
  let phMin = Math.min(...freq.map((p) => p.phaseDeg), -270);
  let phMax = Math.max(...freq.map((p) => p.phaseDeg), 0);
  let magMin = Math.min(...freq.map((p) => p.magDb), -40);
  let magMax = Math.max(...freq.map((p) => p.magDb), 20);
  if (phMax - phMin < 40) {
    const mid = 0.5 * (phMax + phMin);
    phMin = mid - 20;
    phMax = mid + 20;
  }
  if (magMax - magMin < 10) {
    const mid = 0.5 * (magMax + magMin);
    magMin = mid - 5;
    magMax = mid + 5;
  }
  const toX = (ph: number) => padL + ((ph - phMin) / (phMax - phMin || 1)) * (W - padL - padR);
  const toY = (db: number) => padT + ((magMax - db) / (magMax - magMin || 1)) * (H - padT - padB);
  const d = pathFrom(freq.map((p) => ({ x: toX(p.phaseDeg), y: toY(p.magDb) })));
  return (
    <ChartFrame title="Nichols" hint="|L| dB vs phase · cross = 0 dB / −180°" width={W} height={H}>
      <line x1={toX(-180)} y1={padT} x2={toX(-180)} y2={H - padB} stroke="#243041" strokeDasharray="3 3" />
      <line x1={padL} y1={toY(0)} x2={W - padR} y2={toY(0)} stroke="#243041" strokeDasharray="3 3" />
      <path d={d} fill="none" stroke="#d2a8ff" strokeWidth="1.6" />
      <g stroke="#ff6b8a" strokeWidth="1.5">
        <line x1={toX(-180) - 4} y1={toY(0) - 4} x2={toX(-180) + 4} y2={toY(0) + 4} />
        <line x1={toX(-180) - 4} y1={toY(0) + 4} x2={toX(-180) + 4} y2={toY(0) - 4} />
      </g>
      <text x={W - padR} y={H - 6} fill="#6b7785" fontSize="9" textAnchor="end">
        phase
      </text>
      <text x={4} y={padT + 8} fill="#6b7785" fontSize="9">
        dB
      </text>
    </ChartFrame>
  );
}

export function RootLocusPlot({
  branches,
  open,
  closed,
}: {
  branches: RootLocusBranch[];
  open: { real: number; imag: number }[];
  closed: { real: number; imag: number }[];
}) {
  const pts = [...open, ...closed, ...branches.flatMap((b) => b.points)];
  if (!pts.length) return null;
  const maxR = Math.max(1, ...pts.map((p) => Math.abs(p.real)));
  const maxI = Math.max(1, ...pts.map((p) => Math.abs(p.imag)));
  const lim = Math.max(maxR, maxI) * 1.2;
  const W = 240;
  const H = 170;
  const pad = 18;
  const toX = (re: number) => pad + ((re + lim) / (2 * lim)) * (W - 2 * pad);
  const toY = (im: number) => H - pad - ((im + lim) / (2 * lim)) * (H - 2 * pad);
  return (
    <ChartFrame title="Root locus" hint="ρ: 0 → 3 · ○ open · ● closed (ρ=1)" width={W} height={H}>
      <line x1={toX(0)} y1={pad} x2={toX(0)} y2={H - pad} stroke="#243041" />
      <line x1={pad} y1={toY(0)} x2={W - pad} y2={toY(0)} stroke="#243041" />
      {branches.map((branch, i) => (
        <path
          key={`b${i}`}
          d={pathFrom(branch.points.map((p) => ({ x: toX(p.real), y: toY(p.imag) })))}
          fill="none"
          stroke={COLORS[i % COLORS.length]}
          strokeWidth="1.4"
          strokeOpacity="0.9"
        />
      ))}
      {open.map((p, i) => (
        <circle key={`o${i}`} cx={toX(p.real)} cy={toY(p.imag)} r="4" fill="none" stroke="#ff6b8a" strokeWidth="1.5" />
      ))}
      {closed.map((p, i) => (
        <circle key={`c${i}`} cx={toX(p.real)} cy={toY(p.imag)} r="3.5" fill="#7ddea0" />
      ))}
    </ChartFrame>
  );
}

export function StabilityPlotGrid({
  report,
  show,
}: {
  report: StabilityReport;
  show: (option: AnalysisOption) => boolean;
}) {
  return (
    <div className="stability-plot-grid">
      {show('polemap') ? <PoleMap open={report.polesOpen} closed={report.polesClosed} /> : null}
      {show('bode') ? <BodePlot freq={report.freq} margins={report.margins} /> : null}
      {show('nyquist') ? <NyquistPlot freq={report.freq} /> : null}
      {show('nichols') ? <NicholsPlot freq={report.freq} /> : null}
      {show('rlocus') ? <RootLocusPlot branches={report.rootLocus} open={report.polesOpen} closed={report.polesClosed} /> : null}
    </div>
  );
}
