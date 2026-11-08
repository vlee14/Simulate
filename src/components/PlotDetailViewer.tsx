import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom';
import { McCampaignStats } from '../engine/mcStats';
import { boundsApproxEqual, ChartAxisBounds } from '../engine/plotAxes';
import { StabilityReport } from '../engine/stability';
import { ChartKind, EnsembleChart } from './EnsembleCanvas';

const TITLES: Record<ChartKind, string> = {
  poles: 'Pole map',
  'bode-mag': 'Bode magnitude',
  'bode-phase': 'Bode phase',
  nyquist: 'Nyquist',
  nichols: 'Nichols',
  rlocus: 'Root locus',
};

type BoundKey = keyof ChartAxisBounds;

function boundMeta(kind: ChartKind): Record<BoundKey, { label: string; logX?: boolean }> {
  if (kind === 'bode-mag') {
    return {
      xMin: { label: 'ω min (rad/s)', logX: true },
      xMax: { label: 'ω max (rad/s)', logX: true },
      yMin: { label: '|L| min (dB)' },
      yMax: { label: '|L| max (dB)' },
    };
  }
  if (kind === 'bode-phase') {
    return {
      xMin: { label: 'ω min (rad/s)', logX: true },
      xMax: { label: 'ω max (rad/s)', logX: true },
      yMin: { label: '∠L min (°)' },
      yMax: { label: '∠L max (°)' },
    };
  }
  if (kind === 'nichols') {
    return {
      xMin: { label: '∠L min (°)' },
      xMax: { label: '∠L max (°)' },
      yMin: { label: '|L| min (dB)' },
      yMax: { label: '|L| max (dB)' },
    };
  }
  if (kind === 'nyquist') {
    return {
      xMin: { label: 'Re min' },
      xMax: { label: 'Re max' },
      yMin: { label: 'Im min' },
      yMax: { label: 'Im max' },
    };
  }
  return {
    xMin: { label: 'Re min (1/s)' },
    xMax: { label: 'Re max (1/s)' },
    yMin: { label: 'Im min (1/s)' },
    yMax: { label: 'Im max (1/s)' },
  };
}

function toDisplay(kind: ChartKind, key: BoundKey, native: number): number {
  const meta = boundMeta(kind)[key];
  if (meta.logX) return Math.pow(10, native);
  return native;
}

function fromDisplay(kind: ChartKind, key: BoundKey, display: number): number {
  const meta = boundMeta(kind)[key];
  if (meta.logX) return Math.log10(Math.max(display, 1e-12));
  return display;
}

function formatField(kind: ChartKind, key: BoundKey, native: number): string {
  const v = toDisplay(kind, key, native);
  if (!Number.isFinite(v)) return '';
  const abs = Math.abs(v);
  if (abs !== 0 && (abs < 0.01 || abs >= 1000)) return v.toExponential(3);
  return String(Number(v.toPrecision(6)));
}

