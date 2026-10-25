import React, { useEffect, useMemo, useState } from 'react';
import { getBlock } from '../engine/blocks';
import { Param, ParamSpec } from '../engine/types';
import { telemetry } from '../engine/telemetry';
import { isEdge, NodeData } from '../model/elements';
import { computeLqr, resetSim } from '../sim/controller';
import { useStore } from '../store';
import { downloadText } from '../ui';

const Q_LABELS = ['x  cart position', 'θ₁  upper angle', 'θ₂  lower angle', 'ẋ  cart velocity', 'ω₁', 'ω₂'];

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
          <textarea rows={spec.key === 'text' ? 4 : 2} value={String(value ?? '')} onChange={(event) => onCommit(event.target.value)} />
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
  return (
    <div className="pane">
      <h2>LQR design</h2>
      <p className="lede">
        Linearize the cart double pendulum about the upright equilibrium and place the optimal gain on the six feedback blocks.
        The law is u = −K(z − r), with the reference subtracted from cart position only.
      </p>
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
      <NumberField label="Force" value={design.R} step={0.1} onCommit={(value) => setDesignR(Math.max(0.01, value))} />
      <button className="primary wide" onClick={() => computeLqr()}>
        Compute LQR and apply
      </button>
      {view ? (
        <div className="poles">
          <p>{view.summary}</p>
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
              <li key={`c-${pole}`}>{pole}</li>
            ))}
          </ul>
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
        <p className="hint">Run is not required. Edit the plant masses or lengths, then compute again.</p>
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
