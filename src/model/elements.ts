import { ArrowHeadType, Edge, Elements, Node } from 'react-flow-renderer';
import { getBlock } from '../engine/blocks';
import { GraphEdge, GraphNode, Param } from '../engine/types';
import { SimDocument } from './document';

export interface NodeData {
  blockType: string;
  alias: string;
  role?: string;
  parameters: Record<string, Param>;
}

export function isEdge(element: Node | Edge): element is Edge {
  return typeof (element as Edge).source === 'string';
}

export const edgeDefaults = {
  type: 'smoothstep' as const,
  arrowHeadType: ArrowHeadType.ArrowClosed,
  style: { stroke: '#8b97a8', strokeWidth: 1.6 },
};

export function toElements(doc: SimDocument): Elements {
  const nodes: Node[] = doc.nodes.map((item) => {
    const def = getBlock(item.blockType);
    return {
      id: item.id,
      type: def?.renderer ?? 'sim',
      position: { x: item.x, y: item.y },
      data: {
        blockType: item.blockType,
        alias: item.alias ?? def?.name ?? item.blockType,
        role: item.role,
        parameters: { ...(def?.defaultParameters ?? {}), ...(item.parameters ?? {}) },
      } as NodeData,
      draggable: true,
      selectable: true,
      connectable: true,
    };
  });
  const edges: Edge[] = doc.edges.map((item, index) => ({
    id: `e${index}:${item.source}:${item.sourceHandle}:${item.target}:${item.targetHandle}`,
    source: item.source,
    target: item.target,
    sourceHandle: item.sourceHandle,
    targetHandle: item.targetHandle,
    ...edgeDefaults,
  }));
  return [...nodes, ...edges];
}

export function toGraph(elements: Elements): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  for (const element of elements) {
    if (isEdge(element)) {
      if (!element.source || !element.target) continue;
      edges.push({
        id: element.id,
        source: element.source,
        target: element.target,
        sourceHandle: element.sourceHandle ?? 'out',
        targetHandle: element.targetHandle ?? 'in',
      });
    } else {
      const data = element.data as NodeData | undefined;
      if (!data?.blockType) continue;
      nodes.push({
        id: element.id,
        blockType: data.blockType,
        role: data.role,
        parameters: data.parameters ?? {},
      });
    }
  }
  return { nodes, edges };
}

export function toDocument(
  elements: Elements,
  meta: { name: string; description: string },
  config: SimDocument['config'],
  design: SimDocument['design']
): SimDocument {
  const nodes = elements.filter((element) => !isEdge(element)).map((element) => {
    const node = element as Node;
    const data = node.data as NodeData;
    return {
      id: node.id,
      blockType: data.blockType,
      x: node.position.x,
      y: node.position.y,
      alias: data.alias,
      role: data.role,
      parameters: data.parameters,
    };
  });
  const edges = elements.filter(isEdge).map((edge) => ({
    source: edge.source,
    sourceHandle: edge.sourceHandle ?? 'out',
    target: edge.target,
    targetHandle: edge.targetHandle ?? 'in',
  }));
  return { format: 'simulate', version: 1, name: meta.name, description: meta.description, config, design, nodes, edges };
}
