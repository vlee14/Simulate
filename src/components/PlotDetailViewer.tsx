import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom';
import { McCampaignStats } from '../engine/mcStats';
import { StabilityReport } from '../engine/stability';
import { ChartKind, EnsembleChart } from './EnsembleCanvas';
import { BtnIcon } from './Icon';

const TITLES: Record<ChartKind, string> = {
  poles: 'Pole map',
  'bode-mag': 'Bode magnitude',
  'bode-phase': 'Bode phase',
  nyquist: 'Nyquist',
  nichols: 'Nichols',
  rlocus: 'Root locus',
};

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

  const overlay = (
    <div className="plot-detail" role="dialog" aria-modal="true" aria-label={`${TITLES[kind]} detail`}>
      <button type="button" className="plot-detail-backdrop" aria-label="Close plot detail" onClick={onClose} />
      <div className="plot-detail-sheet">
        <header className="plot-detail-bar">
          <div>
            <h2>{TITLES[kind]}</h2>
          </div>
          <button type="button" className="ghost" onClick={onClose}>
            <BtnIcon icon="close">Done</BtnIcon>
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
                    <span>ω_gc</span>
                    <strong>{margins.gainCrossoverRad == null ? '—' : `${margins.gainCrossoverRad.toFixed(2)}`}</strong>
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
                    <BtnIcon icon="home">Nominal</BtnIcon>
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
                    <BtnIcon icon="chevronRight">Next</BtnIcon>
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
