import React, { useEffect, useRef, useState } from 'react';
import { canvasToWorld, hitTestStage, parseStageConfig, StageCamera, StageDisturbance } from '../engine/scene';
import { telemetry } from '../engine/telemetry';
import { isEdge, NodeData } from '../model/elements';
import { fireDisturbance, nudgeState, setControlValue } from '../sim/controller';
import { useStore } from '../store';
import { COMPACT_LAYOUT, useMediaQuery } from '../ui';
import { drawStage, stageCameraFor } from './draw';

export const Dock: React.FC = () => {
  const elements = useStore((state) => state.elements);
  const time = useStore((state) => state.time);
  const stage = elements.find((element) => !isEdge(element) && (element.data as NodeData)?.blockType === 'stage');
  const data = stage && !isEdge(stage) ? (stage.data as NodeData) : null;
  const compact = useMediaQuery(COMPACT_LAYOUT);
  const [open, setOpen] = useState(() => (typeof window === 'undefined' ? true : !window.matchMedia(COMPACT_LAYOUT).matches));
  const wasCompact = useRef(compact);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef<StageCamera | null>(null);
  const [tick, setTick] = useState(0);
  const dragRef = useRef<{ mode: 'control' | 'idle'; lastX: number } | null>(null);
  const keysRef = useRef({ left: false, right: false });

  useEffect(() => telemetry.subscribe(() => setTick((value) => value + 1)), []);

  useEffect(() => {
    if (compact && !wasCompact.current) setOpen(false);
    wasCompact.current = compact;
  }, [compact]);

  const config = data ? parseStageConfig(data.parameters) : null;
  const control = config?.control ?? null;
  const controlNode = control
    ? elements.find((element) => {
        if (isEdge(element)) return false;
        const node = element.data as NodeData;
        return element.id === control.block || node.role === control.block;
      })
    : null;
  const controlData = controlNode && !isEdge(controlNode) ? (controlNode.data as NodeData) : null;
  const controlValue = Number(controlData?.parameters.value ?? 0);

  // New Stage document → drop prior demo's camera so framing does not linger.
  useEffect(() => {
    cameraRef.current = null;
  }, [stage?.id]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data || !open || !stage || !config) return;
    const live = telemetry.latest.get(stage.id) ?? {};
    const signals: Record<string, number> = {};
    for (const port of config.inputs) signals[port.id] = live[port.id] ?? 0;
    const camera = drawStage(canvas, {
      config,
      signals,
      trail: telemetry.trails.get(stage.id) ?? [],
    });
    if (camera) cameraRef.current = camera;
  }, [config, data, open, stage, tick]);

  // Arrow-key hold → control (when Stage is open and a control binding exists).
  useEffect(() => {
    if (!open || !control) return;
    const applyKeys = () => {
      const { left, right } = keysRef.current;
      if (left === right) {
        if (control.spring) setControlValue(control.block, 0);
        return;
      }
      setControlValue(control.block, left ? control.min : control.max);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (event.key === 'ArrowLeft' || event.key === 'a' || event.key === 'A') {
        keysRef.current.left = true;
        event.preventDefault();
        applyKeys();
      } else if (event.key === 'ArrowRight' || event.key === 'd' || event.key === 'D') {
        keysRef.current.right = true;
        event.preventDefault();
        applyKeys();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft' || event.key === 'a' || event.key === 'A') {
        keysRef.current.left = false;
        applyKeys();
      } else if (event.key === 'ArrowRight' || event.key === 'd' || event.key === 'D') {
        keysRef.current.right = false;
        applyKeys();
      }
    };
    const onBlur = () => {
      keysRef.current = { left: false, right: false };
      if (control.spring) setControlValue(control.block, 0);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      keysRef.current = { left: false, right: false };
      if (control.spring) setControlValue(control.block, 0);
    };
  }, [open, control]);

  if (!data || !stage || !config) return null;

  const live = telemetry.latest.get(stage.id) ?? {};
  const hasControls = !!(control || config.disturbance.length || config.nudge.length || config.interact.some((item) => item.kind === 'nudge'));

  const worldFromPointer = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return null;
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const camera =
      cameraRef.current ??
      stageCameraFor(canvas) ??
      ({
        scale: config.scale ?? 100,
        lookX: 0,
        lookY: 0,
        originX: rect.width * 0.5,
        originY: rect.height * 0.72,
      } satisfies StageCamera);
    const world = canvasToWorld(camera, px, py);
    return {
      x: world.x,
      y: world.y,
      px,
      width: rect.width,
    };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!config) return;
    const world = worldFromPointer(event.clientX, event.clientY);
    if (!world) return;
    const signals: Record<string, number> = {};
    for (const port of config.inputs) signals[port.id] = live[port.id] ?? 0;
    const hit = hitTestStage(config, signals, world.x, world.y);
    (event.currentTarget as HTMLCanvasElement).setPointerCapture(event.pointerId);
    if (hit?.kind === 'nudge') {
      nudgeState(hit.index, hit.amount, config.nudgePlant || undefined);
      dragRef.current = { mode: 'idle', lastX: event.clientX };
      return;
    }
    if (control && (hit?.kind === 'control' || !hit || hit.target === '*')) {
      dragRef.current = { mode: 'control', lastX: event.clientX };
      const frac = Math.max(-1, Math.min(1, (world.px - world.width * 0.5) / (world.width * 0.42)));
      const span = control.max - control.min;
      const mid = (control.max + control.min) / 2;
      // Prefer drag direction around center; map pointer x into [min,max].
      setControlValue(control.block, mid + frac * (span / 2));
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!control || dragRef.current?.mode !== 'control') return;
    const world = worldFromPointer(event.clientX, event.clientY);
    if (!world) return;
    const frac = Math.max(-1, Math.min(1, (world.px - world.width * 0.5) / (world.width * 0.42)));
    const span = control.max - control.min;
    const mid = (control.max + control.min) / 2;
    setControlValue(control.block, mid + frac * (span / 2));
    dragRef.current.lastX = event.clientX;
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.mode === 'control' && control?.spring) {
      setControlValue(control.block, 0);
    }
    dragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
  };

  const kick = (item: StageDisturbance) => {
    fireDisturbance(item, config.nudgePlant || undefined);
  };

  return (
    <section className={`dock ${open ? 'open' : ''}`}>
      <div className="dock-bar">
        <button onClick={() => setOpen((value) => !value)}>{open ? 'Hide stage' : 'Show stage'}</button>
        <strong>Stage</strong>
        <span>
          {control
            ? `${control.label}: drag stage · ←/→ keys · hold buttons. Disturbances fire pulses or state kicks.`
            : 'Scene, control, and disturbance bindings come from Stage parameters.'}
        </span>
      </div>
      {open ? (
        <div className="dock-body">
          <canvas
            ref={canvasRef}
            className={`stage-canvas${control || config.interact.length ? ' interactive' : ''}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
          <div className="readouts">
            <div className="stats">
              <Stat label="t" value={`${time.toFixed(2)} s`} />
              {config.readouts.map((item) => {
                const raw = live[item.port] ?? 0;
                const value = item.format === 'deg' ? `${((raw * 180) / Math.PI).toFixed(1)}°` : raw.toFixed(3);
                return <Stat key={`${item.label}-${item.port}`} label={item.label} value={value} />;
              })}
            </div>

            {hasControls ? (
              <div className="stage-controls">
                {control ? (
                  <div className="control-panel">
                    <div className="control-head">
                      <span>{control.label}</span>
                      <strong>{controlValue.toFixed(1)}</strong>
                    </div>
                    <div className="hold-row">
                      <button
                        type="button"
                        onPointerDown={(event) => {
                          event.preventDefault();
                          setControlValue(control.block, control.min);
                        }}
                        onPointerUp={() => control.spring && setControlValue(control.block, 0)}
                        onPointerLeave={() => control.spring && setControlValue(control.block, 0)}
                      >
                        ← Hold
                      </button>
                      <button
                        type="button"
                        onPointerDown={(event) => {
                          event.preventDefault();
                          setControlValue(control.block, control.max);
                        }}
                        onPointerUp={() => control.spring && setControlValue(control.block, 0)}
                        onPointerLeave={() => control.spring && setControlValue(control.block, 0)}
                      >
                        Hold →
                      </button>
                      {control.spring ? (
                        <button type="button" className="ghost" onClick={() => setControlValue(control.block, 0)}>
                          Zero
                        </button>
                      ) : null}
                    </div>
                    <label className="slider">
                      <input
                        type="range"
                        min={control.min}
                        max={control.max}
                        step={(control.max - control.min) / 200 || 0.1}
                        value={controlValue}
                        onChange={(event) => setControlValue(control.block, Number(event.target.value))}
                        onPointerUp={() => control.spring && setControlValue(control.block, 0)}
                      />
                    </label>
                  </div>
                ) : null}

                {config.disturbance.length ? (
                  <div className="nudge-row disturbance-row">
                    {config.disturbance.map((item) => (
                      <button key={item.label} type="button" onClick={() => kick(item)}>
                        {item.label}
                      </button>
                    ))}
                  </div>
                ) : null}

                {config.nudge.length ? (
                  <div className="nudge-row">
                    {config.nudge.map((item) => (
                      <button key={item.label} type="button" onClick={() => nudgeState(item.index, item.amount, config.nudgePlant || undefined)}>
                        {item.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="hint">Add Stage controls for live UI.</p>
            )}
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
