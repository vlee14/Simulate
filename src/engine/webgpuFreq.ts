import { frequencyResponseBatchCpu, PackedPlant } from './freqBatch';
import { logspace } from './stability';

/** Max state dimension supported by the WebGPU Bode kernel. */
export const WEBGPU_MAX_N = 8;

type GpuHandle = {
  device: GPUDevice;
  pipeline: GPUComputePipeline;
  bindGroupLayout: GPUBindGroupLayout;
};

let cached: GpuHandle | null = null;
let unavailable = false;

const SHADER = /* wgsl */ `
struct Params {
  n: u32,
  nPlants: u32,
  nOmega: u32,
  _pad: u32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> Aflat: array<f32>; // nPlants * n * n
@group(0) @binding(2) var<storage, read> Bflat: array<f32>; // nPlants * n
@group(0) @binding(3) var<storage, read> Kflat: array<f32>; // n
@group(0) @binding(4) var<storage, read> omega: array<f32>; // nOmega
@group(0) @binding(5) var<storage, read_write> outReIm: array<f32>; // nPlants * nOmega * 2

fn solve_loop(plant: u32, wi: u32) {
  let n = params.n;
  let m = n * 2u;
  // Augmented 16x17 max
  var Aug: array<f32, 272>; // 16*17
  let aBase = plant * n * n;
  let bBase = plant * n;

  for (var i = 0u; i < m; i++) {
    for (var j = 0u; j < m + 1u; j++) {
      Aug[i * 17u + j] = 0.0;
    }
  }

  let w = omega[wi];
  for (var i = 0u; i < n; i++) {
    for (var j = 0u; j < n; j++) {
      let aij = Aflat[aBase + i * n + j];
      Aug[i * 17u + j] = -aij;
      Aug[(n + i) * 17u + (n + j)] = -aij;
      if (i == j) {
        Aug[i * 17u + (n + j)] = -w;
        Aug[(n + i) * 17u + j] = w;
      }
    }
    Aug[i * 17u + m] = Bflat[bBase + i];
  }

  // Gaussian elimination with partial pivot
  for (var k = 0u; k < m; k++) {
    var piv = k;
    var maxv = abs(Aug[k * 17u + k]);
    for (var i = k + 1u; i < m; i++) {
      let v = abs(Aug[i * 17u + k]);
      if (v > maxv) {
        maxv = v;
        piv = i;
      }
    }
    if (maxv < 1e-14) {
      let o = (plant * params.nOmega + wi) * 2u;
      outReIm[o] = 0.0/0.0;
      outReIm[o + 1u] = 0.0/0.0;
      return;
    }
    if (piv != k) {
      for (var j = k; j <= m; j++) {
        let tmp = Aug[k * 17u + j];
        Aug[k * 17u + j] = Aug[piv * 17u + j];
        Aug[piv * 17u + j] = tmp;
      }
    }
    let diag = Aug[k * 17u + k];
    for (var j = k; j <= m; j++) {
      Aug[k * 17u + j] = Aug[k * 17u + j] / diag;
    }
    for (var i = 0u; i < m; i++) {
      if (i == k) { continue; }
      let f = Aug[i * 17u + k];
      if (abs(f) < 1e-20) { continue; }
      for (var j = k; j <= m; j++) {
        Aug[i * 17u + j] = Aug[i * 17u + j] - f * Aug[k * 17u + j];
      }
    }
  }

  var re = 0.0;
  var im = 0.0;
  for (var i = 0u; i < n; i++) {
    let ki = Kflat[i];
    re = re + ki * Aug[i * 17u + m];
    im = im + ki * Aug[(n + i) * 17u + m];
  }
  let o = (plant * params.nOmega + wi) * 2u;
  outReIm[o] = re;
  outReIm[o + 1u] = im;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  let total = params.nPlants * params.nOmega;
  if (idx >= total) { return; }
  let plant = idx / params.nOmega;
  let wi = idx % params.nOmega;
  solve_loop(plant, wi);
}
`;

async function getGpu(): Promise<GpuHandle | null> {
  if (unavailable) return null;
  if (cached) return cached;
  try {
    const nav = navigator as Navigator & { gpu?: GPU };
    if (!nav.gpu) {
      unavailable = true;
      return null;
    }
    const adapter = await nav.gpu.requestAdapter();
    if (!adapter) {
      unavailable = true;
      return null;
    }
    const device = await adapter.requestDevice();
    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    const pipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      compute: {
        module: device.createShaderModule({ code: SHADER }),
        entryPoint: 'main',
      },
    });
    cached = { device, pipeline, bindGroupLayout };
    return cached;
  } catch {
    unavailable = true;
    return null;
  }
}

export function webgpuFreqAvailableSync(): boolean {
  if (unavailable) return false;
  return typeof navigator !== 'undefined' && !!(navigator as Navigator & { gpu?: GPU }).gpu;
}

