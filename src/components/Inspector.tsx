import React, { useEffect, useMemo, useState } from 'react';
import { getBlock } from '../engine/blocks';
import { stepResponseMetrics } from '../engine/metrics';
import { CONTROLLER_OPTIONS, controllerOption } from '../engine/controllers';
import { ALL_ANALYSIS_OPTIONS } from '../engine/stability';
import { countUncertainParams, describeDraw, DIST_OPTIONS, drawNumeric, recommendMcRuns } from '../engine/montecarlo';
import {
  AnalysisOption,
  ControllerKind,
  DistKind,
  LinearizationPoint,
  Param,
  ParamSpec,
  ParamUncertainty,
} from '../engine/types';
import { telemetry } from '../engine/telemetry';
import { isEdge, NodeData, toGraph } from '../model/elements';
import { formatEta } from '../engine/mcCampaignRunner';
import { MC_CAMPAIGN_MAX, MC_OVERLAY_MAX } from '../engine/mcStats';
import {
  analyzeController,
  captureLinearizationPoint,
  resetSim,
  runSelectedMc,
  selectMcRun,
  synthesizeController,
} from '../sim/controller';
import { useStore } from '../store';
import { downloadText } from '../ui';
import { BtnIcon } from './Icon';
import { LabPane } from './LabPane';
import { StabilityPlotGrid } from './StabilityPlots';

const Q_LABELS = ['Q₁ (x₁)', 'Q₂ (x₂)', 'Q₃ (x₃)', 'Q₄ (x₄)', 'Q₅ (x₅)', 'Q₆ (x₆)'];

const OP_MODES: { id: LinearizationPoint; label: string }[] = [
  { id: 'equilibrium', label: 'Equilibrium' },
  { id: 'x0', label: 'Plant x₀' },
  { id: 'live', label: 'Live state' },
  { id: 'custom', label: 'Custom' },
];

