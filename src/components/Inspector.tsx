import React, { useEffect, useMemo, useState } from 'react';
import { getBlock } from '../engine/blocks';
import { stepResponseMetrics } from '../engine/metrics';
import { ALL_ANALYSIS_OPTIONS } from '../engine/stability';
import { countUncertainParams, describeDraw, DIST_OPTIONS, drawNumeric, recommendMcRuns } from '../engine/montecarlo';
import { AnalysisOption, DistKind, LinearizationPoint, Param, ParamSpec, ParamUncertainty } from '../engine/types';
import { telemetry } from '../engine/telemetry';
import { isEdge, NodeData, toGraph } from '../model/elements';
import { analyzeController, captureLinearizationPoint, computeLqr, resetSim, runSelectedMc, selectMcRun } from '../sim/controller';
import { useStore } from '../store';
import { downloadText } from '../ui';
import { StabilityPlotGrid } from './StabilityPlots';

const Q_LABELS = ['Q₁ (x₁)', 'Q₂ (x₂)', 'Q₃ (x₃)', 'Q₄ (x₄)', 'Q₅ (x₅)', 'Q₆ (x₆)'];

const OP_MODES: { id: LinearizationPoint; label: string }[] = [
  { id: 'equilibrium', label: 'Equilibrium (0)' },
  { id: 'x0', label: 'Plant x₀' },
  { id: 'live', label: 'Live simulation state' },
  { id: 'custom', label: 'Custom breakpoint' },
];

export const Inspector: React.FC<{ mobileOpen: boolean; compact: boolean; onClose: () => void }> = ({
  mobileOpen,
  compact,
  onClose,
}) => {
  const [tab, setTab] = useState<'block' | 'design'>('block');
  const selectedIds = useStore((state) => state.selectedIds);
  const elements = useStore((state) => state.elements);
  const selected = elements.find((element) => element.id === selectedIds[0] && !isEdge(element));
  const data = selected && !isEdge(selected) ? (selected.data as NodeData) : null;
  const def = data ? getBlock(data.blockType) : undefined;

  return (
    <aside className={mobileOpen ? 'inspector mobile-open' : 'inspector'} aria-hidden={compact && !mobileOpen}>
      <div className="tabs">
        <button className={tab === 'block' ? 'on' : ''} onClick={() => setTab('block')}>
          Properties
        </button>
        <button className={tab === 'design' ? 'on' : ''} onClick={() => setTab('design')}>
          Design
        </button>
        <button type="button" className="drawer-close" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="inspector-scroll">
        {tab === 'design' ? <DesignPane /> : data && def && selected ? <BlockPane id={selected.id} data={data} /> : <ModelPane />}
      </div>
    </aside>
  );
};

