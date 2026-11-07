import React, { useEffect, useRef, useState } from 'react';
import { telemetry } from '../engine/telemetry';
import { isEdge, NodeData } from '../model/elements';
import { cartPendulumLengths } from '../model/plants';
import { nudgePlant } from '../sim/controller';
import { useStore } from '../store';
import { COMPACT_LAYOUT, useMediaQuery } from '../ui';
import { drawStage } from './draw';

export const Dock: React.FC = () => {
  const elements = useStore((state) => state.elements);
  const time = useStore((state) => state.time);
  const updateParam = useStore((state) => state.updateParam);
  const stage = elements.find((element) => !isEdge(element) && (element.data as NodeData)?.blockType === 'stage');
  const plant = elements.find((element) => !isEdge(element) && (element.data as NodeData)?.blockType === 'ode');
  const manual = elements.find((element) => !isEdge(element) && (element.data as NodeData)?.blockType === 'manual');
  const data = stage && !isEdge(stage) ? (stage.data as NodeData) : null;
  const plantData = plant && !isEdge(plant) ? (plant.data as NodeData) : null;
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data || !open || !stage) return;
    const live = telemetry.latest.get(stage.id);
    const lengths =
      plantData && typeof plantData.parameters.constants === 'string'
        ? cartPendulumLengths(plantData.parameters.constants)
        : { l1: Number(data.parameters.l1 ?? 0.4), l2: Number(data.parameters.l2 ?? 0.4) };
    drawStage(canvas, {
      x: live?.x ?? 0,
      th1: live?.th1 ?? 0,
      th2: live?.th2 ?? 0,
      l1: Number(data.parameters.l1 ?? lengths.l1),
      l2: Number(data.parameters.l2 ?? lengths.l2),
      force: live?.force ?? 0,
      trail: telemetry.trails.get(stage.id) ?? [],
    });
  }, [data, open, plantData, stage, tick]);

  if (!data || !stage) return null;

  const live = telemetry.latest.get(stage.id);
  const x = live?.x ?? 0;
  const th1 = live?.th1 ?? 0;
  const th2 = live?.th2 ?? 0;
  const force = live?.force ?? 0;
  const manualValue = Number(manualData?.parameters.value ?? 0);
  const manualMin = Number(manualData?.parameters.min ?? -25);
  const manualMax = Number(manualData?.parameters.max ?? 25);

  return (
    <section className={`dock ${open ? 'open' : ''}`}>
      <div className="dock-bar">
        <button onClick={() => setOpen((value) => !value)}>{open ? 'Hide stage' : 'Show stage'}</button>
        <strong>Stage</strong>
        <span>Visualization sink for cart–pendulum signals from any Dynamics plant.</span>
      </div>
      {open ? (
        <div className="dock-body">
          <canvas ref={canvasRef} className="stage-canvas" />
          <div className="readouts">
            <div className="stats">
              <Stat label="t" value={`${time.toFixed(2)} s`} />
              <Stat label="x" value={`${x.toFixed(3)} m`} />
              <Stat label="θ₁" value={`${((th1 * 180) / Math.PI).toFixed(2)}°`} />
              <Stat label="θ₂" value={`${((th2 * 180) / Math.PI).toFixed(2)}°`} />
              <Stat label="F" value={`${force.toFixed(2)} N`} />
            </div>
            <p className="hint">Wire plant states into the Stage sink. Tip / shove nudges the ODE plant state.</p>
            {manual && manualData ? (
              <label className="slider">
                <span>Hand force {manualValue.toFixed(1)} N</span>
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
            <div className="nudge-row">
              <button onClick={() => nudgePlant('th1')}>Tip θ₁</button>
              <button onClick={() => nudgePlant('th2')}>Tip θ₂</button>
              <button onClick={() => nudgePlant('cart')}>Shove cart</button>
            </div>
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