export const Inspector: React.FC<{ mobileOpen: boolean; compact: boolean; onClose: () => void }> = ({
  mobileOpen,
  compact,
  onClose,
}) => {
  const [tab, setTab] = useState<'block' | 'design' | 'lab'>('block');
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
        <button className={tab === 'lab' ? 'on' : ''} onClick={() => setTab('lab')}>
          Lab
        </button>
        <button type="button" className="drawer-close" onClick={onClose} aria-label="Close inspector">
          <BtnIcon icon="close">Close</BtnIcon>
        </button>
      </div>
      <div className="inspector-scroll">
        {tab === 'lab' ? (
          <LabPane />
        ) : tab === 'design' ? (
          <DesignPane />
        ) : data && def && selected ? (
          <BlockPane id={selected.id} data={data} />
        ) : (
          <ModelPane />
        )}
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
        help="0 = nominal. Higher runs use fixed random draws."
        value={mcRun}
        step={1}
        onCommit={(value) => setConfig({ mcRun: Math.max(0, Math.round(value)) })}
      />
      <div className="design-actions">
        <button type="button" className="ghost" onClick={() => setConfig({ mcRun: 0 })}>
          Nominal
        </button>
        <button type="button" className="ghost" onClick={() => setConfig({ mcRun: mcRun + 1 })}>
          Next run
        </button>
      </div>
      <h3>Sample size</h3>
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
      </label>
      <NumberField
        label="Mean precision"
        help="Target relative error on the mean."
        value={mcRelError}
        step={0.01}
        onCommit={(value) => setConfig({ mcRelError: Math.min(0.5, Math.max(0.005, value)) })}
      />
      <NumberField
        label="Tail quantile"
        help="Percentile used for tail sample size."
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
                <span>Variability</span>
                <span>{advice.cv.toFixed(3)}</span>
              </li>
              <li>
                <span>For mean</span>
                <span>1…{advice.mean}</span>
              </li>
              <li>
                <span>For tails</span>
                <span>1…{advice.tails}</span>
              </li>
              <li>
                <span>For screening</span>
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
            {mcRun > 0 ? (
              <p className="hint">
                Progress: {Math.min(mcRun, advice.mean)} / {advice.mean} for mean
              </p>
            ) : (
              <p className="hint">On nominal. Use run 1+ for Monte Carlo.</p>
            )}
          </>
        ) : (
          <p className="hint">{advice.detail}</p>
        )}
      </div>
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
              onUncertainty={(patch) => {
                useStore.getState().checkpoint();
                updateUncertainty(id, spec.key, patch);
              }}
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
    return <p className="hint">Run the model to see step metrics.</p>;
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
      <p className="hint">From the trace at t = {time.toFixed(2)} s.</p>
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
        <input
          type="checkbox"
          checked={value === true}
          onChange={(event) => {
            useStore.getState().checkpoint();
            onCommit(event.target.checked);
          }}
        />
        <span>{spec.label}</span>
      </label>
    );
  }
  if (spec.type === 'select') {
    return (
      <label className="field">
        <span>{spec.label}</span>
        <select
          value={String(value ?? '')}
          onChange={(event) => {
            useStore.getState().checkpoint();
            onCommit(event.target.value);
          }}
        >
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
    return <StringParamField spec={spec} value={String(value ?? '')} onCommit={onCommit} />;
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

function StringParamField({
  spec,
  value,
  onCommit,
}: {
  spec: ParamSpec;
  value: string;
  onCommit: (value: Param) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    if (text === value) return;
    useStore.getState().checkpoint();
    onCommit(text);
  };
  return (
    <label className="field">
      <span>{spec.label}</span>
      {spec.wide ? (
        <textarea
          rows={spec.key === 'scene' ? 6 : spec.key === 'text' ? 4 : 2}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
        />
      ) : (
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
          }}
        />
      )}
      {spec.help ? <em>{spec.help}</em> : null}
    </label>
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
          if (!Number.isFinite(next)) {
            setText(formatInput(value));
            return;
          }
          if (next === value) return;
          useStore.getState().checkpoint();
          onCommit(next);
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
  const config = useStore((state) => state.config);
  const mcRun = config.mcRun ?? 0;
  const elements = useStore((state) => state.elements);
  const setConfig = useStore((state) => state.setConfig);
  const setDesignWeight = useStore((state) => state.setDesignWeight);
  const setDesignR = useStore((state) => state.setDesignR);
  const setDesignOpMode = useStore((state) => state.setDesignOpMode);
  const setDesignOp = useStore((state) => state.setDesignOp);
  const setDesignAnalysis = useStore((state) => state.setDesignAnalysis);
  const setDesignController = useStore((state) => state.setDesignController);
  const report = view?.report;
  const nominalReport = view?.nominalReport ?? report ?? null;
  const ensemble = view?.mcEnsemble ?? [];
  const campaign = view?.mcCampaign ?? null;
  const progress = view?.mcCampaignProgress ?? null;
  const selectedRun = view?.selectedRun ?? mcRun;
  const uncertainCount = useMemo(() => countUncertainParams(toGraph(elements).nodes), [elements]);
  const show = (option: AnalysisOption) => (design.analysis ?? []).includes(option);
  const campaignSize = config.mcCampaignSize ?? 1000;
  const overlayCount = config.mcOverlayCount ?? 96;
  const showAllLines = !!config.mcShowAllLines;
  const [section, setSection] = useState<'setup' | 'results'>(view?.report ? 'results' : 'setup');

  useEffect(() => {
    if (view?.report) setSection('results');
  }, [view?.report]);

  const controller = design.controller ?? 'lqr';
  const controllerMeta = controllerOption(controller);
  const needsQ = ['lqr', 'lqi', 'lqg', 'observer-lqr'].includes(controller);
  const needsPoles = controller === 'poleplace';
  const needsPid = ['pid-imc', 'pid-zn', 'pi-imc', 'pd', 'p'].includes(controller);
  const needsLead = ['lead', 'lag', 'leadlag', 'hinf-loop'].includes(controller);
  const needsQi = controller === 'lqi';
  const needsTs = controller === 'deadbeat';

  const runAnalyze = () => {
    analyzeController();
    setSection('results');
  };
  const runSynthesize = () => {
    synthesizeController(controller);
    setSection('results');
  };

  return (
    <div className="pane design-pane">
      <header className="pane-hero">
        <h2>Design</h2>
      </header>

      <div className="segmented" role="tablist" aria-label="Design sections">
        <button type="button" role="tab" aria-selected={section === 'setup'} className={section === 'setup' ? 'on' : ''} onClick={() => setSection('setup')}>
          Setup
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={section === 'results'}
          className={section === 'results' ? 'on' : ''}
          onClick={() => setSection('results')}
          disabled={!view}
        >
          Results
        </button>
      </div>

      {section === 'setup' ? (
        <>
          <section className="analysis-card">
            <h3>Linearization</h3>
            <label className="field">
              <span>Operating point</span>
              <select value={design.opMode} onChange={(event) => setDesignOpMode(event.target.value as LinearizationPoint)}>
                {OP_MODES.map((mode) => (
                  <option key={mode.id} value={mode.id}>
                    {mode.label}
                  </option>
                ))}
              </select>
              <em>Point used for linearization.</em>
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
          </section>

          <section className="analysis-card">
            <h3>Reports</h3>
            <div className="analysis-options chip-grid">
              {ALL_ANALYSIS_OPTIONS.map((option) => (
                <label key={option.id} className={`chip-check${show(option.id) ? ' on' : ''}`}>
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
          </section>

          <section className="analysis-card">
            <h3>Controller</h3>
            <label className="field">
              <span>Type</span>
              <select
                value={controller}
                onChange={(event) => setDesignController({ controller: event.target.value as ControllerKind })}
              >
                {Array.from(new Set(CONTROLLER_OPTIONS.map((o) => o.group))).map((group) => (
                  <optgroup key={group} label={group}>
                    {CONTROLLER_OPTIONS.filter((o) => o.group === group).map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <em>{controllerMeta.help}</em>
            </label>

            {needsPoles ? (
              <label className="field">
                <span>Desired poles</span>
                <input
                  value={design.poles ?? ''}
                  placeholder="-2 -3 or -1±2j"
                  onChange={(event) => setDesignController({ poles: event.target.value })}
                />
              </label>
            ) : null}

            {needsPid ? (
              <NumberField
                label="λ (s, 0 = auto)"
                value={design.pidLambda ?? 0}
                step={0.05}
                onCommit={(value) => setDesignController({ pidLambda: Math.max(0, value) })}
              />
            ) : null}

            {needsQi ? (
              <NumberField
                label="Integral weight Qi"
                value={design.Qi ?? 20}
                step={1}
                onCommit={(value) => setDesignController({ Qi: Math.max(1e-6, value) })}
              />
            ) : null}

            {needsLead ? (
              <>
                <NumberField
                  label="ωc (rad/s)"
                  value={design.omegaC ?? 3}
                  step={0.5}
                  onCommit={(value) => setDesignController({ omegaC: Math.max(1e-3, value) })}
                />
                {controller !== 'lag' ? (
                  <NumberField
                    label="Phase boost (°)"
                    value={design.phaseBoostDeg ?? 45}
                    step={5}
                    onCommit={(value) => setDesignController({ phaseBoostDeg: Math.min(70, Math.max(5, value)) })}
                  />
                ) : null}
              </>
            ) : null}

            {needsTs ? (
              <NumberField
                label="Sample time Ts (s)"
                value={design.sampleTime ?? 0.02}
                step={0.01}
                onCommit={(value) => setDesignController({ sampleTime: Math.max(1e-4, value) })}
              />
            ) : null}

            {needsQ ? (
              <>
                <h3>Weights Q / R</h3>
                {Q_LABELS.map((label, index) => (
                  <NumberField
                    key={label}
                    label={label}
                    value={design.Q[index] ?? 0}
                    step={1}
                    onCommit={(value) => setDesignWeight(index, Math.max(0, value))}
                  />
                ))}
                <NumberField label="R (control)" value={design.R} step={0.1} onCommit={(value) => setDesignR(Math.max(0.01, value))} />
              </>
            ) : null}
          </section>

          <section className="analysis-card">
            <h3>Monte Carlo</h3>
            <NumberField
              label={`Campaign size (1…${MC_CAMPAIGN_MAX})`}
              value={campaignSize}
              step={100}
              onCommit={(value) => setConfig({ mcCampaignSize: Math.min(MC_CAMPAIGN_MAX, Math.max(0, Math.round(value))) })}
            />
            <NumberField
              label={`Overlay lines (≤${MC_OVERLAY_MAX})`}
              value={overlayCount}
              step={16}
              onCommit={(value) => setConfig({ mcOverlayCount: Math.min(MC_OVERLAY_MAX, Math.max(0, Math.round(value))) })}
            />
            <label className="check">
              <input
                type="checkbox"
                checked={showAllLines}
                onChange={(event) => setConfig({ mcShowAllLines: event.target.checked })}
              />
              <span>Show all Bode lines</span>
            </label>
            <NumberField
              label="Selected run (0 = nominal)"
              value={mcRun}
              step={1}
              onCommit={(value) => selectMcRun(Math.max(0, Math.round(value)))}
            />
            <div className="design-actions">
              <button type="button" className="ghost" onClick={() => selectMcRun(0)}>
                <BtnIcon icon="home">Nominal</BtnIcon>
              </button>
              <button type="button" className="ghost" onClick={() => selectMcRun(mcRun + 1)} disabled={uncertainCount <= 0}>
                <BtnIcon icon="chevronRight">Next run</BtnIcon>
              </button>
              <button type="button" className="ghost" onClick={() => runSelectedMc()}>
                <BtnIcon icon="play">Run sim</BtnIcon>
              </button>
            </div>
            {progress ? (
              <div className="mc-progress" role="status" aria-live="polite">
                <div className="mc-progress-meta">
                  <span>{progress.label}</span>
                  <span>
                    {progress.done.toLocaleString()}/{progress.total.toLocaleString()}
                    {progress.phase === 'sample' && progress.etaMs != null ? ` · ETA ${formatEta(progress.etaMs)}` : ''}
                    {progress.rate != null && progress.phase === 'sample' ? ` · ${progress.rate.toFixed(0)}/s` : ''}
                  </span>
                </div>
                <div className="mc-progress-track" aria-hidden>
                  <div
                    className={`mc-progress-fill${progress.phase !== 'sample' ? ' pulse' : ''}`}
                    style={{ width: `${Math.max(2, Math.min(100, (100 * progress.done) / Math.max(1, progress.total)))}%` }}
                  />
                </div>
              </div>
            ) : null}
            <p className="hint">
              {uncertainCount > 0
                ? `Analyze runs Monte Carlo with bands + ${overlayCount} overlays.`
                : 'Add parameter distributions on Properties for Monte Carlo.'}
            </p>
          </section>
        </>
      ) : view ? (
        <div className="poles design-results">
          {view.opLabel ? <p className="hint">At: {view.opLabel}</p> : null}

          {campaign ? (
            <ul className="metric-grid campaign-metrics">
              <li>
                <span>Stable</span>
                <strong>{(100 * campaign.stableFraction).toFixed(1)}%</strong>
              </li>
              <li>
                <span>α p50</span>
                <strong>{campaign.alphaP50 == null ? '—' : campaign.alphaP50.toFixed(3)}</strong>
              </li>
              <li>
                <span>α p95</span>
                <strong>{campaign.alphaP95 == null ? '—' : campaign.alphaP95.toFixed(3)}</strong>
              </li>
            </ul>
          ) : null}

          {report?.conclusions ? (
            <section className="analysis-card stability-conclusions">
              <h3>Conclusions</h3>
              <p className={`conclusion-headline verdict-${report.conclusions.closedLoop}`}>{report.conclusions.headline}</p>
              <ul className="verdict-row" aria-label="Stability verdicts">
                <li>
                  <span>Closed loop</span>
                  <strong className={`verdict-${report.conclusions.closedLoop}`}>{verdictLabel(report.conclusions.closedLoop)}</strong>
                </li>
                <li>
                  <span>Open loop</span>
                  <strong className={`verdict-${report.conclusions.openLoop}`}>{verdictLabel(report.conclusions.openLoop)}</strong>
                </li>
                <li>
                  <span>Margins</span>
                  <strong className={`verdict-margin-${report.conclusions.margins}`}>{marginVerdictLabel(report.conclusions.margins)}</strong>
                </li>
              </ul>
              <ul className="conclusion-bullets">
                {report.conclusions.bullets.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {report?.margins ? (
            <section className="analysis-card stability-margins">
              <h3>Stability margins</h3>
              <ul className="metric-grid">
                <li>
                  <span>Gain</span>
                  <strong>{report.margins.gainMarginDb == null ? '—' : `${report.margins.gainMarginDb.toFixed(1)} dB`}</strong>
                </li>
                <li>
                  <span>Phase</span>
                  <strong>{report.margins.phaseMarginDeg == null ? '—' : `${report.margins.phaseMarginDeg.toFixed(1)}°`}</strong>
                </li>
                <li>
                  <span>Delay</span>
                  <strong>{report.margins.delayMarginSec == null ? '—' : `${report.margins.delayMarginSec.toFixed(3)} s`}</strong>
                </li>
                <li>
                  <span>ω_gc</span>
                  <strong>{report.margins.gainCrossoverRad == null ? '—' : `${report.margins.gainCrossoverRad.toFixed(2)}`}</strong>
                </li>
                <li>
                  <span>ω_pc</span>
                  <strong>{report.margins.phaseCrossoverRad == null ? '—' : `${report.margins.phaseCrossoverRad.toFixed(2)}`}</strong>
                </li>
              </ul>
              {report.margins.note ? <p className="hint">{report.margins.note}</p> : null}
            </section>
          ) : null}

          {report ? (
            <section className="analysis-card plots-card">
              <div className="stability-plot-head section-head">
                <h3>Plots</h3>
              </div>
              <StabilityPlotGrid
                report={report}
                nominal={nominalReport}
                ensemble={ensemble}
                selectedRun={selectedRun}
                campaign={campaign}
                showAllLines={showAllLines}
                show={show}
                onSelectRun={(run) => selectMcRun(run)}
              />
            </section>
          ) : null}

          {show('poles') ? (
            <section className="analysis-card">
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
            </section>
          ) : null}

          {show('damping') && report?.modes.length ? (
            <section className="analysis-card">
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
            </section>
          ) : null}

          {show('ctrb') && report ? (
            <section className="analysis-card">
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
            </section>
          ) : null}

          <section className="analysis-card">
            <h3>Block gains</h3>
            <ul className="gain-list">
              {view.gains.map((gain) => (
                <li key={gain.id}>
                  <span>{gain.id}</span>
                  <span>{gain.value.toFixed(3)}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : (
        <p className="hint empty-results">Select a plant, then Analyze or Synthesize.</p>
      )}

      <div className="design-sticky-actions">
        <button className="ghost" onClick={runAnalyze}>
          Analyze
        </button>
        <button className="primary" onClick={runSynthesize}>
          Synthesize
        </button>
      </div>
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

function verdictLabel(v: 'stable' | 'marginal' | 'unstable' | 'unknown'): string {
  if (v === 'stable') return 'Stable';
  if (v === 'marginal') return 'Marginal';
  if (v === 'unstable') return 'Unstable';
  return 'Unknown';
}

function marginVerdictLabel(v: 'adequate' | 'thin' | 'inadequate' | 'unknown'): string {
  if (v === 'adequate') return 'Adequate';
  if (v === 'thin') return 'Thin';
  if (v === 'inadequate') return 'Inadequate';
  return 'Unknown';
}
