import React, { useMemo } from 'react';
import { McCampaignStats } from '../engine/mcStats';
import { StabilityReport } from '../engine/stability';
import { AnalysisOption } from '../engine/types';
import { EnsembleChart } from './EnsembleCanvas';

export interface McPlotTrace {
  run: number;
  report: StabilityReport;
}

function legendHint(hasMc: boolean, campaign?: McCampaignStats | null): string {
  if (campaign && campaign.ok > 0) {
    return `bands = p05–p95 · grey lines = overlay · black = nominal · amber = selected · ${campaign.backend} ${campaign.ok} runs`;
  }
  return hasMc ? 'grey = MC · black = nominal · amber = selected' : 'black = nominal';
}

export function StabilityPlotGrid({
  report,
  nominal,
  ensemble = [],
  selectedRun = 0,
  campaign = null,
  showAllLines = false,
  show,
}: {
  report: StabilityReport;
  nominal?: StabilityReport | null;
  ensemble?: McPlotTrace[];
  selectedRun?: number;
  campaign?: McCampaignStats | null;
  showAllLines?: boolean;
  show: (option: AnalysisOption) => boolean;
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
  const hint = legendHint(ensemble.length > 0 || !!campaign?.ok, campaign);

  return (
    <div className="stability-plot-grid">
      {show('polemap') ? (
        <EnsembleChart
          kind="poles"
          title="Pole map"
          hint={hint}
          nominal={base}
          selected={selectedRun > 0 ? selected : null}
          campaign={campaign}
        />
      ) : null}
      {show('bode') ? (
        <>
          <EnsembleChart
            kind="bode-mag"
            title="Bode magnitude"
            hint={hint}
            height={150}
            nominal={base}
            selected={selectedRun > 0 ? selected : null}
            ensembleFreq={ensembleFreq}
            campaign={campaign}
            showAllLines={showAllLines}
          />
          <EnsembleChart
            kind="bode-phase"
            title="Bode phase"
            hint={hint}
            height={150}
            nominal={base}
            selected={selectedRun > 0 ? selected : null}
            ensembleFreq={ensembleFreq}
            campaign={campaign}
          />
        </>
      ) : null}
      {show('nyquist') ? (
        <EnsembleChart
          kind="nyquist"
          title="Nyquist"
          hint={hint}
          height={180}
          nominal={base}
          selected={selectedRun > 0 ? selected : null}
          ensembleFreq={ensembleFreq}
          campaign={campaign}
        />
      ) : null}
      {show('nichols') ? (
        <EnsembleChart
          kind="nichols"
          title="Nichols"
          hint={hint}
          height={170}
          nominal={base}
          selected={selectedRun > 0 ? selected : null}
          ensembleFreq={ensembleFreq}
          campaign={campaign}
        />
      ) : null}
      {show('rlocus') ? (
        <EnsembleChart kind="rlocus" title="Root locus" hint="nominal root locus (campaign uses pole cloud)" height={170} nominal={base} />
      ) : null}
    </div>
  );
}