function ModelPane() {
  const name = useStore((state) => state.name);
  const description = useStore((state) => state.description);
  const config = useStore((state) => state.config);
  const elements = useStore((state) => state.elements);
  const setConfig = useStore((state) => state.setConfig);
  const setMeta = useStore((state) => state.setMeta);
  const mcRun = config.mcRun ?? 0;
  const mcConfidence = config.mcConfidence ?? 0.95;
  const mcRelError = config.mcRelError ?? 0.05;
  const mcTailQuantile = config.mcTailQuantile ?? 0.95;
  const advice = useMemo(() => {
    const graph = toGraph(elements);
    return recommendMcRuns(graph.nodes, {
      confidence: mcConfidence,
      relError: mcRelError,
      tailQuantile: mcTailQuantile,
    });
  }, [elements, mcConfidence, mcRelError, mcTailQuantile]);
  return (
    <div className="pane">
      <h2>Document</h2>
      <label className="field">
        <span>Name</span>
        <input value={name} onChange={(event) => setMeta({ name: event.target.value })} />
      </label>
      <label className="field">
        <span>Description</span>
        <textarea value={description} onChange={(event) => setMeta({ description: event.target.value })} />
      </label>
      <h3>Simulation</h3>
      <label className="field">
        <span>Solver</span>
        <select value={config.solver} onChange={(event) => setConfig({ solver: event.target.value as 'rk4' | 'euler' })}>
          <option value="rk4">RK4</option>
          <option value="euler">Forward Euler</option>
        </select>
      </label>
      <NumberField label="Step size (s)" value={config.stepSize} step={0.001} onCommit={(value) => setConfig({ stepSize: value })} />
      <NumberField label="Stop time (s)" value={config.stopTime} step={1} onCommit={(value) => setConfig({ stopTime: value })} />
      <label className="field">
        <span>Speed</span>
        <select value={String(config.speed)} onChange={(event) => setConfig({ speed: Number(event.target.value) })}>
          {[0.25, 0.5, 1, 2, 4].map((speed) => (
            <option key={speed} value={speed}>
              {speed}×
            </option>
          ))}
        </select>
      </label>
      <h3>Monte Carlo</h3>
      <NumberField
        label="Simulation run"
        help="0 = nominal values. n>0 draws each distributed parameter from its fixed seed (same run ⇒ same draws)."
        value={mcRun}
        step={1}
        onCommit={(value) => setConfig({ mcRun: Math.max(0, Math.round(value)) })}
      />
      <div className="design-actions">
        <button type="button" className="ghost" onClick={() => setConfig({ mcRun: 0 })}>
          Nominal (0)
        </button>
        <button type="button" className="ghost" onClick={() => setConfig({ mcRun: mcRun + 1 })}>
          Next run
        </button>
      </div>
      <h3>Sample-size targets</h3>
      <label className="field">
        <span>Confidence</span>
        <select
          value={String(mcConfidence)}
          onChange={(event) => setConfig({ mcConfidence: Number(event.target.value) })}
        >
          <option value="0.9">90%</option>
          <option value="0.95">95%</option>
          <option value="0.99">99%</option>
        </select>
        <em>Two-sided normal CI for the CLT mean formula.</em>
      </label>
      <NumberField
        label="Mean relative half-width ε"
        help="Want |μ̂−μ| ≤ ε|μ| with the chosen confidence (default 5%)."
        value={mcRelError}
        step={0.01}
        onCommit={(value) => setConfig({ mcRelError: Math.min(0.5, Math.max(0.005, value)) })}
      />
      <NumberField
        label="Tail quantile q"
        help="Percentile of interest for the tail sample-size formula (e.g. 0.95)."
        value={mcTailQuantile}
        step={0.01}
        onCommit={(value) => setConfig({ mcTailQuantile: Math.min(0.999, Math.max(0.5, value)) })}
      />
      <div className="mc-advice">
        <p className="lede">{advice.summary}</p>
        {advice.params > 0 ? (
          <>
            <ul className="gain-list">
              <li>
                <span>Uncertain params</span>
                <span>{advice.params}</span>
              </li>
              <li>
                <span>Proxy CV</span>
                <span>{advice.cv.toFixed(3)}</span>
              </li>
              <li>
                <span>Pilot (≈N/4)</span>
                <span>1…{advice.explore}</span>
              </li>
              <li>
                <span>CLT mean</span>
                <span>1…{advice.mean}</span>
              </li>
              <li>
                <span>Tails / quantile</span>
                <span>1…{advice.tails}</span>
              </li>
              <li>
                <span>Saltelli screen</span>
                <span>1…{advice.screening}</span>
              </li>
            </ul>
            <div className="design-actions">
              <button type="button" className="ghost" onClick={() => setConfig({ mcRun: 1 })}>
                Start run 1
              </button>
              <button type="button" className="ghost" onClick={() => setConfig({ mcRun: advice.recommended })}>
                Jump to {advice.recommended}
              </button>
            </div>
            <p className="hint">{advice.detail}</p>
            {mcRun > 0 ? (
              <p className="hint">
                Progress vs CLT mean: {Math.min(mcRun, advice.mean)} / {advice.mean}
                {mcRun >= advice.mean ? ' · mean N met' : ''}
                {mcRun >= advice.tails ? ' · tails N met' : ''}
                {mcRun >= advice.screening ? ' · screening N met' : ''}
              </p>
            ) : (
              <p className="hint">You are on nominal (run 0). Use runs 1…N for the campaign.</p>
            )}
          </>
        ) : (
          <p className="hint">{advice.detail}</p>
        )}
      </div>
      <p className="hint">Initial conditions are read when you press Run. Gains and plant parameters update live.</p>
    </div>
  );
}

