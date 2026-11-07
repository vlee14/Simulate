import React, { useEffect, useRef, useState } from 'react';
import { parseStageConfig } from '../engine/scene';
import { telemetry } from '../engine/telemetry';
import { isEdge, NodeData } from '../model/elements';
import { nudgeState } from '../sim/controller';
import { useStore } from '../store';
import { COMPACT_LAYOUT, useMediaQuery } from '../ui';
import { drawStage } from './draw';

export const Dock: React.FC = () => {
  const elements = useStore((state) => state.elements);
  const time = useStore((state) => state.time);
  const updateParam = useStore((state) => state.updateParam);
  const stage = elements.find((element) => !isEdge(element) && (element.data as NodeData)?.blockType === 'stage');
  const manual = elements.find((element) => !isEdge(element) && (element.data as NodeData)?.blockType === 'manual');
  const data = stage && !isEdge(stage) ? (stage.data as NodeData) : null;
  const manualData = manual && !isEdge(manual) ? (manual.data as NodeData) : null;
  const compact = useMediaQuery(COMPACT_LAYOUT);
  const [open, setOpen] = useState(() => (typeof window === 'undefined' ? true : !window.matchMedia(COMPACT_LAYOUT).matches));
  const wasCompact = useRef(compact);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => telemetry.subscribe(() => setTick((value) => value + 1)), []);

  useEffect(() => {
    if (compact && !wasCompact.current) setOpen(false);
    wasCompact.current = compact;
  }, [compact]);

  const config = data ? parseStageConfig(data.parameters) : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data || !open || !stage || !config) return;
    const live = telemetry.latest.get(stage.id) ?? {};
    const signals: Record<string, number> = {};
    for (const port of config.inputs) signals[port.id] = live[port.id] ?? 0;
    drawStage(canvas, {
      config,
      signals,
      trail: telemetry.trails.get(stage.id) ?? [],
    });
  }, [config, data, open, stage, tick]);

  if (!data || !stage || !config) return null;

  const live = telemetry.latest.get(stage.id) ?? {};
  const manualValue = Number(manualData?.parameters.value ?? 0);
  const manualMin = Number(manualData?.parameters.min ?? -25);
  const manualMax = Number(manualData?.parameters.max ?? 25);

  return (
    <section className={`dock ${open ? 'open' : ''}`}>
      <div className="dock-bar">
        <button onClick={() => setOpen((value) => !value)}>{open ? 'Hide stage' : 'Show stage'}</button>
        <strong>Stage</strong>
        <span>Scene driven by wired signals — edit inputs / scene / nudge on the Stage block.</span>
      </div>
      {open ? (
        <div className="dock-body">
          <canvas ref={canvasRef} className="stage-canvas" />
          <div className="readouts">
            <div className="stats">
              <Stat label="t" value={`${time.toFixed(2)} s`} />
              {config.readouts.map((item) => {
                const raw = live[item.port] ?? 0;
                const value = item.format === 'deg' ? `${((raw * 180) / Math.PI).toFixed(1)}°` : raw.toFixed(3);
                return <Stat key={`${item.label}-${item.port}`} label={item.label} value={value} />;
              })}
            </div>
            <p className="hint">Readouts and nudge buttons come from Stage parameters — no demo-specific UI.</p>
            {manual && manualData ? (
              <label className="slider">
                <span>Manual {manualValue.toFixed(1)}</span>
                <input
                  type="range"
                  min={manualMin}
                  max={manualMax}
                  step={0.1}
                  value={manualValue}
                  onChange={(event) => updateParam(manual.id, 'value', Number(event.target.value))}
                />
              </label>
            ) : null}
            {config.nudge.length ? (
              <div className="nudge-row">
                {config.nudge.map((item) => (
                  <button key={item.label} onClick={() => nudgeState(item.index, item.amount, config.nudgePlant || undefined)}>
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
