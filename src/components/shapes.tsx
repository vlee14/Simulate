import React from 'react';
import { Handle, Position } from 'react-flow-renderer';
import { formatCompact } from '../engine/blocks';
import { Param } from '../engine/types';

interface PortRef {
  id: string;
  name: string;
}

interface Point {
  x: number;
  y: number;
  label?: { x: number; y: number; text: string; kind: 'sign' | 'port'; align?: 'right' };
}

type Shape = 'triangle' | 'circle' | 'rect';

interface GlyphSpec {
  kind: 'text' | 'fraction' | 'stack' | 'icon';
  text?: string;
  num?: string;
  den?: string;
  lines?: string[];
  icon?: 'saturation' | 'deadzone' | 'switch' | 'step' | 'sine' | 'ramp' | 'pulse' | 'zoh' | 'clock';
  large?: boolean;
}

interface Face {
  shape: Shape;
  width: number;
  height: number;
  glyph: GlyphSpec | null;
  inputs: Point[];
  outputs: Point[];
  insetGlyph: boolean;
}

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';

function asNumber(value: Param | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asText(value: Param | undefined, fallback: string): string {
  return value === undefined ? fallback : String(value);
}

function superscript(n: number): string {
  return String(n)
    .split('')
    .map((digit) => SUP[Number(digit)] ?? digit)
    .join('');
}

function formatPoly(raw: string): string {
  const parts = raw
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  if (parts.length === 0 || parts.some((value) => !Number.isFinite(value))) return raw.trim() || '0';
  const order = parts.length - 1;
  const terms: string[] = [];
  parts.forEach((coef, index) => {
    if (Math.abs(coef) < 1e-12) return;
    const power = order - index;
    const negative = coef < 0;
    const magnitude = Math.abs(coef);
    const coefText = Math.abs(magnitude - 1) < 1e-9 && power > 0 ? '' : formatCompact(magnitude);
    const variable = power === 0 ? '' : power === 1 ? 's' : `s${superscript(power)}`;
    const body = `${coefText}${variable}` || '1';
    if (terms.length === 0) terms.push(negative ? `−${body}` : body);
    else terms.push(negative ? ` − ${body}` : ` + ${body}`);
  });
  return terms.join('') || '0';
}

function mathLabel(fn: string): string {
  switch (fn) {
    case 'abs':
      return '|u|';
    case 'sqrt':
      return '√u';
    case 'square':
      return 'u²';
    case 'exp':
      return 'eᵘ';
    case 'ln':
      return 'ln u';
    case 'neg':
      return '−u';
    default:
      return fn;
  }
}

function signText(name: string): string {
  if (name === '*') return '×';
  if (name === '/') return '÷';
  if (name === '-') return '−';
  return name;
}

function spreadY(count: number, height: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [height / 2];
  const pad = Math.max(11, Math.min(14, height / (count + 1)));
  const span = height - pad * 2;
  return Array.from({ length: count }, (_, index) => pad + (span * index) / (count - 1));
}

function fan(count: number): number {
  if (count <= 1) return 0;
  return Math.min(Math.PI * 0.98, 1.2 + (count - 1) * 0.38);
}

function circleSize(count: number): number {
  const n = Math.max(count, 1);
  if (n === 1) return 52;
  const spread = fan(n);
  const signRadius = 20 / (spread / (n - 1));
  const radius = Math.max(28, signRadius + 14);
  return Math.round(radius * 2 + 4);
}

/** Angle 0 points right. Positive angles run downward, matching screen y. */
function circleInputs(count: number, size: number): Point[] {
  const center = size / 2;
  const radius = size / 2 - 1.4;
  if (count <= 0) return [];
  const place = (angle: number): Point => {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const signRadius = Math.max(12, radius - 14);
    return {
      x: center + radius * cos,
      y: center + radius * sin,
      label: {
        x: center + signRadius * cos,
        y: center + signRadius * sin,
        text: '',
        kind: 'sign',
      },
    };
  };
  if (count === 1) return [place(Math.PI)];
  const spread = fan(count);
  const start = Math.PI + spread / 2;
  const end = Math.PI - spread / 2;
  return Array.from({ length: count }, (_, index) => place(start + ((end - start) * index) / (count - 1)));
}

function sidePorts(width: number, height: number, inputs: PortRef[], outputs: PortRef[], labeled: boolean): { inputs: Point[]; outputs: Point[] } {
  const inputY = spreadY(inputs.length, height);
  const outputY = spreadY(outputs.length, height);
  return {
    inputs: inputs.map((port, index) => ({
      x: 0,
      y: inputY[index],
      label: labeled
        ? { x: 8, y: inputY[index], text: port.name, kind: 'port' as const }
        : undefined,
    })),
    outputs: outputs.map((port, index) => ({
      x: width,
      y: outputY[index],
      label:
        labeled && port.name && port.name !== 'out'
          ? { x: width - 8, y: outputY[index], text: port.name, kind: 'port' as const, align: 'right' as const }
          : undefined,
    })),
  };
}

function textWidth(text: string, perChar = 7.1, min = 64, max = 220): number {
  return Math.max(min, Math.min(max, Math.round(28 + text.length * perChar)));
}

function faceFor(blockType: string, parameters: Record<string, Param>, inputs: PortRef[], outputs: PortRef[]): Face {
  const rows = Math.max(inputs.length, outputs.length, 1);
  const tall = Math.max(44, 14 + rows * 16);

  if (blockType === 'gain') {
    const text = formatCompact(asNumber(parameters.k, 1));
    const width = textWidth(text, 8.2, 86, 168);
    const height = 46;
    return {
      shape: 'triangle',
      width,
      height,
      glyph: { kind: 'text', text, large: true },
      inputs: [{ x: 0, y: height / 2 }],
      outputs: [{ x: width, y: height / 2 }],
      insetGlyph: false,
    };
  }

  if (blockType === 'sum' || blockType === 'product') {
    const size = circleSize(inputs.length);
    const placed = circleInputs(inputs.length, size);
    return {
      shape: 'circle',
      width: size,
      height: size,
      glyph: null,
      inputs: placed.map((point, index) => ({
        ...point,
        label: point.label ? { ...point.label, text: signText(inputs[index]?.name ?? '') } : undefined,
      })),
      outputs: [{ x: size, y: size / 2 }],
      insetGlyph: false,
    };
  }

  let glyph: GlyphSpec;
  let width = 72;
  let height = blockType === 'transfer' || blockType === 'statespace' ? 60 : 46;

  switch (blockType) {
    case 'integrator':
      glyph = { kind: 'fraction', num: '1', den: 's' };
      width = 62;
      height = 52;
      break;
    case 'derivative':
      glyph = { kind: 'fraction', num: 'du', den: 'dt' };
      width = 62;
      height = 52;
      break;
    case 'delay':
      glyph = { kind: 'fraction', num: '1', den: 'z' };
      width = 62;
      height = 52;
      break;
    case 'transfer': {
      const num = formatPoly(asText(parameters.numerator, '1'));
      const den = formatPoly(asText(parameters.denominator, '1'));
      glyph = { kind: 'fraction', num, den };
      width = textWidth(num.length > den.length ? num : den, 6.8, 96, 240);
      height = 64;
      break;
    }
    case 'statespace':
      glyph = { kind: 'stack', lines: ['ẋ = Ax + Bu', 'y = Cx + Du'] };
      width = 138;
      height = Math.max(58, tall);
      break;
    case 'pid':
      glyph = { kind: 'text', text: 'PID', large: true };
      width = 72;
      height = 46;
      break;
    case 'zoh':
      glyph = { kind: 'icon', icon: 'zoh' };
      width = 72;
      height = 46;
      break;
    case 'saturation':
      glyph = { kind: 'icon', icon: 'saturation' };
      width = 76;
      height = 48;
      break;
    case 'deadzone':
      glyph = { kind: 'icon', icon: 'deadzone' };
      width = 76;
      height = 48;
      break;
    case 'switch':
      glyph = { kind: 'icon', icon: 'switch' };
      width = 84;
      height = Math.max(58, tall);
      break;
    case 'minmax':
      glyph = { kind: 'text', text: asText(parameters.mode, 'max'), large: true };
      width = 72;
      height = Math.max(48, tall);
      break;
    case 'constant':
    case 'manual':
      glyph = { kind: 'text', text: formatCompact(asNumber(parameters.value, 0)), large: true };
      width = textWidth(glyph.text ?? '', 8, 64, 140);
      height = 40;
      break;
    case 'bias':
      glyph = { kind: 'text', text: `+ ${formatCompact(asNumber(parameters.bias, 0))}`, large: true };
      width = textWidth(glyph.text ?? '', 7.4, 68, 140);
      height = 40;
      break;
    case 'math':
      glyph = { kind: 'text', text: mathLabel(asText(parameters.fn, 'sin')), large: true };
      width = textWidth(glyph.text ?? '', 8, 64, 120);
      height = 42;
      break;
    case 'fcn':
      glyph = { kind: 'text', text: asText(parameters.expr, 'u') };
      width = textWidth(glyph.text ?? '', 6.6, 88, 200);
      height = Math.max(44, tall);
      break;
    case 'clock':
      glyph = { kind: 'icon', icon: 'clock' };
      width = 52;
      height = 46;
      break;
    case 'step':
      glyph = { kind: 'icon', icon: 'step' };
      break;
    case 'sine':
      glyph = { kind: 'icon', icon: 'sine' };
      break;
    case 'ramp':
      glyph = { kind: 'icon', icon: 'ramp' };
      break;
    case 'pulse':
      glyph = { kind: 'icon', icon: 'pulse' };
      break;
    default:
      glyph = { kind: 'text', text: blockType };
      width = 96;
      height = tall;
  }

  if (rows > 1) height = Math.max(height, tall);
  const labeled = inputs.length > 1 || outputs.length > 1;
  const ports = sidePorts(width, height, inputs, outputs, labeled);
  return { shape: 'rect', width, height, glyph, insetGlyph: labeled, ...ports };
}

function Outline({ shape, width, height }: { shape: Shape; width: number; height: number }) {
  if (shape === 'triangle') {
    return <path className="sl-outline" d={`M 1.5 1.5 L 1.5 ${height - 1.5} L ${width - 1.6} ${height / 2} Z`} />;
  }
  if (shape === 'circle') {
    return <ellipse className="sl-outline" cx={width / 2} cy={height / 2} rx={width / 2 - 1.4} ry={height / 2 - 1.4} />;
  }
  return <rect className="sl-outline" x="1.2" y="1.2" width={width - 2.4} height={height - 2.4} rx="1" />;
}

function BlockIcon({ name }: { name: NonNullable<GlyphSpec['icon']> }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
  if (name === 'saturation') {
    return (
      <svg width="42" height="26" viewBox="0 0 42 26" aria-hidden="true">
        <path d="M3 22 H12 L29 5 H39" {...common} />
      </svg>
    );
  }
  if (name === 'deadzone') {
    return (
      <svg width="42" height="26" viewBox="0 0 42 26" aria-hidden="true">
        <path d="M3 22 H12" {...common} />
        <path d="M18 17 L39 4" {...common} />
      </svg>
    );
  }
  if (name === 'switch') {
    return (
      <svg width="40" height="28" viewBox="0 0 40 28" aria-hidden="true">
        <path d="M3 5 H14 L26 14 H37" {...common} />
        <path d="M3 23 H14" {...common} />
        <circle cx="14" cy="14" r="1.5" fill="currentColor" />
      </svg>
    );
  }
  if (name === 'step') {
    return (
      <svg width="40" height="24" viewBox="0 0 40 24" aria-hidden="true">
        <path d="M3 20 H16 V5 H37" {...common} />
      </svg>
    );
  }
  if (name === 'sine') {
    return (
      <svg width="40" height="24" viewBox="0 0 40 24" aria-hidden="true">
        <path d="M2 12 C8 12 8 3 14 3 C20 3 20 21 26 21 C32 21 32 12 38 12" {...common} />
      </svg>
    );
  }
  if (name === 'ramp') {
    return (
      <svg width="40" height="24" viewBox="0 0 40 24" aria-hidden="true">
        <path d="M4 20 L36 4" {...common} />
      </svg>
    );
  }
  if (name === 'pulse') {
    return (
      <svg width="40" height="24" viewBox="0 0 40 24" aria-hidden="true">
        <path d="M2 20 H8 V5 H18 V20 H38" {...common} />
      </svg>
    );
  }
  if (name === 'zoh') {
    return (
      <svg width="40" height="24" viewBox="0 0 40 24" aria-hidden="true">
        <path d="M3 20 H12 V13 H21 V6 H37" {...common} />
      </svg>
    );
  }
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
      <circle cx="14" cy="14" r="9" {...common} />
      <path d="M14 14 V8.5 M14 14 L18 16.5" {...common} />
    </svg>
  );
}

