import React, { useEffect, useMemo, useState } from 'react';
import { getBlock } from '../engine/blocks';
import { stepResponseMetrics } from '../engine/metrics';
import { ALL_ANALYSIS_OPTIONS } from '../engine/stability';
import { AnalysisOption, LinearizationPoint, Param, ParamSpec } from '../engine/types';
import { telemetry } from '../engine/telemetry';
import { isEdge, NodeData } from '../model/elements';
import { analyzeController, captureLinearizationPoint, computeLqr, resetSim } from '../sim/controller';
import { useStore } from '../store';
import { downloadText } from '../ui';

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
  const setConfig = useStore((state) => state.setConfig);
  const setMeta = useStore((state) => state.setMeta);
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
      <p className="hint">Initial conditions are read when you press Run. Gains and plant parameters update live.</p>
    </div>
  );
}

function BlockPane({ id, data }: { id: string; data: NodeData }) {
  const def = getBlock(data.blockType)!;
  const updateParam = useStore((state) => state.updateParam);
  const updateAlias = useStore((state) => state.updateAlias);
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
            <ParamField key={spec.key} spec={spec} value={data.parameters[spec.key]} onCommit={(value) => updateParam(id, spec.key, value)} />
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

function ParamField({ spec, value, onCommit }: { spec: ParamSpec; value: Param | undefined; onCommit: (value: Param) => void }) {
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
  return <NumberField label={spec.label} help={spec.help} value={Number(value ?? 0)} step={spec.step} onCommit={onCommit} />;
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
  const setDesignWeight = useStore((state) => state.setDesignWeight);
  const setDesignR = useStore((state) => state.setDesignR);
  const setDesignOpMode = useStore((state) => state.setDesignOpMode);
  const setDesignOp = useStore((state) => state.setDesignOp);
  const setDesignAnalysis = useStore((state) => state.setDesignAnalysis);
  const report = view?.report;
  const show = (option: AnalysisOption) => (design.analysis ?? []).includes(option);

  return (
    <div className="pane">
      <h2>Control design</h2>
      <p className="lede">
        Pick a linearization / breakpoint, choose stability reports, then analyze the current controller or compute LQR onto gain roles k0… / kref.
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

          {show('polemap') && report ? <PoleMap open={report.polesOpen} closed={report.polesClosed} /> : null}

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

function PoleMap({ open, closed }: { open: { real: number; imag: number }[]; closed: { real: number; imag: number }[] }) {
  const pts = [...open, ...closed];
  if (!pts.length) return null;
  const maxR = Math.max(1, ...pts.map((p) => Math.abs(p.real)));
  const maxI = Math.max(1, ...pts.map((p) => Math.abs(p.imag)));
  const lim = Math.max(maxR, maxI) * 1.15;
  const W = 220;
  const H = 160;
  const pad = 16;
  const toX = (re: number) => pad + ((re + lim) / (2 * lim)) * (W - 2 * pad);
  const toY = (im: number) => H - pad - ((im + lim) / (2 * lim)) * (H - 2 * pad);
  return (
    <div className="pole-map">
      <h3>Pole map</h3>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Open and closed-loop poles">
        <rect x="0" y="0" width={W} height={H} fill="#0c1016" rx="8" />
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
      </svg>
      <p className="hint">○ open · ● closed · left half-plane is stable</p>
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