function BlockPane({ id, data }: { id: string; data: NodeData }) {
  const def = getBlock(data.blockType)!;
  const updateParam = useStore((state) => state.updateParam);
  const updateUncertainty = useStore((state) => state.updateUncertainty);
  const updateAlias = useStore((state) => state.updateAlias);
  const mcRun = useStore((state) => state.config.mcRun ?? 0);
  const groups = useMemo(() => {
    const map = new Map<string, ParamSpec[]>();
    for (const spec of def.parameters) {
      const group = spec.group ?? 'Parameters';
      const list = map.get(group) ?? [];
      list.push(spec);
      map.set(group, list);
    }
    return [...map.entries()];
  }, [def]);

  return (
    <div className="pane">
      <div className="block-kicker">{def.category}</div>
      <h2>{def.name}</h2>
      <p className="lede">{def.description}</p>
      <label className="field">
        <span>Name</span>
        <input value={data.alias} onChange={(event) => updateAlias(id, event.target.value)} />
      </label>
      {groups.map(([group, specs]) => (
        <section key={group}>
          <h3>{group}</h3>
          {specs.map((spec) => (
            <ParamField
              key={spec.key}
              spec={spec}
              value={data.parameters[spec.key]}
              uncertainty={data.uncertainty?.[spec.key]}
              mcRun={mcRun}
              onCommit={(value) => updateParam(id, spec.key, value)}
              onUncertainty={(patch) => updateUncertainty(id, spec.key, patch)}
            />
          ))}
        </section>
      ))}
      {def.type === 'scope' ? <ScopeMetrics id={id} /> : null}
      {def.category === 'Sinks' ? <ExportButton id={id} /> : null}
      <button
        type="button"
        className="ghost wide delete-block"
        onClick={() => {
          resetSim();
          useStore.getState().removeIds([id]);
        }}
      >
        Delete block
      </button>
    </div>
  );
}

function ScopeMetrics({ id }: { id: string }) {
  const time = useStore((state) => state.time);
  const ring = telemetry.series.get(telemetry.key(id, 'in0')) ?? telemetry.series.get(telemetry.key(id, 'in'));
  const metrics = stepResponseMetrics(ring);
  if (!ring || ring.count < 8) {
    return <p className="hint">Run the model to see step-response metrics for channel 1.</p>;
  }
  const fmt = (value: number | null, suffix = '') => (value === null || !Number.isFinite(value) ? '—' : `${value.toFixed(3)}${suffix}`);
  return (
    <section>
      <h3>Step metrics · ch1</h3>
      <ul className="gain-list">
        <li>
          <span>Rise 10–90%</span>
          <span>{fmt(metrics.riseTime, ' s')}</span>
        </li>
        <li>
          <span>Settling</span>
          <span>{fmt(metrics.settlingTime, ' s')}</span>
        </li>
        <li>
          <span>Overshoot</span>
          <span>{fmt(metrics.overshoot, ' %')}</span>
        </li>
        <li>
          <span>Steady state</span>
          <span>{fmt(metrics.steadyState)}</span>
        </li>
        <li>
          <span>Peak</span>
          <span>{fmt(metrics.peak)}</span>
        </li>
      </ul>
      <p className="hint">Estimated from the recorded trace at t = {time.toFixed(2)} s.</p>
    </section>
  );
}

