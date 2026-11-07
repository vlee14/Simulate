import React from 'react';
import { FreqPoint, RootLocusBranch, StabilityReport } from '../engine/stability';
import { AnalysisOption } from '../engine/types';

const MC_STROKE = '#9aa3b2';
const NOMINAL_STROKE = '#111827';
const SELECTED_STROKE = '#c45c26';
const PLOT_BG = '#f4f6f8';
const AXIS = '#c5cbd3';

export interface McPlotTrace {
  run: number;
  report: StabilityReport;
}

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
        <rect x="0" y="0" width={width} height={height} fill={PLOT_BG} rx="8" />
        {children}
      </svg>
      {hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

function legendHint(hasMc: boolean): string {
  return hasMc ? 'grey = MC · black = nominal · amber = selected' : 'black = nominal';
}

export function PoleMap({
  nominal,
  ensemble = [],
  selectedRun = 0,
}: {
  nominal: StabilityReport;
  ensemble?: McPlotTrace[];
  selectedRun?: number;
}) {
  const selected = ensemble.find((t) => t.run === selectedRun)?.report;
  const pts = [
    ...nominal.polesOpen,
    ...nominal.polesClosed,
    ...ensemble.flatMap((t) => t.report.polesClosed),
    ...(selected?.polesClosed ?? []),
  ];
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
    <ChartFrame title="Pole map" hint={legendHint(ensemble.length > 0)} width={W} height={H}>
      <line x1={toX(0)} y1={pad} x2={toX(0)} y2={H - pad} stroke={AXIS} />
      <line x1={pad} y1={toY(0)} x2={W - pad} y2={toY(0)} stroke={AXIS} />
      <text x={W - pad} y={toY(0) - 4} fill="#6b7785" fontSize="9" textAnchor="end">
        Re
      </text>
      <text x={toX(0) + 4} y={pad + 8} fill="#6b7785" fontSize="9">
        Im
      </text>
      {ensemble.map((t) =>
        t.report.polesClosed.map((p, i) => (
          <circle key={`mc${t.run}-${i}`} cx={toX(p.real)} cy={toY(p.imag)} r="2.2" fill={MC_STROKE} fillOpacity="0.45" />
        ))
      )}
      {nominal.polesOpen.map((p, i) => (
        <circle key={`o${i}`} cx={toX(p.real)} cy={toY(p.imag)} r="4" fill="none" stroke={NOMINAL_STROKE} strokeWidth="1.6" />
      ))}
      {nominal.polesClosed.map((p, i) => (
        <circle key={`c${i}`} cx={toX(p.real)} cy={toY(p.imag)} r="3.2" fill={NOMINAL_STROKE} />
      ))}
      {selectedRun > 0 && selected
        ? selected.polesClosed.map((p, i) => (
            <circle key={`s${i}`} cx={toX(p.real)} cy={toY(p.imag)} r="3.5" fill="none" stroke={SELECTED_STROKE} strokeWidth="1.8" />
          ))
        : null}
    </ChartFrame>
  );
}

