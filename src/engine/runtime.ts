import { readPendulumParams } from './physics';
import { CompiledModel, compile, RuntimeBlock, SimCompileError } from './compile';
import { telemetry } from './telemetry';
import { GraphEdge, GraphNode, Param, SimConfig } from './types';

export class SimulationEngine {
  time = 0;
  compiled: CompiledModel | null = null;
  private X = new Float64Array(0);
  private D = new Float64Array(0);
  private dX = new Float64Array(0);
  private x0 = new Float64Array(0);
  private stage = new Float64Array(0);
  private k1 = new Float64Array(0);
  private k2 = new Float64Array(0);
  private k3 = new Float64Array(0);
  private k4 = new Float64Array(0);
  private params = new Map<string, Record<string, Param>>();
  private trailStamp = new Map<string, number>();
  private nodes: GraphNode[];
  private edges: GraphEdge[];
  config: SimConfig;

  constructor(nodes: GraphNode[], edges: GraphEdge[], config: SimConfig) {
    this.nodes = nodes;
    this.edges = edges;
    this.config = config;
    this.rebuildParams(nodes);
  }

  rebuildParams(nodes: GraphNode[]): void {
    this.params.clear();
    for (const node of nodes) this.params.set(node.id, node.parameters);
  }

  compile(): void {
    this.compiled = compile(this.nodes, this.edges);
  }

  reset(): void {
    if (!this.compiled) this.compile();
    const model = this.compiled!;
    this.X = new Float64Array(model.stateSize);
    this.D = new Float64Array(model.discreteSize);
    this.dX = new Float64Array(model.stateSize);
    this.x0 = new Float64Array(model.stateSize);
    this.stage = new Float64Array(model.stateSize);
    this.k1 = new Float64Array(model.stateSize);
    this.k2 = new Float64Array(model.stateSize);
    this.k3 = new Float64Array(model.stateSize);
    this.k4 = new Float64Array(model.stateSize);
    this.time = this.config.startTime;
    this.trailStamp.clear();
    telemetry.reset();

    for (const block of model.blocks) {
      block.ctx.state =
        block.stateCount > 0 ? this.X.subarray(block.stateOffset, block.stateOffset + block.stateCount) : this.X.subarray(0, 0);
      block.ctx.discrete =
        block.discCount > 0 ? this.D.subarray(block.discOffset, block.discOffset + block.discCount) : this.D.subarray(0, 0);
      block.ctx.deriv =
        block.stateCount > 0 ? this.dX.subarray(block.stateOffset, block.stateOffset + block.stateCount) : this.dX.subarray(0, 0);
      block.ctx.parameters = this.params.get(block.id) ?? block.ctx.parameters;
      block.ctx.t = this.time;
      block.ctx.dt = this.config.stepSize;
      const sample = Number(block.ctx.parameters.sampleTime);
      block.nextSample = this.time + (sample > 0 ? sample : Infinity);
      block.def.init?.(block.ctx);
    }
    this.evalOutputs();
    this.capture(true);
  }

  step(h = this.config.stepSize): void {
    if (!this.compiled) this.reset();
    if (!(h > 0)) return;
    if (this.config.solver === 'euler') this.euler(h);
    else this.rk4(h);
    this.evalOutputs();
    this.assertFinite();
    this.capture(false);
    this.updateDiscrete();
  }

  nudge(blockId: string, index: number, delta: number): void {
    const block = this.compiled?.byId.get(blockId);
    if (!block || index < 0 || index >= block.stateCount) return;
    this.X[block.stateOffset + index] += delta;
    this.evalOutputs();
    this.capture(true);
  }

  private euler(h: number): void {
    const t = this.time;
    this.x0.set(this.X);
    this.derivativesAt(t, this.x0, this.k1);
    for (let i = 0; i < this.X.length; i++) this.X[i] = this.x0[i] + h * this.k1[i];
    this.time = t + h;
  }

