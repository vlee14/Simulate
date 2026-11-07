import { McSampleJob, sampleMcRange } from '../engine/mcSample';
import { McRunSample } from '../engine/mcStats';

export type WorkerRequest =
  | { type: 'sample'; id: number; job: Omit<McSampleJob, 'onProgress'> }
  | { type: 'ping'; id: number };

export type WorkerResponse =
  | { type: 'sample'; id: number; samples: McRunSample[] }
  | { type: 'progress'; id: number; completedInRange: number; rangeTotal: number }
  | { type: 'error'; id: number; message: string }
  | { type: 'pong'; id: number };

const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerResponse, transfer?: Transferable[]) => void;
};

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  try {
    if (msg.type === 'ping') {
      ctx.postMessage({ type: 'pong', id: msg.id });
      return;
    }
    if (msg.type === 'sample') {
      const samples = sampleMcRange({
        ...msg.job,
        onProgress: (completedInRange, rangeTotal) => {
          ctx.postMessage({ type: 'progress', id: msg.id, completedInRange, rangeTotal });
        },
      });
      const transfer: Transferable[] = [];
      for (const s of samples) {
        if (s.freqFlat instanceof Float64Array) transfer.push(s.freqFlat.buffer);
        if (s.Aflat instanceof Float64Array) transfer.push(s.Aflat.buffer);
        if (s.Bflat instanceof Float64Array) transfer.push(s.Bflat.buffer);
      }
      ctx.postMessage({ type: 'sample', id: msg.id, samples }, transfer);
      return;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Worker failed';
    ctx.postMessage({ type: 'error', id: msg.id, message });
  }
};