export function BodePlot({
  nominal,
  ensemble = [],
  selectedRun = 0,
}: {
  nominal: StabilityReport;
  ensemble?: McPlotTrace[];
  selectedRun?: number;
}) {
  const freq = nominal.freq;
  if (freq.length < 2) return <p className="hint">Bode needs a nonzero feedback gain.</p>;
  const selected = ensemble.find((t) => t.run === selectedRun)?.report;
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

  const allMag = [freq, ...ensemble.map((t) => t.report.freq)].flatMap((series) => series.map((p) => p.magDb));
  const allPh = [freq, ...ensemble.map((t) => t.report.freq)].flatMap((series) => series.map((p) => p.phaseDeg));
  let magMin = Math.min(...allMag);
  let magMax = Math.max(...allMag);
  if (magMax - magMin < 8) {
    const midM = 0.5 * (magMax + magMin);
    magMin = midM - 4;
    magMax = midM + 4;
  }
  const toYMag = (db: number) => padT + ((magMax - db) / (magMax - magMin || 1)) * (mid - padT - 8);
  let phMin = Math.min(...allPh, -180);
  let phMax = Math.max(...allPh, 0);
  if (phMax - phMin < 40) {
    const midP = 0.5 * (phMax + phMin);
    phMin = midP - 20;
    phMax = midP + 20;
  }
  const toYPh = (deg: number) => mid + 8 + ((phMax - deg) / (phMax - phMin || 1)) * (H - padB - mid - 8);
  const seriesPath = (series: FreqPoint[], yOf: (p: FreqPoint) => number) =>
    pathFrom(series.map((p) => ({ x: toX(p.w), y: yOf(p) })));

  return (
    <ChartFrame title="Bode" hint={legendHint(ensemble.length > 0)} width={W} height={H}>
      <line x1={padL} y1={toYMag(0)} x2={W - padR} y2={toYMag(0)} stroke={AXIS} strokeDasharray="3 3" />
      <line x1={padL} y1={toYPh(-180)} x2={W - padR} y2={toYPh(-180)} stroke={AXIS} strokeDasharray="3 3" />
      <line x1={padL} y1={mid} x2={W - padR} y2={mid} stroke="#dfe3e8" />
      {ensemble.map((t) => (
        <g key={`mc-bode-${t.run}`} opacity="0.45">
          <path d={seriesPath(t.report.freq, (p) => toYMag(p.magDb))} fill="none" stroke={MC_STROKE} strokeWidth="1" />
          <path d={seriesPath(t.report.freq, (p) => toYPh(p.phaseDeg))} fill="none" stroke={MC_STROKE} strokeWidth="1" />
        </g>
      ))}
      <path d={seriesPath(freq, (p) => toYMag(p.magDb))} fill="none" stroke={NOMINAL_STROKE} strokeWidth="2" />
      <path d={seriesPath(freq, (p) => toYPh(p.phaseDeg))} fill="none" stroke={NOMINAL_STROKE} strokeWidth="2" strokeDasharray="4 2" />
      {selectedRun > 0 && selected?.freq.length ? (
        <g>
          <path d={seriesPath(selected.freq, (p) => toYMag(p.magDb))} fill="none" stroke={SELECTED_STROKE} strokeWidth="1.8" />
          <path d={seriesPath(selected.freq, (p) => toYPh(p.phaseDeg))} fill="none" stroke={SELECTED_STROKE} strokeWidth="1.8" strokeDasharray="4 2" />
        </g>
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

export function NyquistPlot({
  nominal,
  ensemble = [],
  selectedRun = 0,
}: {
  nominal: StabilityReport;
  ensemble?: McPlotTrace[];
  selectedRun?: number;
}) {
  const freq = nominal.freq;
  if (freq.length < 2) return <p className="hint">Nyquist needs a nonzero feedback gain.</p>;
  const selected = ensemble.find((t) => t.run === selectedRun)?.report;
  const W = 240;
  const H = 180;
  const pad = 18;
  const vals = [...freq, ...ensemble.flatMap((t) => t.report.freq)].flatMap((p) => [p.re, p.im]);
  let lim = Math.max(1, ...vals.map((v) => Math.abs(v))) * 1.15;
  lim = Math.min(lim, 20);
  const toX = (re: number) => pad + ((re + lim) / (2 * lim)) * (W - 2 * pad);
  const toY = (im: number) => H - pad - ((im + lim) / (2 * lim)) * (H - 2 * pad);
  const clip = (series: FreqPoint[]) => series.filter((p) => Math.abs(p.re) <= lim * 1.05 && Math.abs(p.im) <= lim * 1.05);
  const line = (series: FreqPoint[]) => pathFrom(clip(series).map((p) => ({ x: toX(p.re), y: toY(p.im) })));
  return (
    <ChartFrame title="Nyquist" hint={legendHint(ensemble.length > 0)} width={W} height={H}>
      <line x1={toX(0)} y1={pad} x2={toX(0)} y2={H - pad} stroke={AXIS} />
      <line x1={pad} y1={toY(0)} x2={W - pad} y2={toY(0)} stroke={AXIS} />
      <circle cx={toX(-1)} cy={toY(0)} r="8" fill="none" stroke="#c45c26" strokeOpacity="0.4" />
      {ensemble.map((t) => (
        <path key={`mc-nyq-${t.run}`} d={line(t.report.freq)} fill="none" stroke={MC_STROKE} strokeWidth="1" opacity="0.4" />
      ))}
      <path d={line(freq)} fill="none" stroke={NOMINAL_STROKE} strokeWidth="2.1" />
      {selectedRun > 0 && selected?.freq.length ? (
        <path d={line(selected.freq)} fill="none" stroke={SELECTED_STROKE} strokeWidth="1.8" />
      ) : null}
      <g stroke="#c45c26" strokeWidth="1.6">
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

export function NicholsPlot({
  nominal,
  ensemble = [],
  selectedRun = 0,
}: {
  nominal: StabilityReport;
  ensemble?: McPlotTrace[];
  selectedRun?: number;
}) {
  const freq = nominal.freq;
  if (freq.length < 2) return <p className="hint">Nichols needs a nonzero feedback gain.</p>;
  const selected = ensemble.find((t) => t.run === selectedRun)?.report;
  const W = 240;
  const H = 170;
  const padL = 28;
  const padR = 10;
  const padT = 14;
  const padB = 22;
  const all = [...freq, ...ensemble.flatMap((t) => t.report.freq)];
  let phMin = Math.min(...all.map((p) => p.phaseDeg), -270);
  let phMax = Math.max(...all.map((p) => p.phaseDeg), 0);
  let magMin = Math.min(...all.map((p) => p.magDb), -40);
  let magMax = Math.max(...all.map((p) => p.magDb), 20);
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
  const line = (series: FreqPoint[]) => pathFrom(series.map((p) => ({ x: toX(p.phaseDeg), y: toY(p.magDb) })));
  return (
    <ChartFrame title="Nichols" hint={legendHint(ensemble.length > 0)} width={W} height={H}>
      <line x1={toX(-180)} y1={padT} x2={toX(-180)} y2={H - padB} stroke={AXIS} strokeDasharray="3 3" />
      <line x1={padL} y1={toY(0)} x2={W - padR} y2={toY(0)} stroke={AXIS} strokeDasharray="3 3" />
      {ensemble.map((t) => (
        <path key={`mc-nic-${t.run}`} d={line(t.report.freq)} fill="none" stroke={MC_STROKE} strokeWidth="1" opacity="0.4" />
      ))}
      <path d={line(freq)} fill="none" stroke={NOMINAL_STROKE} strokeWidth="2.1" />
      {selectedRun > 0 && selected?.freq.length ? (
        <path d={line(selected.freq)} fill="none" stroke={SELECTED_STROKE} strokeWidth="1.8" />
      ) : null}
      <g stroke="#c45c26" strokeWidth="1.5">
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
  nominal,
  ensemble = [],
  selectedRun = 0,
}: {
  nominal: StabilityReport;
  ensemble?: McPlotTrace[];
  selectedRun?: number;
}) {
  const selected = ensemble.find((t) => t.run === selectedRun)?.report;
  const pts = [
    ...nominal.polesOpen,
    ...nominal.polesClosed,
    ...nominal.rootLocus.flatMap((b) => b.points),
    ...ensemble.flatMap((t) => t.report.rootLocus.flatMap((b) => b.points)),
  ];
  if (!pts.length) return null;
  const maxR = Math.max(1, ...pts.map((p) => Math.abs(p.real)));
  const maxI = Math.max(1, ...pts.map((p) => Math.abs(p.imag)));
  const lim = Math.max(maxR, maxI) * 1.2;
  const W = 240;
  const H = 170;
  const pad = 18;
  const toX = (re: number) => pad + ((re + lim) / (2 * lim)) * (W - 2 * pad);
  const toY = (im: number) => H - pad - ((im + lim) / (2 * lim)) * (H - 2 * pad);
  const drawBranches = (branches: RootLocusBranch[], stroke: string, width: number, opacity: number) =>
    branches.map((branch, i) => (
      <path
        key={`${stroke}-${i}`}
        d={pathFrom(branch.points.map((p) => ({ x: toX(p.real), y: toY(p.imag) })))}
        fill="none"
        stroke={stroke}
        strokeWidth={width}
        opacity={opacity}
      />
    ));
  return (
    <ChartFrame title="Root locus" hint={legendHint(ensemble.length > 0)} width={W} height={H}>
      <line x1={toX(0)} y1={pad} x2={toX(0)} y2={H - pad} stroke={AXIS} />
      <line x1={pad} y1={toY(0)} x2={W - pad} y2={toY(0)} stroke={AXIS} />
      {ensemble.map((t) => (
        <g key={`mc-rl-${t.run}`}>{drawBranches(t.report.rootLocus, MC_STROKE, 1, 0.28)}</g>
      ))}
      {drawBranches(nominal.rootLocus, NOMINAL_STROKE, 1.8, 1)}
      {selectedRun > 0 && selected ? drawBranches(selected.rootLocus, SELECTED_STROKE, 1.6, 0.95) : null}
      {nominal.polesOpen.map((p, i) => (
        <circle key={`o${i}`} cx={toX(p.real)} cy={toY(p.imag)} r="4" fill="none" stroke={NOMINAL_STROKE} strokeWidth="1.5" />
      ))}
      {nominal.polesClosed.map((p, i) => (
        <circle key={`c${i}`} cx={toX(p.real)} cy={toY(p.imag)} r="3.2" fill={NOMINAL_STROKE} />
      ))}
    </ChartFrame>
  );
}

export function StabilityPlotGrid({
  report,
  nominal,
  ensemble = [],
  selectedRun = 0,
  show,
}: {
  report: StabilityReport;
  nominal?: StabilityReport | null;
  ensemble?: McPlotTrace[];
  selectedRun?: number;
  show: (option: AnalysisOption) => boolean;
}) {
  const base = nominal ?? report;
  return (
    <div className="stability-plot-grid">
      {show('polemap') ? <PoleMap nominal={base} ensemble={ensemble} selectedRun={selectedRun} /> : null}
      {show('bode') ? <BodePlot nominal={base} ensemble={ensemble} selectedRun={selectedRun} /> : null}
      {show('nyquist') ? <NyquistPlot nominal={base} ensemble={ensemble} selectedRun={selectedRun} /> : null}
      {show('nichols') ? <NicholsPlot nominal={base} ensemble={ensemble} selectedRun={selectedRun} /> : null}
      {show('rlocus') ? <RootLocusPlot nominal={base} ensemble={ensemble} selectedRun={selectedRun} /> : null}
    </div>
  );
}