function ParamField({
  spec,
  value,
  uncertainty,
  mcRun,
  onCommit,
  onUncertainty,
}: {
  spec: ParamSpec;
  value: Param | undefined;
  uncertainty?: ParamUncertainty;
  mcRun: number;
  onCommit: (value: Param) => void;
  onUncertainty: (patch: { kind: DistKind; spread?: number } | null) => void;
}) {
  if (spec.type === 'boolean') {
    return (
      <label className="check">
        <input type="checkbox" checked={value === true} onChange={(event) => onCommit(event.target.checked)} />
        <span>{spec.label}</span>
      </label>
    );
  }
  if (spec.type === 'select') {
    return (
      <label className="field">
        <span>{spec.label}</span>
        <select value={String(value ?? '')} onChange={(event) => onCommit(event.target.value)}>
          {spec.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (spec.type === 'string') {
    return (
      <label className="field">
        <span>{spec.label}</span>
        {spec.wide ? (
          <textarea
            rows={spec.key === 'scene' ? 6 : spec.key === 'text' ? 4 : 2}
            value={String(value ?? '')}
            onChange={(event) => onCommit(event.target.value)}
          />
        ) : (
          <input value={String(value ?? '')} onChange={(event) => onCommit(event.target.value)} />
        )}
        {spec.help ? <em>{spec.help}</em> : null}
      </label>
    );
  }
  const nominal = Number(value ?? 0);
  const kind = uncertainty?.kind ?? 'none';
  const drawn = kind !== 'none' ? drawNumeric(nominal, uncertainty, mcRun) : nominal;
  return (
    <div className="param-with-dist">
      <NumberField label={spec.label} help={spec.help} value={nominal} step={spec.step} onCommit={onCommit} />
      <div className="dist-row">
        <label className="field compact">
          <span>Distribution</span>
          <select
            value={kind}
            onChange={(event) => {
              const next = event.target.value as DistKind;
              onUncertainty(next === 'none' ? null : { kind: next, spread: uncertainty?.spread });
            }}
          >
            {DIST_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {kind !== 'none' ? (
          <NumberField
            label={kind === 'percent' ? '±%' : kind === 'uniform' ? 'Half-width' : 'σ'}
            value={uncertainty?.spread ?? 0}
            step={kind === 'percent' ? 1 : 0.01}
            onCommit={(spread) => onUncertainty({ kind, spread: Math.max(0, spread) })}
          />
        ) : null}
      </div>
      {kind !== 'none' ? (
        <p className="hint dist-hint">
          seed {uncertainty?.seed ?? '—'} · {describeDraw(uncertainty, nominal, mcRun)}
          {mcRun > 0 ? ` (sim uses ${drawn})` : ''}
        </p>
      ) : null}
    </div>
  );
}

function NumberField({
  label,
  help,
  value,
  step = 0.1,
  onCommit,
}: {
  label: string;
  help?: string;
  value: number;
  step?: number;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(formatInput(value)), [value]);
  return (
    <label className="field">
      <span>{label}</span>
      <input
        value={text}
        step={step}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          const next = Number(text);
          if (Number.isFinite(next)) onCommit(next);
          else setText(formatInput(value));
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
        }}
      />
      {help ? <em>{help}</em> : null}
    </label>
  );
}

function DesignPane() {
  const design = useStore((state) => state.design);
  const view = useStore((state) => state.designView);
  const mcRun = useStore((state) => state.config.mcRun ?? 0);
  const elements = useStore((state) => state.elements);
  const setDesignWeight = useStore((state) => state.setDesignWeight);
  const setDesignR = useStore((state) => state.setDesignR);
  const setDesignOpMode = useStore((state) => state.setDesignOpMode);
  const setDesignOp = useStore((state) => state.setDesignOp);
  const setDesignAnalysis = useStore((state) => state.setDesignAnalysis);
  const report = view?.report;
  const nominalReport = view?.nominalReport ?? report ?? null;
  const ensemble = view?.mcEnsemble ?? [];
  const selectedRun = view?.selectedRun ?? mcRun;
  const uncertainCount = useMemo(() => countUncertainParams(toGraph(elements).nodes), [elements]);
  const show = (option: AnalysisOption) => (design.analysis ?? []).includes(option);

  return (
    <div className="pane">
      <h2>Control design</h2>
      <p className="lede">
        Pick a linearization / breakpoint, choose stability reports, then analyze the current controller or compute LQR onto gain roles k0… / kref.
      </p>

      <h3>Monte Carlo run</h3>
      <NumberField
        label="Selected run (0 = nominal)"
        value={mcRun}
        step={1}
        onCommit={(value) => selectMcRun(Math.max(0, Math.round(value)))}
      />
      <div className="design-actions">
        <button type="button" className="ghost" onClick={() => selectMcRun(0)}>
          Nominal
        </button>
        <button type="button" className="ghost" onClick={() => selectMcRun(mcRun + 1)} disabled={uncertainCount <= 0}>
          Next run
        </button>
        <button type="button" className="ghost" onClick={() => runSelectedMc()}>
          Run sim
        </button>
      </div>
      <p className="hint">
        {uncertainCount > 0
          ? `Analyze overlays grey MC traces with black nominal; amber highlights run ${selectedRun}. Run sim uses the selected draw.`
          : 'Enable parameter distributions on the Properties tab to overlay Monte Carlo traces.'}
      </p>

      <h3>Linearization point</h3>
      <label className="field">
        <span>Operating point</span>
        <select value={design.opMode} onChange={(event) => setDesignOpMode(event.target.value as LinearizationPoint)}>
          {OP_MODES.map((mode) => (
            <option key={mode.id} value={mode.id}>
              {mode.label}
            </option>
          ))}
        </select>
        <em>Where A,B are taken for LQR and stability analysis.</em>
      </label>
      <label className="field">
        <span>x* (state)</span>
        <input
          value={design.xOp}
          placeholder="0 0 0 …"
          disabled={design.opMode !== 'custom'}
          onChange={(event) => setDesignOp({ xOp: event.target.value })}
        />
      </label>
      <label className="field">
        <span>u* (input)</span>
        <input value={design.uOp} placeholder="0" onChange={(event) => setDesignOp({ uOp: event.target.value })} />
      </label>
      <div className="design-actions">
        <button type="button" className="ghost" onClick={() => captureLinearizationPoint('x0')}>
          Capture x₀
        </button>
        <button type="button" className="ghost" onClick={() => captureLinearizationPoint('live')}>
          Capture live
        </button>
      </div>

      <h3>Stability analysis</h3>
      <div className="analysis-options">
        {ALL_ANALYSIS_OPTIONS.map((option) => (
          <label key={option.id} className="check">
            <input
              type="checkbox"
              checked={show(option.id)}
              onChange={(event) => setDesignAnalysis(option.id, event.target.checked)}
            />
            <span>
              {option.label}
              <em>{option.help}</em>
            </span>
          </label>
        ))}
      </div>

      <h3>State weight Q</h3>
      {Q_LABELS.map((label, index) => (
        <NumberField
          key={label}
          label={label}
          value={design.Q[index] ?? 0}
          step={1}
          onCommit={(value) => setDesignWeight(index, Math.max(0, value))}
        />
      ))}
      <h3>Control weight R</h3>
      <NumberField label="R (control)" value={design.R} step={0.1} onCommit={(value) => setDesignR(Math.max(0.01, value))} />

      <div className="design-actions stacked">
        <button className="ghost wide" onClick={() => analyzeController()}>
          Analyze stability
        </button>
        <button className="primary wide" onClick={() => computeLqr()}>
          Compute LQR and apply
        </button>
      </div>

      {view ? (
        <div className="poles">
          <p>{view.summary}</p>
          {view.opLabel ? <p className="hint">Breakpoint: {view.opLabel}</p> : null}

          {report ? (
            <ul className="gain-list report-summary">
              {report.summary.map((line) => (
                <li key={line}>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {report ? (
            <StabilityPlotGrid
              report={report}
              nominal={nominalReport}
              ensemble={ensemble}
              selectedRun={selectedRun}
              show={show}
            />
          ) : null}

          {show('poles') ? (
            <>
              <h3>Open-loop poles</h3>
              <ul>
                {view.open.map((pole) => (
                  <li key={`o-${pole}`} className={pole.trim().startsWith('-') || pole.trim().startsWith('−') ? '' : 'unstable'}>
                    {pole}
                  </li>
                ))}
              </ul>
              <h3>Closed-loop poles</h3>
              <ul>
                {view.closed.map((pole) => (
                  <li key={`c-${pole}`} className={pole.trim().startsWith('-') || pole.trim().startsWith('−') ? '' : 'unstable'}>
                    {pole}
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {show('damping') && report?.modes.length ? (
            <>
              <h3>Closed-loop modes</h3>
              <ul className="gain-list">
                {report.modes.map((mode) => (
                  <li key={mode.label}>
                    <span>{mode.label}</span>
                    <span>
                      ζ {mode.zeta.toFixed(2)} · ωₙ {mode.wn.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {show('margins') && report?.margins ? (
            <>
              <h3>Loop margins</h3>
              <ul className="gain-list">
                <li>
                  <span>Gain margin</span>
                  <span>{report.margins.gainMarginDb == null ? '—' : `${report.margins.gainMarginDb.toFixed(1)} dB`}</span>
                </li>
                <li>
                  <span>Phase margin</span>
                  <span>{report.margins.phaseMarginDeg == null ? '—' : `${report.margins.phaseMarginDeg.toFixed(1)}°`}</span>
                </li>
                <li>
                  <span>ω_gc</span>
                  <span>{report.margins.gainCrossoverRad == null ? '—' : `${report.margins.gainCrossoverRad.toFixed(2)} rad/s`}</span>
                </li>
                <li>
                  <span>ω_pc</span>
                  <span>{report.margins.phaseCrossoverRad == null ? '—' : `${report.margins.phaseCrossoverRad.toFixed(2)} rad/s`}</span>
                </li>
              </ul>
              <p className="hint">{report.margins.note}</p>
            </>
          ) : null}

          {show('ctrb') && report ? (
            <>
              <h3>Controllability</h3>
              <ul className="gain-list">
                <li>
                  <span>Rank</span>
                  <span>
                    {report.controllabilityRank} / {report.n}
                    {report.controllable ? '' : ' (deficient)'}
                  </span>
                </li>
              </ul>
            </>
          ) : null}

          <h3>Block gains</h3>
          <ul className="gain-list">
            {view.gains.map((gain) => (
              <li key={gain.id}>
                <span>{gain.id}</span>
                <span>{gain.value.toFixed(3)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="hint">Select a plant, set the breakpoint, then Analyze or Compute LQR.</p>
      )}
    </div>
  );
}

function ExportButton({ id }: { id: string }) {
  return (
    <button
      className="ghost wide"
      onClick={() => {
        const keys = [...telemetry.series.keys()].filter((key) => key.startsWith(`${id}:`));
        if (keys.length === 0) return;
        const rings = keys.map((key) => telemetry.series.get(key)!);
        const count = Math.max(...rings.map((ring) => ring.count));
        const header = ['time', ...keys.map((key) => key.slice(id.length + 1))].join(',');
        const lines = [header];
        for (let i = 0; i < count; i++) {
          const cells = rings.map((ring) => ring.at(i));
          const time = cells.find((cell) => cell)?.t ?? 0;
          lines.push([time.toFixed(6), ...cells.map((cell) => (cell ? cell.y.toFixed(8) : ''))].join(','));
        }
        downloadText(`${id}.csv`, lines.join('\n'), 'text/csv');
      }}
    >
      Download CSV
    </button>
  );
}

function formatInput(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 0.001 || abs >= 10000)) return value.toExponential(4);
  return String(Number(value.toPrecision(8)));
}
