import { getBlock } from './blocks';
import { GraphEdge, GraphNode, Param, PortDef } from './types';

export interface BlueprintNode {
  id: string;
  blockType: string;
  parameters?: Record<string, Param>;
  role?: string;
}

export interface BlueprintEdge {
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
}

export interface SubsystemBlueprint {
  nodes: BlueprintNode[];
  edges: BlueprintEdge[];
}

export function parseBlueprint(raw: Param | undefined): SubsystemBlueprint {
  if (typeof raw !== 'string' || !raw.trim()) return { nodes: [], edges: [] };
  try {
    const parsed = JSON.parse(raw) as SubsystemBlueprint;
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return { nodes: [], edges: [] };
    return parsed;
  } catch {
    return { nodes: [], edges: [] };
  }
}

export function stringifyBlueprint(blueprint: SubsystemBlueprint): string {
  return JSON.stringify(blueprint);
}

export function subsystemPorts(blueprint: SubsystemBlueprint): { inputs: PortDef[]; outputs: PortDef[] } {
  const inputs: PortDef[] = [];
  const outputs: PortDef[] = [];
  for (const node of blueprint.nodes) {
    if (node.blockType === 'inport') {
      const name = String(node.parameters?.name ?? 'u');
      const domain = (node.parameters?.domain as PortDef['domain']) ?? 'signal';
      inputs.push({ id: name, name, domain });
    }
    if (node.blockType === 'outport') {
      const name = String(node.parameters?.name ?? 'y');
      const domain = (node.parameters?.domain as PortDef['domain']) ?? 'signal';
      outputs.push({ id: name, name, domain });
    }
  }
  return { inputs, outputs };
}

function prefixId(parent: string, child: string): string {
  return `${parent}/${child}`;
}

/** Expand subsystem blocks into flat nodes/edges. Inports/outports become wire splices. */
export function expandGraph(nodes: GraphNode[], edges: GraphEdge[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  let currentNodes = nodes.slice();
  let currentEdges = edges.slice();
  let guard = 0;
  while (guard++ < 32) {
    const sub = currentNodes.find((node) => node.blockType === 'subsystem');
    if (!sub) break;
    const blueprint = parseBlueprint(sub.parameters.blueprint);
    const childNodes: GraphNode[] = [];
    const inports = new Map<string, string>();
    const outports = new Map<string, string>();

    for (const node of blueprint.nodes) {
      const id = prefixId(sub.id, node.id);
      if (node.blockType === 'inport') {
        inports.set(String(node.parameters?.name ?? 'u'), id);
        continue;
      }
      if (node.blockType === 'outport') {
        outports.set(String(node.parameters?.name ?? 'y'), id);
        continue;
      }
      const def = getBlock(node.blockType);
      childNodes.push({
        id,
        blockType: node.blockType,
        role: node.role,
        parameters: { ...(def?.defaultParameters ?? {}), ...(node.parameters ?? {}) },
      });
    }

    const childEdges: GraphEdge[] = [];
    const fromInport = new Map<string, BlueprintEdge[]>();
    const toOutport = new Map<string, BlueprintEdge[]>();

    for (const edge of blueprint.edges) {
      const sourceIsIn = blueprint.nodes.find((n) => n.id === edge.source)?.blockType === 'inport';
      const targetIsOut = blueprint.nodes.find((n) => n.id === edge.target)?.blockType === 'outport';
      if (sourceIsIn) {
        const list = fromInport.get(edge.source) ?? [];
        list.push(edge);
        fromInport.set(edge.source, list);
        continue;
      }
      if (targetIsOut) {
        const list = toOutport.get(edge.target) ?? [];
        list.push(edge);
        toOutport.set(edge.target, list);
        continue;
      }
      childEdges.push({
        id: `${sub.id}:${edge.source}:${edge.sourceHandle}:${edge.target}:${edge.targetHandle}`,
        source: prefixId(sub.id, edge.source),
        sourceHandle: edge.sourceHandle,
        target: prefixId(sub.id, edge.target),
        targetHandle: edge.targetHandle,
      });
    }

    const nextEdges: GraphEdge[] = [];
    for (const edge of currentEdges) {
      if (edge.target === sub.id) {
        const inportId = [...inports.entries()].find(([, id]) => {
          const local = id.slice(sub.id.length + 1);
          return String(blueprint.nodes.find((n) => n.id === local)?.parameters?.name ?? '') === edge.targetHandle;
        })?.[1];
        // Map by port name on subsystem = inport name
        const portName = edge.targetHandle;
        const matchedInportLocal = blueprint.nodes.find(
          (n) => n.blockType === 'inport' && String(n.parameters?.name ?? 'u') === portName
        );
        if (!matchedInportLocal) continue;
        const fanout = fromInport.get(matchedInportLocal.id) ?? [];
        for (const inner of fanout) {
          nextEdges.push({
            id: `${edge.id}->${inner.target}`,
            source: edge.source,
            sourceHandle: edge.sourceHandle,
            target: prefixId(sub.id, inner.target),
            targetHandle: inner.targetHandle,
          });
        }
        void inportId;
        continue;
      }
      if (edge.source === sub.id) {
        const portName = edge.sourceHandle;
        const matchedOutportLocal = blueprint.nodes.find(
          (n) => n.blockType === 'outport' && String(n.parameters?.name ?? 'y') === portName
        );
        if (!matchedOutportLocal) continue;
        const fanin = toOutport.get(matchedOutportLocal.id) ?? [];
        for (const inner of fanin) {
          nextEdges.push({
            id: `${inner.source}->${edge.id}`,
            source: prefixId(sub.id, inner.source),
            sourceHandle: inner.sourceHandle,
            target: edge.target,
            targetHandle: edge.targetHandle,
          });
        }
        continue;
      }
      nextEdges.push(edge);
    }

    currentNodes = [...currentNodes.filter((node) => node.id !== sub.id), ...childNodes];
    currentEdges = [...nextEdges, ...childEdges];
  }
  return { nodes: currentNodes, edges: currentEdges };
}