export function PlotDetailViewer({
  kind,
  report,
  nominal,
  ensemble = [],
  selectedRun = 0,
  campaign = null,
  showAllLines = false,
  onClose,
  onSelectRun,
}: {
  kind: ChartKind;
  report: StabilityReport;
  nominal?: StabilityReport | null;
  ensemble?: { run: number; report: StabilityReport }[];
  selectedRun?: number;
  campaign?: McCampaignStats | null;
  showAllLines?: boolean;
  onClose: () => void;
  onSelectRun?: (run: number) => void;
}) {
  const base = nominal ?? report;
  const selected = selectedRun > 0 ? ensemble.find((t) => t.run === selectedRun)?.report ?? report : null;
  const ensembleFreq = useMemo(
    () =>
      ensemble
        .filter((t) => t.run !== selectedRun)
        .map((t) => ({ run: t.run, freq: t.report.freq }))
        .filter((t) => t.freq.length > 1),
    [ensemble, selectedRun]
  );
  const margins = (selectedRun > 0 ? selected?.margins : null) ?? report.margins ?? base.margins;
  const conclusions = (selectedRun > 0 ? selected?.conclusions : null) ?? report.conclusions ?? base.conclusions;
  const [size, setSize] = useState({ w: 720, h: 420 });
  const [boundsMode, setBoundsMode] = useState<'auto' | 'manual'>('auto');
  const [autoBounds, setAutoBounds] = useState<ChartAxisBounds | null>(null);
  const [manualBounds, setManualBounds] = useState<ChartAxisBounds | null>(null);
  const [draft, setDraft] = useState<Record<BoundKey, string>>({
    xMin: '',
    xMax: '',
    yMin: '',
    yMax: '',
  });

  useEffect(() => {
    setBoundsMode('auto');
    setAutoBounds(null);
    setManualBounds(null);
    setDraft({ xMin: '', xMax: '', yMin: '', yMax: '' });
  }, [kind]);

  useEffect(() => {
    const measure = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const compact = vw <= 1040;
      const w = Math.max(280, Math.min(vw - (compact ? 32 : 360), 960));
      const h = Math.max(240, Math.min(vh * (compact ? 0.42 : 0.58), 560));
      setSize({ w, h });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const seedManual = (source: ChartAxisBounds) => {
    setManualBounds(source);
    setDraft({
      xMin: formatField(kind, 'xMin', source.xMin),
      xMax: formatField(kind, 'xMax', source.xMax),
      yMin: formatField(kind, 'yMin', source.yMin),
      yMax: formatField(kind, 'yMax', source.yMax),
    });
  };

  const setMode = (mode: 'auto' | 'manual') => {
    setBoundsMode(mode);
    if (mode === 'manual') {
      const source = manualBounds ?? autoBounds;
      if (source) seedManual(source);
    }
  };

  const commitDraft = (key: BoundKey, raw: string) => {
    setDraft((d) => ({ ...d, [key]: raw }));
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const native = fromDisplay(kind, key, n);
    setManualBounds((prev) => {
      const baseBounds = prev ?? autoBounds;
      if (!baseBounds) return prev;
      return { ...baseBounds, [key]: native };
    });
    setBoundsMode('manual');
  };

  const meta = boundMeta(kind);
  const axisBounds = boundsMode === 'manual' ? manualBounds : null;

  const overlay = (
    <div className="plot-detail" role="dialog" aria-modal="true" aria-label={`${TITLES[kind]} detail`}>
      <button type="button" className="plot-detail-backdrop" aria-label="Close plot detail" onClick={onClose} />
      <div className="plot-detail-sheet">
        <header className="plot-detail-bar">
          <div>
            <h2>{TITLES[kind]}</h2>
          </div>
          <button type="button" className="ghost" onClick={onClose}>
            Done
          </button>
        </header>

        <div className="plot-detail-body">
          <div className="plot-detail-canvas">
            <EnsembleChart
              kind={kind}
              title={TITLES[kind]}
              width={size.w}
              height={size.h}
              compact={false}
              expandable={false}
              nominal={base}
              selected={selectedRun > 0 ? selected : null}
              ensembleFreq={kind === 'rlocus' ? undefined : ensembleFreq}
              campaign={kind === 'rlocus' ? null : campaign}
              showAllLines={showAllLines}
              axisBounds={axisBounds}
              onAutoBounds={(bounds) => {
                setAutoBounds((prev) => (prev && boundsApproxEqual(prev, bounds) ? prev : bounds));
                if (boundsMode === 'auto') return;
                setManualBounds((prev) => prev ?? bounds);
              }}
              hint={
                campaign?.ok
                  ? `Bands · nominal · run ${selectedRun || 0} · ${campaign.ok} runs`
                  : selectedRun > 0
                    ? `Run ${selectedRun}`
                    : undefined
              }
            />
          </div>

          <aside className="plot-detail-side">
            <section className="analysis-card">
              <h3>Axis bounds</h3>
              <div className="segmented" role="group" aria-label="Axis bounds mode">
                <button type="button" className={boundsMode === 'auto' ? 'on' : ''} onClick={() => setMode('auto')}>
                  Auto
                </button>
                <button
                  type="button"
                  className={boundsMode === 'manual' ? 'on' : ''}
                  onClick={() => setMode('manual')}
                  disabled={!autoBounds && !manualBounds}
                >
                  Manual
                </button>
              </div>
              <div className={`plot-bounds-grid ${boundsMode === 'auto' ? 'is-auto' : ''}`}>
                {(['xMin', 'xMax', 'yMin', 'yMax'] as BoundKey[]).map((key) => (
                  <label key={key} className="field compact">
                    <span>{meta[key].label}</span>
                    <input
                      type="number"
                      step="any"
                      disabled={boundsMode === 'auto'}
                      value={
                        boundsMode === 'manual'
                          ? draft[key]
                          : autoBounds
                            ? formatField(kind, key, autoBounds[key])
                            : ''
                      }
                      placeholder={autoBounds ? formatField(kind, key, autoBounds[key]) : '—'}
                      onChange={(event) => commitDraft(key, event.target.value)}
                    />
                  </label>
                ))}
              </div>
              {boundsMode === 'manual' && autoBounds ? (
                <button type="button" className="ghost plot-bounds-reset" onClick={() => seedManual(autoBounds)}>
                  Reset to auto
                </button>
              ) : null}
            </section>

            {conclusions ? (
              <section className="analysis-card">
                <h3>Reading</h3>
                <p className={`conclusion-headline verdict-${conclusions.closedLoop}`}>{conclusions.headline}</p>
                <ul className="conclusion-bullets">
                  {conclusions.bullets.slice(0, 4).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            {margins ? (
              <section className="analysis-card">
                <h3>Margins</h3>
                <ul className="metric-grid">
                  <li>
                    <span>Gain</span>
                    <strong>{margins.gainMarginDb == null ? '—' : `${margins.gainMarginDb.toFixed(1)} dB`}</strong>
                  </li>
                  <li>
                    <span>Phase</span>
                    <strong>{margins.phaseMarginDeg == null ? '—' : `${margins.phaseMarginDeg.toFixed(1)}°`}</strong>
                  </li>
                  <li>
                    <span>Delay</span>
                    <strong>{margins.delayMarginSec == null ? '—' : `${margins.delayMarginSec.toFixed(3)} s`}</strong>
                  </li>
                  <li>
                    <span>ω_gc low</span>
                    <strong>{margins.gainCrossoverRad == null ? '—' : `${margins.gainCrossoverRad.toFixed(2)}`}</strong>
                  </li>
                  <li>
                    <span>ω_gc high</span>
                    <strong>
                      {margins.gainCrossoverHighRad == null ? '—' : `${margins.gainCrossoverHighRad.toFixed(2)}`}
                    </strong>
                  </li>
                  <li>
                    <span>ω_pc</span>
                    <strong>{margins.phaseCrossoverRad == null ? '—' : `${margins.phaseCrossoverRad.toFixed(2)}`}</strong>
                  </li>
                </ul>
                {margins.note ? <p className="hint">{margins.note}</p> : null}
              </section>
            ) : null}

            {onSelectRun && (ensemble.length > 0 || campaign?.ok) ? (
              <section className="analysis-card">
                <h3>Compare run</h3>
                <div className="run-scrubber">
                  <button type="button" className="ghost" onClick={() => onSelectRun(0)}>
                    Nominal
                  </button>
                  <label className="field compact">
                    <span>Run</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={selectedRun}
                      onChange={(event) => onSelectRun(Math.max(0, Math.round(Number(event.target.value) || 0)))}
                    />
                  </label>
                  <button type="button" className="ghost" onClick={() => onSelectRun(selectedRun + 1)}>
                    Next
                  </button>
                </div>
              </section>
            ) : null}
          </aside>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(overlay, document.body);
}
