import { expect } from 'vitest';
import { documentGraph } from '../model/examples';
import type { SimDocument } from '../model/document';
import { SimulationEngine } from '../engine/runtime';

/** Advance a document's engine to a wall-clock time (seconds). */
export function runEngine(doc: SimDocument, seconds: number): SimulationEngine {
  const graph = documentGraph(doc);
  const engine = new SimulationEngine(graph.nodes, graph.edges, doc.config);
  engine.compile();
  engine.reset();
  const h = doc.config.stepSize;
  while (engine.time < seconds - 1e-9) {
    engine.step(Math.min(h, seconds - engine.time));
  }
  return engine;
}

export function close(a: number, b: number, tol: number): void {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);
}
