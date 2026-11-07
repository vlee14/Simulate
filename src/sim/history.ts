import { Elements } from 'react-flow-renderer';
import { DesignConfig, SimConfig } from '../engine/types';

export interface DocSnapshot {
  elements: Elements;
  name: string;
  description: string;
  config: SimConfig;
  design: DesignConfig;
}

const MAX = 60;

function cloneSnap(snap: DocSnapshot): DocSnapshot {
  return JSON.parse(JSON.stringify(snap)) as DocSnapshot;
}

export class HistoryStack {
  past: DocSnapshot[] = [];
  future: DocSnapshot[] = [];
  private lastFingerprint = '';

  clear(): void {
    this.past = [];
    this.future = [];
    this.lastFingerprint = '';
  }

  fingerprint(snap: DocSnapshot): string {
    // Cheap fingerprint — ignore transient selection
    return JSON.stringify({
      n: snap.name,
      d: snap.description,
      c: snap.config,
      g: snap.design,
      e: snap.elements.map((el) => {
        if ('source' in el) return { e: el.id, s: el.source, t: el.target, sh: el.sourceHandle, th: el.targetHandle };
        return { id: el.id, x: el.position?.x, y: el.position?.y, data: el.data };
      }),
    });
  }

  push(snap: DocSnapshot): void {
    const fp = this.fingerprint(snap);
    if (fp === this.lastFingerprint) return;
    this.past.push(cloneSnap(snap));
    if (this.past.length > MAX) this.past.shift();
    this.future = [];
    this.lastFingerprint = fp;
  }

  undo(current: DocSnapshot): DocSnapshot | null {
    if (!this.past.length) return null;
    this.future.push(cloneSnap(current));
    const prev = this.past.pop()!;
    this.lastFingerprint = this.fingerprint(prev);
    return prev;
  }

  redo(current: DocSnapshot): DocSnapshot | null {
    if (!this.future.length) return null;
    this.past.push(cloneSnap(current));
    const next = this.future.pop()!;
    this.lastFingerprint = this.fingerprint(next);
    return next;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
}

export const historyStack = new HistoryStack();
