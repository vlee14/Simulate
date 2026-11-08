/**
 * Expression-valued plant parameters.
 *
 * Numeric block fields remain defaults. Override any of them with:
 *   - a string expression in the field itself (e.g. rho: "1.225*exp(-h/8500)"), or
 *   - `paramExprs`: "rho=1.225*exp(-h/8500); m=max(900, 1110-0.02*t)"
 *
 * Expressions see `t`, state aliases / x1…, and input aliases / u1… supplied by the plant.
 * Design linearization re-evaluates schedules at each FD sample (frozen-time t from the OP).
 */
import { compileExpression } from './expr';
import { Param } from './types';

const exprCache = new Map<string, (vars: Record<string, number>) => number>();

export function evalParamExpression(source: string, vars: Record<string, number>): number {
  const key = source.trim();
  let fn = exprCache.get(key);
  if (!fn) {
    fn = compileExpression(key);
    exprCache.set(key, fn);
  }
  return fn(vars);
}

/** Parse `name=expr; name2=expr` (RHS may be a full math expression). */
export function parseExpressionAssignments(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(source ?? '').split(/[;\n]+/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    const expr = trimmed.slice(eq + 1).trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && expr) out[name] = expr;
  }
  return out;
}

const PURE_NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

/** Resolve a Param that may be a literal number or a math expression string. */
export function resolveParamValue(
  value: Param | undefined,
  vars: Record<string, number>,
  fallback: number
): number {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  const trimmed = String(value).trim();
  if (!trimmed) return fallback;
  if (PURE_NUMBER.test(trimmed)) {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : fallback;
  }
  try {
    const n = evalParamExpression(trimmed, vars);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Build numeric parameters from block fields + optional `paramExprs` overrides.
 * `paramExprs` wins over field values for the same key.
 */
export function resolvePlantParameters(
  parameters: Record<string, Param> | null | undefined,
  keys: readonly string[],
  defaults: Record<string, number>,
  vars: Record<string, number>
): Record<string, number> {
  const src = parameters ?? {};
  const out: Record<string, number> = {};
  for (const key of keys) {
    out[key] = resolveParamValue(src[key], vars, defaults[key] ?? 0);
  }
  const overrides = parseExpressionAssignments(String(src.paramExprs ?? ''));
  for (const [key, expr] of Object.entries(overrides)) {
    if (!keys.includes(key)) continue;
    try {
      const n = evalParamExpression(expr, vars);
      if (Number.isFinite(n)) out[key] = n;
    } catch {
      /* keep field / default */
    }
  }
  return out;
}
