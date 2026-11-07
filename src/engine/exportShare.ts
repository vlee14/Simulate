import { ExperimentResult } from './experiments';
import { McCampaignStats } from './mcStats';
import { SensitivityReport } from './sensitivity';
import { SimDocument } from '../model/document';

/** CSV of a single trace. */
export function traceToCsv(t: number[], y: number[], name = 'y'): string {
  const lines = [`t,${name}`];
  const n = Math.min(t.length, y.length);
  for (let i = 0; i < n; i++) lines.push(`${t[i]},${y[i]}`);
  return lines.join('\n');
}

/** CSV of MC envelope. */
export function envelopeToCsv(env: { t: number[]; p05: number[]; p50: number[]; p95: number[] }): string {
  const lines = ['t,p05,p50,p95'];
  for (let i = 0; i < env.t.length; i++) lines.push(`${env.t[i]},${env.p05[i]},${env.p50[i]},${env.p95[i]}`);
  return lines.join('\n');
}

export function experimentToJson(result: ExperimentResult): string {
  return JSON.stringify(
    {
      summary: result.summary,
      nominalMetrics: result.nominal.metrics,
      ensembleCount: result.ensemble.length,
      envelope: result.envelope,
      nominalTrace: result.nominal.trace,
    },
    null,
    2
  );
}

export function campaignToJson(stats: McCampaignStats): string {
  return JSON.stringify(
    {
      total: stats.total,
      ok: stats.ok,
      stableFraction: stats.stableFraction,
      alphaP50: stats.alphaP50,
      alphaP95: stats.alphaP95,
      gmP50: stats.gmP50,
      pmP50: stats.pmP50,
      backend: stats.backend,
      elapsedMs: stats.elapsedMs,
      overlayRuns: stats.overlayRuns,
    },
    null,
    2
  );
}

export function sensitivityToJson(report: SensitivityReport): string {
  return JSON.stringify(report, null, 2);
}

/** Compact URL-safe encoding of a document for share links. */
export function encodeDocumentShare(doc: SimDocument): string {
  const json = JSON.stringify(doc);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return b64;
}

export function decodeDocumentShare(payload: string): SimDocument {
  const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json) as SimDocument;
}

export function shareUrlForDocument(doc: SimDocument): string {
  const hash = `model=${encodeDocumentShare(doc)}`;
  if (typeof window === 'undefined') return `#${hash}`;
  return `${window.location.origin}${window.location.pathname}${window.location.search}#${hash}`;
}

export function readShareFromLocation(): SimDocument | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash.startsWith('model=')) return null;
  try {
    return decodeDocumentShare(hash.slice('model='.length));
  } catch {
    return null;
  }
}
