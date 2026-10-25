import { useMemo } from 'react';
import { EdgeProps, getMarkerEnd, Position, useStoreState } from 'react-flow-renderer';

interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Pt {
  x: number;
  y: number;
}

const STUB = 22;

function overlaps(box: Box, x1: number, y1: number, x2: number, y2: number, margin: number): boolean {
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const top = Math.min(y1, y2);
  const bottom = Math.max(y1, y2);
  const bx1 = box.x - margin;
  const bx2 = box.x + box.w + margin;
  const by1 = box.y - margin;
  const by2 = box.y + box.h + margin;
  const xSpan = Math.min(right, bx2) - Math.max(left, bx1);
  const ySpan = Math.min(bottom, by2) - Math.max(top, by1);
  const alongX = Math.abs(x1 - x2) < 0.5 ? x1 > bx1 + 0.8 && x1 < bx2 - 0.8 : xSpan > 0.8;
  const alongY = Math.abs(y1 - y2) < 0.5 ? y1 > by1 + 0.8 && y1 < by2 - 0.8 : ySpan > 0.8;
  return alongX && alongY;
}

function segmentClear(boxes: Box[], a: Pt, b: Pt, margin: number, ignore: Set<string>): boolean {
  return boxes.every((box) => ignore.has(box.id) || !overlaps(box, a.x, a.y, b.x, b.y, margin));
}

function pathClear(points: Pt[], boxes: Box[], sourceId: string, targetId: string): boolean {
  for (let i = 0; i < points.length - 1; i++) {
    const ignore = new Set<string>();
    const stub = i === 0 || i === points.length - 2;
    if (i === 0) ignore.add(sourceId);
    if (i === points.length - 2) ignore.add(targetId);
    if (!segmentClear(boxes, points[i], points[i + 1], stub ? 0 : 8, ignore)) return false;
  }
  return true;
}

function dedupe(points: Pt[]): Pt[] {
  const kept: Pt[] = [];
  for (const point of points) {
    const prev = kept[kept.length - 1];
    if (!prev || Math.hypot(point.x - prev.x, point.y - prev.y) > 0.5) kept.push(point);
  }
  return kept;
}

function rounded(points: Pt[]): string {
  const path = dedupe(points);
  if (path.length === 0) return '';
  if (path.length === 1) return `M ${path[0].x},${path[0].y}`;
  let d = `M ${path[0].x},${path[0].y}`;
  for (let i = 1; i < path.length - 1; i++) {
    const prev = path[i - 1];
    const cur = path[i];
    const next = path[i + 1];
    const dx1 = cur.x - prev.x;
    const dy1 = cur.y - prev.y;
    const dx2 = next.x - cur.x;
    const dy2 = next.y - cur.y;
    const len1 = Math.hypot(dx1, dy1);
    const len2 = Math.hypot(dx2, dy2);
    const radius = Math.min(8, len1 / 2, len2 / 2);
    if (radius < 1 || len1 < 1 || len2 < 1) {
      d += ` L ${cur.x},${cur.y}`;
      continue;
    }
    const ax = cur.x - (dx1 / len1) * radius;
    const ay = cur.y - (dy1 / len1) * radius;
    const bx = cur.x + (dx2 / len2) * radius;
    const by = cur.y + (dy2 / len2) * radius;
    d += ` L ${ax},${ay} Q ${cur.x},${cur.y} ${bx},${by}`;
  }
  const last = path[path.length - 1];
  d += ` L ${last.x},${last.y}`;
  return d;
}

function laneBias(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 33 + id.charCodeAt(i)) | 0;
  return (Math.abs(hash) % 5 - 2) * 8;
}

function findBox(boxes: Box[], id: string): Box | undefined {
  return boxes.find((box) => box.id === id);
}

function approach(box: Box | undefined, x: number, y: number, declared: Position): Position {
  if (!box) return declared;
  const left = x - box.x;
  const right = box.x + box.w - x;
  const top = y - box.y;
  const bottom = box.y + box.h - y;
  if (declared === Position.Left && left <= 10) return Position.Left;
  if (declared === Position.Right && right <= 10) return Position.Right;
  if (declared === Position.Top && top <= 10) return Position.Top;
  if (declared === Position.Bottom && bottom <= 10) return Position.Bottom;
  const nearest = Math.min(left, right, top, bottom);
  const besideCaption = (nearest === bottom && bottom > 12) || (nearest === top && top > 12);
  if (besideCaption && (declared === Position.Left || declared === Position.Right)) return declared;
  if (nearest === top) return Position.Top;
  if (nearest === bottom) return Position.Bottom;
  if (nearest === left) return Position.Left;
  return Position.Right;
}

function portStub(side: Position, x: number, y: number, box: Box | undefined, extra: number): Pt {
  const gap = STUB + extra;
  if (side === Position.Left) return { x: (box ? Math.min(x, box.x) : x) - gap, y };
  if (side === Position.Right) return { x: (box ? Math.max(x, box.x + box.w) : x) + gap, y };
  if (side === Position.Top) return { x, y: (box ? Math.min(y, box.y) : y) - gap };
  return { x, y: (box ? Math.max(y, box.y + box.h) : y) + gap };
}

function pathLength(points: Pt[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.abs(points[i].x - points[i - 1].x) + Math.abs(points[i].y - points[i - 1].y);
  }
  return total;
}