function unwrapPhase(re: number, im: number, prev: number | null): { magDb: number; phaseDeg: number; prev: number } {
  const mag = Math.hypot(re, im);
  let phaseDeg = (Math.atan2(im, re) * 180) / Math.PI;
  if (prev != null) {
    while (phaseDeg - prev > 180) phaseDeg -= 360;
    while (phaseDeg - prev < -180) phaseDeg += 360;
  }
  return {
    magDb: mag > 1e-16 ? 20 * Math.log10(mag) : -320,
    phaseDeg,
    prev: phaseDeg,
  };
}

/**
 * Batched L(jw) via WebGPU when available and plants share dimension n≤8.
 * Falls back to CPU. Returns packed [re,im,magDb,phaseDeg]*W per plant.
 */
export async function frequencyResponseBatch(
  plants: PackedPlant[],
  K: number[],
  ws: number[] = logspace(1e-3, 1e3, 96)
): Promise<{ data: Float64Array; backend: 'cpu' | 'webgpu' }> {
  if (!plants.length) return { data: new Float64Array(0), backend: 'cpu' };
  const n = plants[0].n;
  const uniform = plants.every((p) => p.n === n);
  const useGpu =
    uniform &&
    n > 0 &&
    n <= WEBGPU_MAX_N &&
    plants.length * ws.length >= 2048 &&
    K.some((v) => Math.abs(v) > 1e-12);

  if (!useGpu) {
    return { data: frequencyResponseBatchCpu(plants, K, ws), backend: 'cpu' };
  }

  const gpu = await getGpu();
  if (!gpu) {
    return { data: frequencyResponseBatchCpu(plants, K, ws), backend: 'cpu' };
  }

  try {
    const { device, pipeline, bindGroupLayout } = gpu;
    const N = plants.length;
    const W = ws.length;
    const Ahost = new Float32Array(N * n * n);
    const Bhost = new Float32Array(N * n);
    for (let p = 0; p < N; p++) {
      const A = plants[p].A;
      const B = plants[p].B;
      for (let i = 0; i < n * n; i++) Ahost[p * n * n + i] = A[i] as number;
      for (let i = 0; i < n; i++) Bhost[p * n + i] = B[i] as number;
    }
    const Khost = new Float32Array(WEBGPU_MAX_N);
    for (let i = 0; i < n; i++) Khost[i] = K[i] ?? 0;
    const Whost = new Float32Array(ws.map((w) => w));

    const paramBuf = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const params = new Uint32Array([n, N, W, 0]);
    device.queue.writeBuffer(paramBuf, 0, params);

    const mkStorage = (data: Float32Array, usage: number) => {
      const buf = device.createBuffer({ size: Math.max(4, data.byteLength), usage, mappedAtCreation: true });
      new Float32Array(buf.getMappedRange()).set(data);
      buf.unmap();
      return buf;
    };

    const Abuf = mkStorage(Ahost, GPUBufferUsage.STORAGE);
    const Bbuf = mkStorage(Bhost, GPUBufferUsage.STORAGE);
    const Kbuf = mkStorage(Khost, GPUBufferUsage.STORAGE);
    const Obuf = mkStorage(Whost, GPUBufferUsage.STORAGE);
    const outBuf = device.createBuffer({
      size: N * W * 2 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const readBuf = device.createBuffer({
      size: N * W * 2 * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: paramBuf } },
        { binding: 1, resource: { buffer: Abuf } },
        { binding: 2, resource: { buffer: Bbuf } },
        { binding: 3, resource: { buffer: Kbuf } },
        { binding: 4, resource: { buffer: Obuf } },
        { binding: 5, resource: { buffer: outBuf } },
      ],
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil((N * W) / 64));
    pass.end();
    encoder.copyBufferToBuffer(outBuf, 0, readBuf, 0, N * W * 2 * 4);
    device.queue.submit([encoder.finish()]);
    await readBuf.mapAsync(GPUMapMode.READ);
    const reIm = new Float32Array(readBuf.getMappedRange().slice(0));
    readBuf.unmap();

    const data = new Float64Array(N * W * 4);
    for (let p = 0; p < N; p++) {
      let prev: number | null = null;
      for (let i = 0; i < W; i++) {
        const re = reIm[(p * W + i) * 2];
        const im = reIm[(p * W + i) * 2 + 1];
        const o = (p * W + i) * 4;
        if (!Number.isFinite(re) || !Number.isFinite(im)) {
          data[o] = NaN;
          data[o + 1] = NaN;
          data[o + 2] = NaN;
          data[o + 3] = NaN;
          continue;
        }
        const u = unwrapPhase(re, im, prev);
        prev = u.prev;
        data[o] = re;
        data[o + 1] = im;
        data[o + 2] = u.magDb;
        data[o + 3] = u.phaseDeg;
      }
    }

    Abuf.destroy();
    Bbuf.destroy();
    Kbuf.destroy();
    Obuf.destroy();
    outBuf.destroy();
    readBuf.destroy();
    paramBuf.destroy();
    return { data, backend: 'webgpu' };
  } catch {
    return { data: frequencyResponseBatchCpu(plants, K, ws), backend: 'cpu' };
  }
}