  private rk4(h: number): void {
    const t = this.time;
    this.x0.set(this.X);
    this.derivativesAt(t, this.x0, this.k1);
    for (let i = 0; i < this.X.length; i++) this.stage[i] = this.x0[i] + 0.5 * h * this.k1[i];
    this.derivativesAt(t + 0.5 * h, this.stage, this.k2);
    for (let i = 0; i < this.X.length; i++) this.stage[i] = this.x0[i] + 0.5 * h * this.k2[i];
    this.derivativesAt(t + 0.5 * h, this.stage, this.k3);
    for (let i = 0; i < this.X.length; i++) this.stage[i] = this.x0[i] + h * this.k3[i];
    this.derivativesAt(t + h, this.stage, this.k4);
    for (let i = 0; i < this.X.length; i++) {
      this.X[i] = this.x0[i] + (h / 6) * (this.k1[i] + 2 * this.k2[i] + 2 * this.k3[i] + this.k4[i]);
    }
    this.time = t + h;
  }

  private derivativesAt(t: number, state: Float64Array, out: Float64Array): void {
    this.X.set(state);
    this.time = t;
    this.evalOutputs();
    this.dX.fill(0);
    const model = this.compiled!;
    for (const block of model.blocks) {
      if (block.stateCount === 0 || !block.def.derivatives) continue;
      this.prepare(block);
      block.def.derivatives(block.ctx);
    }
    out.set(this.dX);
  }

  private evalOutputs(): void {
    const model = this.compiled!;
    for (const block of model.dynamicBlocks) this.evalOne(block);
    for (const block of model.feedthroughOrder) this.evalOne(block);
  }

  private evalOne(block: RuntimeBlock): void {
    this.prepare(block);
    block.def.outputs(block.ctx);
  }

  private prepare(block: RuntimeBlock): void {
    for (const port of block.inputPorts) {
      const wire = block.wires.get(port);
      if (!wire) {
        block.inputs[port] = 0;
        continue;
      }
      const source = this.compiled!.byId.get(wire.block);
      block.inputs[port] = source?.outputs[wire.port] ?? 0;
    }
    block.ctx.t = this.time;
    block.ctx.dt = this.config.stepSize;
    block.ctx.parameters = this.params.get(block.id) ?? block.ctx.parameters;
  }

  private updateDiscrete(): void {
    const model = this.compiled!;
    for (const block of model.blocks) {
      if (block.discCount === 0 || !block.def.updateDiscrete) continue;
      const sample = Number(block.ctx.parameters.sampleTime);
      if (!(sample > 0)) continue;
      if (this.time + 1e-9 < block.nextSample) continue;
      this.prepare(block);
      block.def.updateDiscrete(block.ctx);
      while (this.time + 1e-9 >= block.nextSample) block.nextSample += sample;
    }
  }

  private assertFinite(): void {
    for (let i = 0; i < this.X.length; i++) {
      if (!Number.isFinite(this.X[i])) {
        throw new SimCompileError('The simulation diverged. Reduce the step size or check for a bad parameter.');
      }
    }
  }

  private capture(forceTrail: boolean): void {
    const model = this.compiled!;
    for (const block of model.blocks) {
      let record = telemetry.latest.get(block.id);
      if (!record) {
        record = {};
        telemetry.latest.set(block.id, record);
      }
      for (const port of block.outputPorts) record[port] = block.outputs[port];
      for (const port of block.inputPorts) record[port] = block.inputs[port];
      if (block.def.category === 'Sinks') {
        const span = Number(block.ctx.parameters.timeSpan) || Math.max(1, this.config.stopTime);
        const capacity = Math.max(400, Math.min(80000, Math.ceil(span / Math.max(this.config.stepSize, 1e-4)) + 8));
        for (const port of block.inputPorts) {
          record[port] = block.inputs[port];
          telemetry.ensure(block.id, port, capacity).push(this.time, block.inputs[port]);
        }
      }
      if (block.type === 'pendulum') {
        const last = this.trailStamp.get(block.id) ?? -Infinity;
        if (forceTrail || this.time - last >= 0.02) {
          this.trailStamp.set(block.id, this.time);
          const p = readPendulumParams(block.ctx.parameters);
          const tipX = block.outputs.x + p.l1 * Math.sin(block.outputs.th1) + p.l2 * Math.sin(block.outputs.th2);
          const tipY = p.l1 * Math.cos(block.outputs.th1) + p.l2 * Math.cos(block.outputs.th2);
          let trail = telemetry.trails.get(block.id);
          if (!trail) {
            trail = [];
            telemetry.trails.set(block.id, trail);
          }
          trail.push({ x: tipX, y: tipY });
          if (trail.length > 360) trail.shift();
        }
      }
    }
  }
}

export { SimCompileError };