export function routeWire(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  sourcePosition: Position,
  targetPosition: Position,
  boxes: Box[],
  sourceId: string,
  targetId: string,
  edgeId: string
): string {
  const source: Pt = { x: sourceX, y: sourceY };
  const target: Pt = { x: targetX, y: targetY };
  const straight = [source, target];
  if (Math.abs(sourceY - targetY) < 2 && sourceX < targetX && pathClear(straight, boxes, sourceId, targetId)) {
    return rounded(straight);
  }

  const sourceBox = findBox(boxes, sourceId);
  const targetBox = findBox(boxes, targetId);
  const leave = approach(sourceBox, sourceX, sourceY, sourcePosition);
  const enter = approach(targetBox, targetX, targetY, targetPosition);
  const bias = laneBias(edgeId);

  let topBound = Math.min(sourceY, targetY);
  let bottomBound = Math.max(sourceY, targetY);
  for (const box of boxes) {
    topBound = Math.min(topBound, box.y);
    bottomBound = Math.max(bottomBound, box.y + box.h);
  }
  if (sourceX > targetX + 400) {
    const stubOut = portStub(leave, sourceX, sourceY, sourceBox, 0);
    const stubIn = portStub(enter, targetX, targetY, targetBox, 0);
    const lane = bottomBound + 32 + bias * 0.35;
    const trunk = [source, stubOut, { x: stubOut.x, y: lane }, { x: stubIn.x, y: lane }, stubIn, target];
    if (pathClear(trunk, boxes, sourceId, targetId)) return rounded(trunk);
  }

  const lanesY = new Set<number>();
  const lanesX = new Set<number>();
  let top = Math.min(sourceY, targetY);
  let bottom = Math.max(sourceY, targetY);
  let left = Math.min(sourceX, targetX);
  let right = Math.max(sourceX, targetX);
  for (const box of boxes) {
    top = Math.min(top, box.y);
    bottom = Math.max(bottom, box.y + box.h);
    left = Math.min(left, box.x);
    right = Math.max(right, box.x + box.w);
    lanesY.add(box.y - 16);
    lanesY.add(box.y + box.h + 16);
    lanesX.add(box.x - 16);
    lanesX.add(box.x + box.w + 16);
  }
  lanesY.add(top - 28);
  lanesY.add(bottom + 28);
  lanesX.add(left - 28);
  lanesX.add(right + 28);
  for (const lane of [...lanesY]) lanesY.add(lane + bias);
  for (const lane of [...lanesX]) lanesX.add(lane + bias);

  let best: Pt[] | null = null;
  let bestScore = Infinity;
  const consider = (points: Pt[], penalty: number) => {
    if (!pathClear(points, boxes, sourceId, targetId)) return;
    const score = pathLength(points) + penalty;
    if (score < bestScore) {
      bestScore = score;
      best = points;
    }
  };

  for (const extraOut of [0, 18]) {
    for (const extraIn of [0, 18]) {
      const stubOut = portStub(leave, sourceX, sourceY, sourceBox, extraOut);
      const stubIn = portStub(enter, targetX, targetY, targetBox, extraIn);
      consider([source, stubOut, { x: stubIn.x, y: stubOut.y }, stubIn, target], 0);
      consider([source, stubOut, { x: stubOut.x, y: stubIn.y }, stubIn, target], 0);
      for (const lane of lanesY) {
        const outside = lane < Math.min(sourceY, targetY) - 4 || lane > Math.max(sourceY, targetY) + 4;
        consider(
          [source, stubOut, { x: stubOut.x, y: lane }, { x: stubIn.x, y: lane }, stubIn, target],
          (outside ? 70 : 18) + Math.abs(lane - (sourceY + targetY) / 2) * 0.2
        );
      }
      for (const lane of lanesX) {
        const outside = lane < Math.min(sourceX, targetX) - 4 || lane > Math.max(sourceX, targetX) + 4;
        consider(
          [source, stubOut, { x: lane, y: stubOut.y }, { x: lane, y: stubIn.y }, stubIn, target],
          (outside ? 70 : 18) + Math.abs(lane - (sourceX + targetX) / 2) * 0.2
        );
      }
    }
  }
  if (best) return rounded(best);

  const stubOut = portStub(leave, sourceX, sourceY, sourceBox, 0);
  const stubIn = portStub(enter, targetX, targetY, targetBox, 0);
  const lane = bottom + 28;
  return rounded([source, stubOut, { x: stubOut.x, y: lane }, { x: stubIn.x, y: lane }, stubIn, target]);
}

export const WireEdge: React.FC<EdgeProps> = ({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  arrowHeadType,
  markerEndId,
}) => {
  const key = useStoreState((state) =>
    state.nodes
      .map((node) => {
        const measured = node.__rf as { position?: { x: number; y: number }; width?: number | null; height?: number | null } | undefined;
        const x = measured?.position?.x ?? node.position.x;
        const y = measured?.position?.y ?? node.position.y;
        return `${node.id}:${Math.round(x)},${Math.round(y)},${Math.round(measured?.width ?? 0)},${Math.round(measured?.height ?? 0)}`;
      })
      .join(';')
  );
  const markerEnd = getMarkerEnd(arrowHeadType, markerEndId);
  const d = useMemo(() => {
    const boxes: Box[] = key
      .split(';')
      .filter(Boolean)
      .map((part) => {
        const cut = part.indexOf(':');
        const [x, y, w, h] = part.slice(cut + 1).split(',').map(Number);
        return { id: part.slice(0, cut), x, y, w, h };
      })
      .filter((box) => box.w > 1 && box.h > 1);
    return routeWire(sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, boxes, source, target, id);
  }, [key, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, source, target, id]);
  return <path id={id} className="react-flow__edge-path" d={d} style={style} markerEnd={markerEnd} />;
};

export const edgeTypes = { wire: WireEdge };
