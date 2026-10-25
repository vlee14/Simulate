import React, { useEffect, useState } from 'react';
import { pendulumEnergy, readPendulumParams } from '../engine/physics';
import { telemetry } from '../engine/telemetry';
import { isEdge, NodeData } from '../model/elements';
import { nudgePlant } from '../sim/controller';
import { useStore } from '../store';
import { drawStage } from './draw';

export const Dock: React.FC = () => {
  const elements = useStore((state) => state.elements);
  const time = useStore((state) => state.time);
  const updateParam = useStore((state) => state.updateParam);
  const plant = elements.find((element) => !isEdge(element) && (element.data as NodeData)?.blockType === 'pendulum');
  const manual = elements.find((element) => !isEdge(element) && (element.data as NodeData)?.blockType === 'manual');
  const data = plant && !isEdge(plant) ? (plant.data as NodeData) : null;
  const manualData = manual && !isEdge(manual) ? (manual.data as NodeData) : null;
  const [open, setOpen] = useState(true);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => telemetry.subscribe(() => setTick((value) => value + 1)), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data || !open) return;
    const params = readPendulumParams(data.parameters);
    const live = telemetry.latest.get(data ? plant!.id : '');
    drawStage(canvas, {
      x: live?.x ?? Number(data.parameters.x0 ?? 0),
      th1: live?.th1 ?? Number(data.parameters.th1_0 ?? 0),
      th2: live?.th2 ?? Number(data.parameters.th2_0 ?? 0),
      l1: params.l1,
      l2: params.l2,
      force: live?.force ?? 0,
      trail: plant ? telemetry.trails.get(plant.id) ?? [] : [],
    });
  }, [data, open, plant, tick]);

  const params = data ? readPendulumParams(data.parameters) : null;
  const live = data && plant ? telemetry.latest.get(plant.id) : undefined;
  const state = [
    live?.x ?? Number(data?.parameters.x0 ?? 0),
    live?.th1 ?? Number(data?.parameters.th1_0 ?? 0),
    live?.th2 ?? Number(data?.parameters.th2_0 ?? 0),
    live?.dx ?? Number(data?.parameters.dx0 ?? 0),
    live?.w1 ?? Number(data?.parameters.w1_0 ?? 0),
    live?.w2 ?? Number(data?.parameters.w2_0 ?? 0),
  ];
  const energy = params ? pendulumEnergy(state, params) : null;
  if (!data || !params) return null;

  const manualValue = Number(manualData?.parameters.value ?? 0);
  const manualMin = Number(manualData?.parameters.min ?? -25);
  const manualMax = Number(manualData?.parameters.max ?? 25);

  return (
    <section className={`dock ${open ? 'open' : ''}`}>
      <div className="dock-bar">
        <button onClick={() => setOpen((value) => !value)}>{open ? 'Hide stage' : 'Show stage'}</button>
        <strong>Stage</strong>
        <span>The cart has to drive underneath the links. Upright is the unstable equilibrium.</span>
      </div>
      {open && data && params ? (
        <div className="dock-body">
          <canvas ref={canvasRef} className="stage-canvas" />
          <div className="readouts">
            <div className="stats">
              <Stat label="t" value={`${time.toFixed(2)} s`} />
              <Stat label="x" value={`${state[0].toFixed(3)} m`} />
              <Stat label="θ₁" value={`${((state[1] * 180) / Math.PI).toFixed(2)}°`} />
              <Stat label="θ₂" value={`${((state[2] * 180) / Math.PI).toFixed(2)}°`} />
              <Stat label="F" value={`${(live?.force ?? 0).toFixed(2)} N`} />
              <Stat label="Energy" value={`${energy ? energy.total.toFixed(3) : '—'} J`} />
            </div>
            <p className="hint">Energy is measured from the upright rest position, so a balanced pendulum sits near zero.</p>
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
