import { PackedPlant } from './freqBatch';
import { McSampleJob, sampleMcRange } from './mcSample';
import {
  aggregateCampaign,
  clampCampaignSize,
  McCampaignStats,
  McRunSample,
  MC_CAMPAIGN_MAX,
  MC_OVERLAY_DEFAULT,
} from './mcStats';
import { frequencyResponseBatch } from './webgpuFreq';
import { logspace } from './stability';
import { GraphNode } from './types';
import type { WorkerRequest, WorkerResponse } from '../workers/mcCampaign.worker';

export interface CampaignRequest {
  plantId: string;
  blockType: string;
  nodes: GraphNode[];
  xOp: number[];
  uOp: number[];
  K: number[];
  /** Number of MC runs (1…N). */
  nRuns: number;
  overlayCount?: number;
  selectedRun?: number;
  /** Draw every campaign line in the WebGL pack (can be 10k). */
  includeAllLines?: boolean;
  nOmega?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export interface CampaignResult {
  samples: McRunSample[];
  stats: McCampaignStats;
  ws: number[];
}

function workerCount(): number {
  if (typeof navigator === 'undefined') return 1;
  const cores = navigator.hardwareConcurrency || 4;
  return Math.max(1, Math.min(8, Math.floor(cores / 2) || 2));
}

function chunkRanges(nRuns: number, chunks: number): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  if (nRuns <= 0) return out;
  const size = Math.ceil(nRuns / chunks);
  for (let start = 1; start <= nRuns; start += size) {
    out.push({ start, end: Math.min(nRuns, start + size - 1) });
  }
  return out;
}

async function runOnWorkers(jobBase: Omit<McSampleJob, 'runStart' | 'runEnd'>, nRuns: number, onProgress?: CampaignRequest['onProgress'], signal?: AbortSignal): Promise<McRunSample[]> {
  if (typeof Worker === 'undefined') {
    return sampleMcRange({ ...jobBase, runStart: 1, runEnd: nRuns });
  }

  const ranges = chunkRanges(nRuns, workerCount());
  const workers = ranges.map(() => new Worker(new URL('../workers/mcCampaign.worker.ts', import.meta.url), { type: 'module' }));
  let done = 0;
  const total = nRuns;

  try {
    const parts = await Promise.all(
      ranges.map(
        (range, index) =>
          new Promise<McRunSample[]>((resolve, reject) => {
            if (signal?.aborted) {
              reject(new Error('aborted'));
              return;
            }
            const worker = workers[index];
            const id = index + 1;
            const onAbort = () => {
              worker.terminate();
              reject(new Error('aborted'));
            };
            signal?.addEventListener('abort', onAbort, { once: true });
            worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
              const msg = event.data;
              if (msg.type === 'sample' && msg.id === id) {
                done += msg.samples.length;
                onProgress?.(Math.min(done, total), total);
                signal?.removeEventListener('abort', onAbort);
                resolve(msg.samples);
              } else if (msg.type === 'error' && msg.id === id) {
                signal?.removeEventListener('abort', onAbort);
                reject(new Error(msg.message));
              }
            };
            worker.onerror = (err) => {
              signal?.removeEventListener('abort', onAbort);
              reject(err.error ?? new Error('Worker error'));
            };
            const req: WorkerRequest = {
              type: 'sample',
              id,
              job: { ...jobBase, runStart: range.start, runEnd: range.end },
            };
            worker.postMessage(req);
          })
      )
    );
    return parts.flat().sort((a, b) => a.run - b.run);
  } finally {
    for (const w of workers) w.terminate();
  }
}

/**
 * Run a Monte Carlo stability campaign.
 * Workers linearize + eigens (+ optional CPU Bode). For large N and n≤8, Bode is
 * recomputed in batch on WebGPU when available.
 */
