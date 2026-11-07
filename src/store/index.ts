import create from 'zustand';
import { addEdge, Connection, Edge, Elements, Node } from 'react-flow-renderer';
import { v4 as uuid } from 'uuid';
import { getBlock } from '../engine/blocks';
import { AnalysisOption, DesignConfig, DistKind, LinearizationPoint, Param, ParamUncertainty, SimConfig } from '../engine/types';
import { newUncertaintySeed } from '../engine/montecarlo';
import { formatPole } from '../engine/lqr';
import { DEFAULT_CONFIG, DEFAULT_DESIGN, SimDocument } from '../model/document';
import { edgeDefaults, isEdge, NodeData, toDocument, toElements } from '../model/elements';
import { LibraryEntry, loadLibrary, persistLibrary } from '../model/library';
import type { CampaignProgress } from '../engine/mcCampaignRunner';
import type { McCampaignStats, McRunSample } from '../engine/mcStats';
import type { StabilityReport } from '../engine/stability';

export interface DesignView {
  summary: string;
  open: string[];
  closed: string[];
  gains: { id: string; value: number }[];
  opLabel?: string;
  /** Report for the currently selected MC run (0 = nominal). */
  report?: StabilityReport | null;
  /** Always the run-0 (nominal plant) stability report for plot overlays. */
  nominalReport?: StabilityReport | null;
  /** Monte Carlo ensemble traces (runs ≥ 1) drawn in grey behind nominal. */
  mcEnsemble?: { run: number; report: StabilityReport }[];
  /** Which MC run the detail report / amber highlight refers to. */
  selectedRun?: number;
  /** Large-N campaign aggregates (percentile bands, pole cloud, …). */
  mcCampaign?: McCampaignStats | null;
  /** Raw campaign samples (for selecting runs outside the overlay set). */
  mcSamples?: McRunSample[] | null;
  mcCampaignWs?: number[] | null;
  /** Live campaign progress (bar + ETA). */
  mcCampaignProgress?: CampaignProgress | null;
}

interface AppState {
  view: 'home' | 'editor';
  documentId: string | null;
  dirty: boolean;
  openSerial: number;
  entries: LibraryEntry[];
  elements: Elements;
  name: string;
  description: string;
  config: SimConfig;
  design: DesignConfig;
  designView: DesignView | null;
  selectedIds: string[];
  status: 'idle' | 'running' | 'paused' | 'done' | 'error';
  time: number;
  rate: number;
  message: string;
  errorIds: string[];
  openModel: (model: SimDocument, documentId: string | null) => void;
  closeToHome: () => void;
  saveLibrary: () => void;
  saveLibraryCopy: () => void;
  deleteEntry: (id: string) => void;
  setMeta: (patch: { name?: string; description?: string }) => void;
  setConfig: (patch: Partial<SimConfig>) => void;
  setDesignWeight: (index: number, value: number) => void;
  setDesignR: (value: number) => void;
  setDesignOpMode: (mode: LinearizationPoint) => void;
  setDesignOp: (patch: { xOp?: string; uOp?: string }) => void;
  setDesignAnalysis: (option: AnalysisOption, enabled: boolean) => void;
  setDesignView: (view: DesignView | null) => void;
  setSelected: (ids: string[]) => void;
  setStatus: (status: AppState['status'], message?: string, errorIds?: string[]) => void;
  setTime: (time: number, rate?: number) => void;
  updateParam: (id: string, key: string, value: Param) => void;
  /** Set / clear a parameter’s Monte Carlo distribution. Seed is assigned once and kept. */
  updateUncertainty: (id: string, key: string, patch: { kind: DistKind; spread?: number } | null) => void;
  updateAlias: (id: string, alias: string) => void;
  updatePosition: (id: string, x: number, y: number) => void;
  updatePositions: (nodes: Node[]) => void;
  addBlock: (blockType: string, position: { x: number; y: number }) => void;
  insertGraph: (
    nodes: { id: string; blockType: string; x: number; y: number; parameters?: Record<string, Param>; alias?: string; role?: string }[],
    edges: { source: string; sourceHandle: string; target: string; targetHandle: string }[]
  ) => void;
  connect: (connection: Connection | Edge) => void;
  removeIds: (ids: string[]) => void;
  setAnimated: (animated: boolean) => void;
  applyGain: (id: string, value: number) => void;
  document: () => ReturnType<typeof toDocument>;
}

