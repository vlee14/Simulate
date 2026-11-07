/** Minimal WebGPU typings used by the Bode batch kernel (browser may or may not provide them). */

interface GPU {
  requestAdapter(): Promise<GPUAdapter | null>;
}

interface GPUAdapter {
  requestDevice(): Promise<GPUDevice>;
}

interface GPUDevice {
  createBindGroupLayout(descriptor: unknown): GPUBindGroupLayout;
  createPipelineLayout(descriptor: unknown): GPUPipelineLayout;
  createShaderModule(descriptor: { code: string }): GPUShaderModule;
  createComputePipeline(descriptor: unknown): GPUComputePipeline;
  createBuffer(descriptor: {
    size: number;
    usage: number;
    mappedAtCreation?: boolean;
  }): GPUBuffer;
  createBindGroup(descriptor: unknown): GPUBindGroup;
  createCommandEncoder(): GPUCommandEncoder;
  queue: GPUQueue;
}

interface GPUQueue {
  writeBuffer(buffer: GPUBuffer, offset: number, data: BufferSource): void;
  submit(commandBuffers: GPUCommandBuffer[]): void;
}

interface GPUBuffer {
  getMappedRange(): ArrayBuffer;
  unmap(): void;
  destroy(): void;
  mapAsync(mode: number): Promise<void>;
}

interface GPUBindGroupLayout {}
interface GPUPipelineLayout {}
interface GPUShaderModule {}
interface GPUComputePipeline {}
interface GPUBindGroup {}
interface GPUCommandEncoder {
  beginComputePass(): GPUComputePassEncoder;
  copyBufferToBuffer(src: GPUBuffer, srcOffset: number, dst: GPUBuffer, dstOffset: number, size: number): void;
  finish(): GPUCommandBuffer;
}
interface GPUComputePassEncoder {
  setPipeline(pipeline: GPUComputePipeline): void;
  setBindGroup(index: number, bindGroup: GPUBindGroup): void;
  dispatchWorkgroups(x: number): void;
  end(): void;
}
interface GPUCommandBuffer {}

declare const GPUShaderStage: { COMPUTE: number };
declare const GPUBufferUsage: {
  UNIFORM: number;
  COPY_DST: number;
  COPY_SRC: number;
  STORAGE: number;
  MAP_READ: number;
};
declare const GPUMapMode: { READ: number };
