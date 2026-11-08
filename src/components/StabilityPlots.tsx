import React, { useMemo, useState } from 'react';
import { McCampaignStats } from '../engine/mcStats';
import { StabilityReport } from '../engine/stability';
import { AnalysisOption } from '../engine/types';
import { ChartKind, EnsembleChart } from './EnsembleCanvas';
import { PlotDetailViewer } from './PlotDetailViewer';

export interface McPlotTrace {
  run: number;
  report: StabilityReport;
}

function legendHint(hasMc: boolean, campaign?: McCampaignStats | null): string {
  if (campaign && campaign.ok > 0) {
    return `bands · overlays · nominal · selected · ${campaign.backend} ${campaign.ok} runs`;
  }
  return hasMc ? 'grey = MC · black = nominal · amber = selected' : 'Tap a plot to inspect';
}

export function StabilityPlotGrid({
  report,
  nominal,
  ensemble = [],
  selectedRun = 0,
  campaign = null,
  showAllLines = false,
  show,
  onSelectRun,
}: {
  report: StabilityReport;
  nominal?: StabilityReport | null;
  ensemble?: McPlotTrace[];
  selectedRun?: number;
  campaign?: McCampaignStats | null;
  showAllLines?: boolean;
  show: (option: AnalysisOption) => boolean;
  onSelectRun?: (run: number) => void;
}) {
  const [detail, setDetail] = useState<ChartKind | null>(null);
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
  const hint = legendHint(ensemble.length > 0 || !!campaign?.ok, campaign);

  const chart = (kind: ChartKind, title: string, height: number, extra?: { campaign?: McCampaignStats | null; ensemble?: boolean }) => (
    <EnsembleChart
      kind={kind}
      title={title}
      hint={hint}
      height={height}
      fill
      expandable
      onOpen={() => setDetail(kind)}
      nominal={base}
      selected={selectedRun > 0 ? selected : null}
      ensembleFreq={extra?.ensemble === false ? undefined : ensembleFreq}
      campaign={extra?.campaign === null ? null : campaign}
      showAllLines={showAllLines}
    />
  );

  return (
    <>
      <div className="stability-plot-grid">
        {show('polemap') ? chart('poles', 'Pole map', 168) : null}
        {show('bode') ? (
          <>
            {chart('bode-mag', 'Bode magnitude', 150)}
            {chart('bode-phase', 'Bode phase', 150)}
          </>
        ) : null}
        {show('nyquist') ? chart('nyquist', 'Nyquist', 180) : null}
        {show('nichols') ? chart('nichols', 'Nichols', 170) : null}
        {show('rlocus') ? chart('rlocus', 'Root locus', 170, { campaign: null, ensemble: false }) : null}
      </div>

      {detail ? (
        <PlotDetailViewer
          kind={detail}
          report={report}
          nominal={nominal}
          ensemble={ensemble}
          selectedRun={selectedRun}
          campaign={campaign}
          showAllLines={showAllLines}
          onClose={() => setDetail(null)}
          onSelectRun={onSelectRun}
        />
      ) : null}
    </>
  );
}