export const useStore = create<AppState>((set, get) => ({
  view: 'home',
  documentId: null,
  dirty: false,
  openSerial: 0,
  entries: loadLibrary(),
  elements: [],
  name: 'Untitled',
  description: '',
  config: { ...DEFAULT_CONFIG },
  design: {
    Q: DEFAULT_DESIGN.Q.slice(),
    R: DEFAULT_DESIGN.R,
    opMode: DEFAULT_DESIGN.opMode,
    xOp: DEFAULT_DESIGN.xOp,
    uOp: DEFAULT_DESIGN.uOp,
    analysis: DEFAULT_DESIGN.analysis.slice(),
  },
  designView: null,
  selectedIds: [],
  status: 'idle',
  time: 0,
  rate: 0,
  message: 'Ready',
  errorIds: [],

  openModel: (model, documentId) => {
    set((state) => ({
      view: 'editor',
      documentId,
      dirty: false,
      openSerial: state.openSerial + 1,
      elements: toElements(model),
      name: model.name,
      description: model.description,
      config: { ...DEFAULT_CONFIG, ...model.config },
      design: {
        Q: (model.design?.Q ?? DEFAULT_DESIGN.Q).slice(),
        R: model.design?.R ?? DEFAULT_DESIGN.R,
        opMode: model.design?.opMode ?? DEFAULT_DESIGN.opMode,
        xOp: model.design?.xOp ?? DEFAULT_DESIGN.xOp,
        uOp: model.design?.uOp ?? DEFAULT_DESIGN.uOp,
        analysis: (model.design?.analysis ?? DEFAULT_DESIGN.analysis).slice(),
      },
      designView: null,
      selectedIds: [],
      status: 'idle',
      time: 0,
      rate: 0,
      message: model.name,
      errorIds: [],
    }));
  },

  closeToHome: () =>
    set({
      view: 'home',
      documentId: null,
      dirty: false,
      elements: [],
      selectedIds: [],
      status: 'idle',
      time: 0,
      rate: 0,
      message: 'Ready',
      errorIds: [],
      designView: null,
    }),

  saveLibrary: () => {
    const state = get();
    const id = state.documentId ?? uuid();
    const document = state.document();
    const next: LibraryEntry = { id, updatedAt: Date.now(), document };
    const entries = [next, ...state.entries.filter((entry) => entry.id !== id)];
    persistLibrary(entries);
    set({ entries, documentId: id, dirty: false, message: `Saved “${document.name}”` });
  },

  saveLibraryCopy: () => {
    const state = get();
    const id = uuid();
    const current = state.document();
    const document = { ...current, name: `${current.name} copy` };
    const next: LibraryEntry = { id, updatedAt: Date.now(), document };
    const entries = [next, ...state.entries];
    persistLibrary(entries);
    set({
      entries,
      documentId: id,
      name: document.name,
      dirty: false,
      message: `Saved “${document.name}”`,
    });
  },

  deleteEntry: (id) => {
    const entries = get().entries.filter((entry) => entry.id !== id);
    persistLibrary(entries);
    set({ entries });
  },

  setMeta: (patch) => set((state) => ({ ...patch, dirty: state.view === 'editor' ? true : state.dirty })),

  setConfig: (patch) => set((state) => ({ config: { ...state.config, ...patch }, dirty: true })),

  setDesignWeight: (index, value) =>
    set((state) => {
      const Q = state.design.Q.slice();
      Q[index] = value;
      return { design: { ...state.design, Q }, dirty: true };
    }),

  setDesignR: (value) => set((state) => ({ design: { ...state.design, R: value }, dirty: true })),

  setDesignOpMode: (opMode) => set((state) => ({ design: { ...state.design, opMode }, dirty: true })),

  setDesignOp: (patch) =>
    set((state) => ({
      design: {
        ...state.design,
        xOp: patch.xOp ?? state.design.xOp,
        uOp: patch.uOp ?? state.design.uOp,
      },
      dirty: true,
    })),

  setDesignAnalysis: (option, enabled) =>
    set((state) => {
      const setOpts = new Set(state.design.analysis);
      if (enabled) setOpts.add(option);
      else setOpts.delete(option);
      const order = DEFAULT_DESIGN.analysis;
      const analysis = order.filter((id) => setOpts.has(id));
      for (const id of setOpts) if (!analysis.includes(id)) analysis.push(id);
      return { design: { ...state.design, analysis }, dirty: true };
    }),

  setDesignView: (designView) => set({ designView }),

  setSelected: (selectedIds) => set({ selectedIds }),

  setStatus: (status, message, errorIds) =>
    set((state) => ({
      status,
      message: message ?? state.message,
      errorIds: errorIds ?? (status === 'error' ? state.errorIds : []),
    })),

  setTime: (time, rate) => set({ time, rate: rate ?? get().rate }),

  updateParam: (id, key, value) =>
    set((state) => ({
      elements: state.elements.map((element) => {
        if (isEdge(element) || element.id !== id) return element;
        const data = element.data as NodeData;
        return {
          ...element,
          data: { ...data, parameters: { ...data.parameters, [key]: value } },
        };
      }),
      dirty: true,
    })),

  updateUncertainty: (id, key, patch) =>
    set((state) => ({
      elements: state.elements.map((element) => {
        if (isEdge(element) || element.id !== id) return element;
        const data = element.data as NodeData;
        const current = { ...(data.uncertainty ?? {}) };
        if (!patch || patch.kind === 'none') {
          delete current[key];
          return {
            ...element,
            data: {
              ...data,
              uncertainty: Object.keys(current).length ? current : undefined,
            },
          };
        }
        const prev = current[key];
        const next: ParamUncertainty = {
          kind: patch.kind,
          seed: prev?.seed ?? newUncertaintySeed(),
          spread: patch.spread ?? prev?.spread ?? defaultSpread(patch.kind),
        };
        current[key] = next;
        return { ...element, data: { ...data, uncertainty: current } };
      }),
      dirty: true,
    })),

  updateAlias: (id, alias) =>
    set((state) => ({
      elements: state.elements.map((element) => {
        if (isEdge(element) || element.id !== id) return element;
        const data = element.data as NodeData;
        return { ...element, data: { ...data, alias } };
      }),
      dirty: true,
    })),

  updatePosition: (id, x, y) =>
    set((state) => ({
      elements: state.elements.map((element) =>
        !isEdge(element) && element.id === id ? { ...element, position: { x, y } } : element
      ),
      dirty: true,
    })),

  updatePositions: (nodes) =>
    set((state) => ({
      elements: state.elements.map((element) => {
        if (isEdge(element)) return element;
        const next = nodes.find((node) => node.id === element.id);
        return next ? { ...element, position: next.position } : element;
      }),
      dirty: true,
    })),

  addBlock: (blockType, position) => {
    const def = getBlock(blockType);
    if (!def) return;
    const node: Node = {
      id: uuid(),
      type: def.renderer,
      position,
      data: {
        blockType,
        alias: def.name,
        parameters: { ...def.defaultParameters },
      } as NodeData,
    };
    set((state) => ({ elements: [...state.elements, node], selectedIds: [node.id], message: `Added ${def.name}`, dirty: true }));
  },

  insertGraph: (nodes, edges) => {
    const idMap = new Map<string, string>();
    const created: Node[] = [];
    for (const item of nodes) {
      const def = getBlock(item.blockType);
      if (!def) continue;
      const id = uuid();
      idMap.set(item.id, id);
      created.push({
        id,
        type: def.renderer,
        position: { x: item.x, y: item.y },
        data: {
          blockType: item.blockType,
          alias: item.alias ?? def.name,
          role: item.role,
          parameters: { ...def.defaultParameters, ...(item.parameters ?? {}) },
        } as NodeData,
      });
    }
    const wireEdges: Edge[] = edges.flatMap((edge) => {
      const source = idMap.get(edge.source);
      const target = idMap.get(edge.target);
      if (!source || !target) return [];
      return [
        {
          id: uuid(),
          source,
          target,
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
          ...edgeDefaults,
        },
      ];
    });
    set((state) => ({
      elements: [...state.elements, ...created, ...wireEdges],
      selectedIds: created.map((node) => node.id),
      message: `Inserted ${created.length} blocks`,
      dirty: true,
    }));
  },

  connect: (connection) => {
    if (!connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) return;
    set((state) => {
      const sourceNode = state.elements.find((element) => !isEdge(element) && element.id === connection.source);
      const targetNode = state.elements.find((element) => !isEdge(element) && element.id === connection.target);
      if (sourceNode && targetNode && !isEdge(sourceNode) && !isEdge(targetNode)) {
        const sourceData = sourceNode.data as NodeData;
        const targetData = targetNode.data as NodeData;
        const sourceDef = getBlock(sourceData.blockType);
        const targetDef = getBlock(targetData.blockType);
        try {
          const sourcePort = sourceDef?.ports(sourceData.parameters).outputs.find((port) => port.id === connection.sourceHandle);
          const targetPort = targetDef?.ports(targetData.parameters).inputs.find((port) => port.id === connection.targetHandle);
          const a = sourcePort?.domain ?? 'signal';
          const b = targetPort?.domain ?? 'signal';
          if (a !== 'signal' && b !== 'signal' && a !== b) {
            return {
              ...state,
              message: `Cannot connect ${a} → ${b}. Domains must match (or use signal).`,
              status: state.status === 'running' ? state.status : state.status,
            };
          }
        } catch {
          // Invalid parameters — allow the wire; compile will report the issue.
        }
      }
      const kept = state.elements.filter(
        (element) =>
          !(isEdge(element) && element.target === connection.target && element.targetHandle === connection.targetHandle)
      );
      return {
        elements: addEdge(
          {
            ...connection,
            id: uuid(),
            ...edgeDefaults,
          },
          kept
        ),
        dirty: true,
      };
    });
  },

  removeIds: (ids) => {
    const drop = new Set(ids);
    set((state) => ({
      elements: state.elements.filter((element) => {
        if (drop.has(element.id)) return false;
        if (isEdge(element) && (drop.has(element.source) || drop.has(element.target))) return false;
        return true;
      }),
      selectedIds: state.selectedIds.filter((id) => !drop.has(id)),
      dirty: true,
    }));
  },

  setAnimated: (animated) =>
    set((state) => ({
      elements: state.elements.map((element) => (isEdge(element) ? { ...element, animated } : element)),
    })),

  applyGain: (id, value) =>
    set((state) => ({
      elements: state.elements.map((element) => {
        if (isEdge(element) || element.id !== id) return element;
        const data = element.data as NodeData;
        return { ...element, data: { ...data, parameters: { ...data.parameters, k: value } } };
      }),
      dirty: true,
    })),

  document: () => {
    const state = get();
    return toDocument(state.elements, { name: state.name, description: state.description }, state.config, state.design);
  },
}));

export function confirmClose(): boolean {
  const { view, dirty } = useStore.getState();
  if (view !== 'editor' || !dirty) return true;
  return window.confirm('This document has unsaved changes. Leave without saving?');
}

export function describePoles(poles: { real: number; imag: number }[]): string[] {
  return [...poles]
    .sort((a, b) => b.real - a.real)
    .map((pole) => formatPole(pole));
}

function defaultSpread(kind: DistKind): number {
  switch (kind) {
    case 'percent':
      return 5;
    case 'lognormal':
      return 0.1;
    case 'uniform':
      return 0.1;
    case 'normal':
      return 0.1;
    default:
      return 0;
  }
}
