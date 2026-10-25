import { getBlock } from './blocks';
import { BlockContext, BlockDefinition, GraphEdge, GraphNode, Param } from './types';

export class SimCompileError extends Error {
  ids: string[];
  constructor(message: string, ids: string[] = []) {
    super(message);
    this.name = 'SimCompileError';
    this.ids = ids;
  }
}

export interface RuntimeBlock {
  id: string;
  type: string;
  role?: string;
  def: BlockDefinition;
  feedthrough: boolean;
  inputPorts: string[];
  outputPorts: string[];
  wires: Map<string, { block: string; port: string }>;
  inputs: Record<string, number>;
  outputs: Record<string, number>;
  stateOffset: number;
  stateCount: number;
  discOffset: number;
  discCount: number;
  nextSample: number;
  ctx: BlockContext;
}

export interface CompiledModel {
  blocks: RuntimeBlock[];
  byId: Map<string, RuntimeBlock>;
  feedthroughOrder: RuntimeBlock[];
  dynamicBlocks: RuntimeBlock[];
  sinks: RuntimeBlock[];
  stateSize: number;
  discreteSize: number;
}

export function structureSignature(nodes: GraphNode[], edges: GraphEdge[]): string {
  const parts: string[] = [];
  const ordered = nodes.slice().sort((a, b) => a.id.localeCompare(b.id));
  for (const node of ordered) {
    const def = getBlock(node.blockType);
    if (!def || def.category === 'Annotation') {
      parts.push(node.id, node.blockType);
      continue;
    }
    let ports = { inputs: [] as { id: string }[], outputs: [] as { id: string }[] };
    let states = 0;
    let discrete = 0;
    try {
      ports = def.ports(node.parameters);
      states = def.continuousStates(node.parameters);
      discrete = def.discreteStates(node.parameters);
    } catch {
      parts.push(node.id, 'invalid');
      continue;
    }
    parts.push(
      node.id,
      node.blockType,
      String(states),
      String(discrete),
      ports.inputs.map((port) => port.id).join(','),
      ports.outputs.map((port) => port.id).join(',')
    );
  }
  const wires = edges.slice().sort((a, b) => a.id.localeCompare(b.id));
  for (const edge of wires) {
    parts.push(edge.source, edge.sourceHandle, edge.target, edge.targetHandle);
  }
  return parts.join('|');
}

export function compile(nodes: GraphNode[], edges: GraphEdge[]): CompiledModel {
  const blocks: RuntimeBlock[] = [];
  const byId = new Map<string, RuntimeBlock>();
  let stateSize = 0;
  let discreteSize = 0;

  for (const node of nodes) {
    const def = getBlock(node.blockType);
    if (!def || def.category === 'Annotation') continue;
    let ports: { inputs: { id: string }[]; outputs: { id: string }[] };
    let stateCount = 0;
    let discCount = 0;
    let feedthrough = false;
    try {
      ports = def.ports(node.parameters);
      stateCount = def.continuousStates(node.parameters);
      discCount = def.discreteStates(node.parameters);
      feedthrough = def.hasDirectFeedthrough(node.parameters);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid parameters';
      throw new SimCompileError(`${def.name}: ${message}`, [node.id]);
    }
    const inputs: Record<string, number> = {};
    const outputs: Record<string, number> = {};
    for (const port of ports.inputs) inputs[port.id] = 0;
    for (const port of ports.outputs) outputs[port.id] = 0;
    const state = new Float64Array(0);
    const block: RuntimeBlock = {
      id: node.id,
      type: node.blockType,
      role: node.role,
      def,
      feedthrough,
      inputPorts: ports.inputs.map((port) => port.id),
      outputPorts: ports.outputs.map((port) => port.id),
      wires: new Map(),
      inputs,
      outputs,
      stateOffset: stateSize,
      stateCount,
      discOffset: discreteSize,
      discCount,
      nextSample: 0,
      ctx: {
        id: node.id,
        t: 0,
        dt: 0,
        inputs,
        outputs,
        parameters: node.parameters,
        state,
        discrete: new Float64Array(0),
        deriv: new Float64Array(0),
      },
    };
    stateSize += stateCount;
    discreteSize += discCount;
    blocks.push(block);
    byId.set(block.id, block);
  }

  for (const edge of edges) {
    const target = byId.get(edge.target);
    const source = byId.get(edge.source);
    if (!target || !source) continue;
    if (!target.inputPorts.includes(edge.targetHandle)) continue;
    if (!source.outputPorts.includes(edge.sourceHandle)) continue;
    target.wires.set(edge.targetHandle, { block: edge.source, port: edge.sourceHandle });
  }

  const feedthroughBlocks = blocks.filter((block) => block.feedthrough);
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const block of feedthroughBlocks) {
    indegree.set(block.id, 0);
    outgoing.set(block.id, []);
  }
  for (const block of feedthroughBlocks) {
    for (const port of block.inputPorts) {
      const wire = block.wires.get(port);
      if (!wire) continue;
      const source = byId.get(wire.block);
      if (!source?.feedthrough) continue;
      outgoing.get(source.id)!.push(block.id);
      indegree.set(block.id, (indegree.get(block.id) ?? 0) + 1);
    }
  }

  const queue = feedthroughBlocks.filter((block) => indegree.get(block.id) === 0);
  const feedthroughOrder: RuntimeBlock[] = [];
  while (queue.length > 0) {
    const block = queue.shift()!;
    feedthroughOrder.push(block);
    for (const nextId of outgoing.get(block.id) ?? []) {
      const next = (indegree.get(nextId) ?? 1) - 1;
      indegree.set(nextId, next);
      if (next === 0) queue.push(byId.get(nextId)!);
    }
  }
  if (feedthroughOrder.length !== feedthroughBlocks.length) {
    const stuck = feedthroughBlocks.filter((block) => !feedthroughOrder.includes(block)).map((block) => block.id);
    const names = stuck.map((id) => byId.get(id)?.def.name ?? id).join(', ');
    throw new SimCompileError(`Algebraic loop through ${names}. Break it with an integrator or a unit delay.`, stuck);
  }

  return {
    blocks,
    byId,
    feedthroughOrder,
    dynamicBlocks: blocks.filter((block) => !block.feedthrough),
    sinks: blocks.filter((block) => block.def.category === 'Sinks'),
    stateSize,
    discreteSize,
  };
}

export function emptyParams(): Record<string, Param> {
  return {};
}
