import React, { useEffect, useRef, useState } from 'react';
import { telemetry } from '../engine/telemetry';
import { isEdge, NodeData } from '../model/elements';
import { nudgePlant } from '../sim/controller';
import { useStore } from '../store';
import { COMPACT_LAYOUT, useMediaQuery } from '../ui';
import { drawStage, emptyStageView } from './draw';

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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data || !open || !stage) return;
    const live = telemetry.latest.get(stage.id) ?? {};
    drawStage(
      canvas,
      emptyStageView({
        visual: String(data.parameters.visual ?? 'cart-pendulum'),
        x: live.x ?? 0,
        th1: live.th1 ?? 0,
        th2: live.th2 ?? 0,
        theta: live.theta ?? live.w ?? 0,
        level: live.level ?? live.p ?? 0,
        flow: live.flow ?? live.q ?? 0,
        v: live.v ?? 0,
        torque: live.torque ?? live.T ?? 0,
        l1: Number(data.parameters.l1 ?? 0.4),
        l2: Number(data.parameters.l2 ?? 0.4),
        force: live.force ?? 0,
        radius: Number(data.parameters.radius ?? 0.35),
        capacity: Number(data.parameters.capacity ?? 5),
        stroke: Number(data.parameters.stroke ?? 0.5),
        trail: telemetry.trails.get(stage.id) ?? [],
      })
    );
  }, [data, open, stage, tick]);

  if (!data || !stage) return null;

  const live = telemetry.latest.get(stage.id) ?? {};
  const visual = String(data.parameters.visual ?? 'cart-pendulum');
  const manualValue = Number(manualData?.parameters.value ?? 0);
  const manualMin = Number(manualData?.parameters.min ?? -25);
  const manualMax = Number(manualData?.parameters.max ?? 25);

  return (
    <section className={`dock ${open ? 'open' : ''}`}>
      <div className="dock-bar">
        <button onClick={() => setOpen((value) => !value)}>{open ? 'Hide stage' : 'Show stage'}</button>
        <strong>Stage</strong>
        <span>{visual} animation from wired plant / sensor signals.</span>
      </div>
      {open ? (
        <div className="dock-body">
          <canvas ref={canvasRef} className="stage-canvas" />
          <div className="readouts">
            <div className="stats">
              <Stat label="t" value={`${time.toFixed(2)} s`} />
              {visual === 'cart-pendulum' ? (
                <>
                  <Stat label="x" value={`${(live.x ?? 0).toFixed(3)}`} />
                  <Stat label="θ₁" value={`${(((live.th1 ?? 0) * 180) / Math.PI).toFixed(1)}°`} />
                  <Stat label="θ₂" value={`${(((live.th2 ?? 0) * 180) / Math.PI).toFixed(1)}°`} />
                  <Stat label="F" value={`${(live.force ?? 0).toFixed(2)}`} />
                </>
              ) : null}
              {visual === 'rotor' ? (
                <>
                  <Stat label="θ" value={`${(((live.theta ?? 0) * 180) / Math.PI).toFixed(1)}°`} />
                  <Stat label="T" value={`${(live.torque ?? 0).toFixed(3)}`} />
                </>
              ) : null}
              {visual === 'tank' ? (
                <>
                  <Stat label="level" value={`${(live.level ?? 0).toFixed(2)}`} />
                  <Stat label="q" value={`${(live.flow ?? 0).toFixed(3)}`} />
                </>
              ) : null}
              {visual === 'piston' || visual === 'mass-spring' ? (
                <>
                  <Stat label="x" value={`${(live.x ?? 0).toFixed(3)}`} />
                  <Stat label={visual === 'mass-spring' ? 'v' : 'F'} value={`${((visual === 'mass-spring' ? live.v : live.force) ?? 0).toFixed(3)}`} />
                </>
              ) : null}
            </div>
            <p className="hint">Change the Stage visual in Properties. Plant builder recipes wire sensors and animation for you.</p>
            {manual && manualData ? (
              <label className="slider">
                <span>Hand force {manualValue.toFixed(1)}</span>
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
            {visual === 'cart-pendulum' ? (
              <div className="nudge-row">
                <button onClick={() => nudgePlant('th1')}>Tip θ₁</button>
                <button onClick={() => nudgePlant('th2')}>Tip θ₂</button>
                <button onClick={() => nudgePlant('cart')}>Shove cart</button>
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
