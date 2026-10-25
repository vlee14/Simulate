import { getBlock } from '../engine/blocks';
import { DEFAULT_CONFIG, DEFAULT_DESIGN, SimDocument } from './document';

const KEY = 'simulate.documents.v1';

export interface LibraryEntry {
  id: string;
  updatedAt: number;
  document: SimDocument;
}

export function loadLibrary(): LibraryEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const entry = item as LibraryEntry;
      if (typeof entry.id !== 'string' || !entry.document) return [];
      try {
        return [{ id: entry.id, updatedAt: Number(entry.updatedAt) || 0, document: parseDocument(entry.document) }];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

export function persistLibrary(entries: LibraryEntry[]): void {
  localStorage.setItem(KEY, JSON.stringify(entries));
}

export function parseDocument(raw: unknown): SimDocument {
  if (!raw || typeof raw !== 'object') throw new Error('Not a Simulate document');
  const doc = raw as SimDocument;
  if (!Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) throw new Error('This file has no diagram');
  if (!doc.config || typeof doc.config !== 'object') throw new Error('This file has no solver settings');
  for (const node of doc.nodes) {
    if (!node || typeof node.id !== 'string' || typeof node.blockType !== 'string' || !getBlock(node.blockType)) {
      throw new Error(`Unknown block "${node?.blockType ?? ''}"`);
    }
  }
  for (const edge of doc.edges) {
    if (!edge?.source || !edge?.target || !edge.sourceHandle || !edge.targetHandle) {
      throw new Error('A wire in this document is missing a port');
    }
  }
  return {
    format: 'simulate',
    version: 1,
    name: typeof doc.name === 'string' && doc.name.trim() ? doc.name : 'Untitled',
    description: typeof doc.description === 'string' ? doc.description : '',
    config: { ...DEFAULT_CONFIG, ...doc.config },
    design: {
      Q: Array.isArray(doc.design?.Q) && doc.design.Q.length ? doc.design.Q.map(Number) : DEFAULT_DESIGN.Q.slice(),
      R: Number(doc.design?.R ?? DEFAULT_DESIGN.R),
    },
    nodes: doc.nodes,
    edges: doc.edges,
  };
}