function Glyph({ spec }: { spec: GlyphSpec }) {
  if (spec.kind === 'fraction') {
    return (
      <span className="sl-frac">
        <span>{spec.num}</span>
        <span className="sl-bar" />
        <span>{spec.den}</span>
      </span>
    );
  }
  if (spec.kind === 'stack') {
    return (
      <span className="sl-stack">
        {spec.lines?.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </span>
    );
  }
  if (spec.kind === 'icon' && spec.icon) return <BlockIcon name={spec.icon} />;
  return <span className="sl-clip">{spec.text}</span>;
}

export const DiagramBlock: React.FC<{
  blockType: string;
  alias: string;
  parameters: Record<string, Param>;
  inputs: PortRef[];
  outputs: PortRef[];
  selected: boolean;
  bad: boolean;
}> = ({ blockType, alias, parameters, inputs, outputs, selected, bad }) => {
  const face = faceFor(blockType, parameters, inputs, outputs);
  return (
    <div className={`sl shape-${face.shape} ${selected ? 'is-selected' : ''} ${bad ? 'is-bad' : ''}`} style={{ width: face.width }}>
      <div className="sl-body" style={{ width: face.width, height: face.height }}>
        <svg className="sl-svg" viewBox={`0 0 ${face.width} ${face.height}`} aria-hidden="true">
          <Outline shape={face.shape} width={face.width} height={face.height} />
        </svg>
        {face.glyph ? (
          <div className={`sl-glyph ${face.glyph.large ? 'lg' : ''} ${face.insetGlyph ? 'inset' : ''}`}>
            <Glyph spec={face.glyph} />
          </div>
        ) : null}
        {face.inputs.map((point, index) =>
          point.label ? (
            <span
              key={`in-label-${inputs[index]?.id ?? index}`}
              className={point.label.kind === 'sign' ? 'sl-sign' : 'sl-port'}
              style={{ left: point.label.x, top: point.label.y }}
            >
              {point.label.text}
            </span>
          ) : null
        )}
        {face.outputs.map((point, index) =>
          point.label ? (
            <span
              key={`out-label-${outputs[index]?.id ?? index}`}
              className={`sl-port ${point.label.align === 'right' ? 'right' : ''}`}
              style={{ left: point.label.x, top: point.label.y }}
            >
              {point.label.text}
            </span>
          ) : null
        )}
        {inputs.map((port, index) => (
          <Handle
            key={port.id}
            type="target"
            position={Position.Left}
            id={port.id}
            title={port.name}
            style={{ top: face.inputs[index]?.y ?? face.height / 2, left: face.inputs[index]?.x ?? 0, right: 'auto' }}
          />
        ))}
        {outputs.map((port, index) => (
          <Handle
            key={port.id}
            type="source"
            position={Position.Right}
            id={port.id}
            title={port.name}
            style={{ top: face.outputs[index]?.y ?? face.height / 2 }}
          />
        ))}
      </div>
      <div className="sl-caption" title={alias}>
        {alias}
      </div>
    </div>
  );
};

export const ShapeMark: React.FC<{ type: string; color: string }> = ({ type, color }) => {
  const common = { fill: 'none' as const, stroke: color, strokeWidth: 1.4, strokeLinejoin: 'round' as const };
  return (
    <svg className="lib-mark" viewBox="0 0 26 18" aria-hidden="true">
      {type === 'gain' ? (
        <path d="M2 2.2 L2 15.8 L24 9 Z" {...common} />
      ) : type === 'sum' || type === 'product' ? (
        <circle cx="13" cy="9" r="6.6" {...common} />
      ) : (
        <rect x="3.2" y="2.2" width="19.6" height="13.6" rx="1" {...common} />
      )}
    </svg>
  );
};
