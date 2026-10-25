import React, { useEffect, useRef } from 'react';
import { Handle, NodeProps, Position } from 'react-flow-renderer';
import { getBlock } from '../engine/blocks';
import { readPendulumParams } from '../engine/physics';
import { SIGNAL_COLORS } from '../engine/types';
import { telemetry } from '../engine/telemetry';
import { isEdge, NodeData } from '../model/elements';
import { useStore } from '../store';
import { drawScope, drawStage, drawXY, ScopeSeries } from './draw';
import { DiagramBlock } from './shapes';

function useFrame(draw: () => void, deps: React.DependencyList): React.RefObject<HTMLCanvasElement> {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const render = () => draw();
    render();
    const off = telemetry.subscribe(render);
    const observer = new ResizeObserver(render);
    observer.observe(canvas);
    return () => {
      off();
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

function Ports({
  inputs,
  outputs,
  labeled = true,
}: {
  inputs: { id: string; name: string }[];
  outputs: { id: string; name: string }[];
  labeled?: boolean;
}) {
  return (
    <>
      {inputs.map((port, index) => (
        <Handle
          key={port.id}
          type="target"
          position={Position.Left}
          id={port.id}
          title={port.name}
          style={{ top: `${((index + 1) / (Math.max(inputs.length, 1) + 1)) * 100}%` }}
        />
      ))}
      {outputs.map((port, index) => (
        <Handle
          key={port.id}
          type="source"
          position={Position.Right}
          id={port.id}
          title={port.name}
          style={{ top: `${((index + 1) / (Math.max(outputs.length, 1) + 1)) * 100}%` }}
        />
      ))}
      {labeled ? (
        <>
          <div className="port-labels in">
            {inputs.map((port) => (
              <span key={port.id}>{port.name}</span>
            ))}
          </div>
          <div className="port-labels out">
            {outputs.map((port) => (
              <span key={port.id}>{port.name === 'out' ? '' : port.name}</span>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}

export const SimNode: React.FC<NodeProps> = ({ id, data, selected }) => {
  const info = data as NodeData;
  const def = getBlock(info.blockType);
  const bad = useStore((state) => state.errorIds.includes(id));
  if (!def) return null;
  const ports = safePorts(def, info.parameters);
  return (
    <DiagramBlock
      blockType={info.blockType}
      alias={info.alias || def.name}
      parameters={info.parameters}
      inputs={ports.inputs}
      outputs={ports.outputs}
      selected={!!selected}
      bad={bad}
    />
  );
};

export const NoteNode: React.FC<NodeProps> = ({ data, selected }) => {
  const info = data as NodeData;
  return <div className={`note ${selected ? 'is-selected' : ''}`}>{String(info.parameters.text ?? '')}</div>;
};

export const MeterNode: React.FC<NodeProps> = ({ id, data, selected }) => {
  const info = data as NodeData;
  const def = getBlock(info.blockType);
  const [value, setValue] = React.useState<number | null>(null);
  useEffect(() => telemetry.subscribe(() => {
    const sample = telemetry.series.get(telemetry.key(id, 'in'))?.last();
    setValue(sample ? sample.y : null);
  }), [id]);
  const digits = Math.max(0, Math.min(6, Number(info.parameters.digits ?? 3)));
  const shown = value === null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
  const alias = info.alias || def?.name || 'Value';
  return (
    <div className={`sl ${selected ? 'is-selected' : ''}`} style={{ width: 92 }}>
      <div className="sl-body display-face" style={{ height: 36 }}>
        <Ports inputs={[{ id: 'in', name: 'in' }]} outputs={[]} labeled={false} />
        <div className="display-value">{shown}</div>
      </div>
      <div className="sl-caption" title={alias}>
        {alias}
      </div>
    </div>
  );
};

export const ScopeNode: React.FC<NodeProps> = ({ id, data, selected }) => {
  const info = data as NodeData;
  const elements = useStore((state) => state.elements);
  const time = useStore((state) => state.time);
  const def = getBlock('scope');
  const ports = def ? safePorts(def, info.parameters) : { inputs: [], outputs: [] };
  const labels = ports.inputs.map((port) => sourceAlias(elements, id, port.id) ?? port.name);
  const auto = info.parameters.autoScale !== false;
  const span = Number(info.parameters.timeSpan) || 10;
  const yMin = Number(info.parameters.yMin) || -1;
  const yMax = Number(info.parameters.yMax) || 1;
  const ref = useFrame(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const series: ScopeSeries[] = ports.inputs.map((port, index) => ({
      label: labels[index] || port.name,
      color: SIGNAL_COLORS[index % SIGNAL_COLORS.length],
      ring: telemetry.series.get(telemetry.key(id, port.id)),
    }));
    const now = telemetry.series.get(telemetry.key(id, ports.inputs[0]?.id ?? 'in0'))?.last()?.t ?? time;
    drawScope(canvas, series, { timeSpan: span, now, auto, yMin, yMax });
  }, [id, labels.join('|'), auto, span, yMin, yMax, time]);
  return (
    <div className={`instrument ${selected ? 'is-selected' : ''}`}>
      <Ports inputs={ports.inputs} outputs={[]} labeled={false} />
      <div className="instrument-head">
        <span>{info.alias || 'Scope'}</span>
        <span>{span.toFixed(0)} s</span>
      </div>
      <canvas ref={ref} className="instrument-canvas" />
    </div>
  );
};

export const XYNode: React.FC<NodeProps> = ({ id, data, selected }) => {
  const info = data as NodeData;
  const time = useStore((state) => state.time);
  const span = Number(info.parameters.timeSpan) || 10;
  const ref = useFrame(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const now = telemetry.series.get(telemetry.key(id, 'x'))?.last()?.t ?? time;
    drawXY(canvas, telemetry.series.get(telemetry.key(id, 'x')), telemetry.series.get(telemetry.key(id, 'y')), span, now);
  }, [id, span, time]);
  return (
    <div className={`instrument xy ${selected ? 'is-selected' : ''}`}>
      <Ports inputs={[{ id: 'x', name: 'x' }, { id: 'y', name: 'y' }]} outputs={[]} labeled={false} />
      <div className="instrument-head">
        <span>{info.alias || 'XY'}</span>
      </div>
      <canvas ref={ref} className="instrument-canvas" />
    </div>
  );
};

export const PlantNode: React.FC<NodeProps> = ({ id, data, selected }) => {
  const info = data as NodeData;
  const bad = useStore((state) => state.errorIds.includes(id));
  const def = getBlock('pendulum');
  const ports = def ? safePorts(def, info.parameters) : { inputs: [], outputs: [] };
  const paramKey = JSON.stringify(info.parameters);
  const ref = useFrame(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const params = readPendulumParams(info.parameters);
    const live = telemetry.latest.get(id);
    drawStage(canvas, {
      x: live?.x ?? Number(info.parameters.x0 ?? 0),
      th1: live?.th1 ?? Number(info.parameters.th1_0 ?? 0),
      th2: live?.th2 ?? Number(info.parameters.th2_0 ?? 0),
      l1: params.l1,
      l2: params.l2,
      force: live?.force ?? 0,
      trail: telemetry.trails.get(id) ?? [],
    });
  }, [id, paramKey]);
  return (
    <div className={`plant ${selected ? 'is-selected' : ''} ${bad ? 'is-bad' : ''}`}>
      <Ports inputs={ports.inputs} outputs={ports.outputs} />
      <div className="instrument-head">
        <span>{info.alias || 'Double pendulum'}</span>
        <span>upright = 0</span>
      </div>
      <canvas ref={ref} className="plant-canvas" />
    </div>
  );
};

function safePorts(def: NonNullable<ReturnType<typeof getBlock>>, parameters: NodeData['parameters']) {
  try {
    return def.ports(parameters);
  } catch {
    return { inputs: [{ id: 'in', name: 'in' }], outputs: [{ id: 'out', name: 'out' }] };
  }
}

function sourceAlias(elements: ReturnType<typeof useStore.getState>['elements'], target: string, handle: string): string | null {
  const edge = elements.find((element) => isEdge(element) && element.target === target && element.targetHandle === handle);
  if (!edge || !isEdge(edge)) return null;
  const source = elements.find((element) => element.id === edge.source && !isEdge(element));
  if (!source || isEdge(source)) return null;
  return (source.data as NodeData | undefined)?.alias ?? null;
}

export const nodeTypes = {
  sim: SimNode,
  note: NoteNode,
  meter: MeterNode,
  scope: ScopeNode,
  xy: XYNode,
  plant: PlantNode,
};