export async function runMcCampaign(req: CampaignRequest): Promise<CampaignResult> {
  const nRuns = clampCampaignSize(Math.min(req.nRuns, MC_CAMPAIGN_MAX));
  const ws = logspace(1e-3, 1e3, req.nOmega ?? 96);
  const overlayCount = req.overlayCount ?? MC_OVERLAY_DEFAULT;
  if (nRuns <= 0) {
    return {
      samples: [],
      stats: aggregateCampaign([], ws, { overlayCount, selectedRun: req.selectedRun, backend: 'cpu', elapsedMs: 0 }),
      ws,
    };
  }

  const t0 = performance.now();
  const nProbe = (() => {
    try {
      const nodes = req.nodes;
      // cheap: use nominal plant size from first linearizable attempt in sample of run 1
      return null as number | null;
    } catch {
      return null;
    }
  })();
  void nProbe;

  // Prefer: workers keep A/B and skip per-run Bode when campaign is large → GPU/CPU batch Bode.
  const large = nRuns >= 256;
  const jobBase: Omit<McSampleJob, 'runStart' | 'runEnd'> = {
    plantId: req.plantId,
    blockType: req.blockType,
    nodes: req.nodes,
    xOp: req.xOp,
    uOp: req.uOp,
    K: req.K,
    keepAB: large,
    computeFreq: !large,
    nOmega: ws.length,
  };

  let samples = await runOnWorkers(jobBase, nRuns, req.onProgress, req.signal);
  let backend: McCampaignStats['backend'] = large ? 'hybrid' : 'cpu';

  if (large && samples.length) {
    const plants: PackedPlant[] = [];
    const indexMap: number[] = [];
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      if (s.Aflat && s.Bflat && s.n) {
        plants.push({ n: s.n, A: s.Aflat, B: s.Bflat });
        indexMap.push(i);
      }
    }
    if (plants.length) {
      const batch = await frequencyResponseBatch(plants, req.K, ws);
      backend = batch.backend === 'webgpu' ? 'webgpu' : 'hybrid';
      const W = ws.length;
      for (let p = 0; p < plants.length; p++) {
        const slice = batch.data.subarray(p * W * 4, (p + 1) * W * 4);
        const sample = samples[indexMap[p]];
        sample.freqFlat = slice.slice();
        // margins from freq
        const points = [];
        for (let i = 0; i < W; i++) {
          const re = slice[i * 4];
          const im = slice[i * 4 + 1];
          const mag = Math.hypot(re, im);
          points.push({
            w: ws[i],
            re,
            im,
            mag,
            magDb: slice[i * 4 + 2],
            phaseDeg: slice[i * 4 + 3],
          });
        }
        // reuse loopMargins via dynamic import avoided — inline simple crossover
        let gm: number | null = null;
        let pm: number | null = null;
        for (let i = 1; i < points.length; i++) {
          const a = points[i - 1];
          const b = points[i];
          if ((a.mag - 1) * (b.mag - 1) <= 0 && a.mag !== b.mag) {
            const t = (1 - a.mag) / (b.mag - a.mag);
            const ph = a.phaseDeg + t * (b.phaseDeg - a.phaseDeg);
            pm = 180 + ph;
          }
          if ((a.phaseDeg + 180) * (b.phaseDeg + 180) <= 0 && Math.abs(b.phaseDeg - a.phaseDeg) < 120) {
            const t = (-180 - a.phaseDeg) / (b.phaseDeg - a.phaseDeg || 1e-12);
            const magCross = a.mag + t * (b.mag - a.mag);
            if (magCross > 1e-12) gm = -20 * Math.log10(magCross);
          }
        }
        sample.gainMarginDb = gm;
        sample.phaseMarginDeg = pm;
        // free AB to reduce memory after Bode
        delete sample.Aflat;
        delete sample.Bflat;
      }
    } else {
      // no AB — recompute with CPU freq in workers
      samples = await runOnWorkers({ ...jobBase, keepAB: false, computeFreq: true }, nRuns, req.onProgress, req.signal);
      backend = 'cpu';
    }
  }

  const elapsedMs = performance.now() - t0;
  const stats = aggregateCampaign(samples, ws, {
    overlayCount,
    selectedRun: req.selectedRun,
    includeAllLines: req.includeAllLines,
    backend,
    elapsedMs,
  });
  return { samples, stats, ws };
}

/** Build a thin StabilityReport-like freq array for overlay drawing from a sample. */
export function sampleToFreqPoints(sample: McRunSample, ws: number[]) {
  const flat = sample.freqFlat;
  if (!flat || flat.length < ws.length * 4) return [];
  const points = [];
  for (let i = 0; i < ws.length; i++) {
    const re = flat[i * 4] as number;
    const im = flat[i * 4 + 1] as number;
    if (!Number.isFinite(re)) continue;
    const mag = Math.hypot(re, im);
    points.push({
      w: ws[i],
      re,
      im,
      mag,
      magDb: flat[i * 4 + 2] as number,
      phaseDeg: flat[i * 4 + 3] as number,
    });
  }
  return points;
}
