/**
 * Expression-valued plant / controller parameters.
 *
 * Numeric block fields remain defaults. Override any of them with:
 *   - a string expression in the field itself (e.g. rho: "1.225*exp(-h/8500)"), or
 *   - `paramExprs` / `gainExprs`: "rho=…; m=…" / "Kp=1+0.1*t; Ki=…"
 *
 * Plant expressions see `t`, state aliases / x1…, and input aliases / u1….
 * Controller gain schedules see `t`, measured schedule param `s`, and nominal `k` / `Kp`….
 * Design freezes schedules at (t*, s*) when analyzing.
 */
import { compileExpression } from './expr';
import { Param } from './types';

/** True when an expression mentions the schedule variable `s` (not `sin`, `sign`, …). */
export function expressionUsesSchedule(source: string): boolean {
  return /(^|[^A-Za-z0-9_])s([^0-9A-Za-z_]|$)/.test(String(source ?? ''));
}

/**
 * Resolve a Gain block's effective multiplier at (t, s).
 * Empty `kExpr` → constant `k`. Otherwise evaluate `kExpr` with vars `{t,s,k,u}`.
 */
export function resolveScheduledGain(
  parameters: Record<string, Param> | null | undefined,
  vars: { t?: number; s?: number; u?: number } = {}
): number {
  const src = parameters ?? {};
  const k0 = resolveParamValue(src.k, { t: vars.t ?? 0, s: vars.s ?? 0 }, 1);
  const expr = String(src.kExpr ?? '').trim();
  if (!expr) return k0;
  try {
    const n = evalParamExpression(expr, {
      t: vars.t ?? 0,
      s: vars.s ?? 0,
      k: k0,
      u: vars.u ?? 0,
    });
    return Number.isFinite(n) ? n : k0;
  } catch {
    return k0;
  }
}

/** Resolve PID gains, honoring optional `gainExprs` (`Kp=…; Ki=…; Kd=…; Tf=…`). */
export function resolvePidGains(
  parameters: Record<string, Param> | null | undefined,
  vars: { t?: number; s?: number } = {}
): { Kp: number; Ki: number; Kd: number; Tf: number } {
  const src = parameters ?? {};
  const bag = { t: vars.t ?? 0, s: vars.s ?? 0 };
  const keys = ['Kp', 'Ki', 'Kd', 'Tf'] as const;
  const defaults = { Kp: 1, Ki: 0, Kd: 0, Tf: 0.05 };
  const resolved = resolvePlantParameters(src, keys, defaults, bag);
  const overrides = parseExpressionAssignments(String(src.gainExprs ?? ''));
  for (const key of keys) {
    const expr = overrides[key];
    if (!expr) continue;
    try {
      const n = evalParamExpression(expr, { ...bag, k: resolved[key] ?? defaults[key] });
      if (Number.isFinite(n)) resolved[key] = n;
    } catch {
      /* keep */
    }
  }
  return {
    Kp: resolved.Kp ?? defaults.Kp,
    Ki: resolved.Ki ?? defaults.Ki,
    Kd: resolved.Kd ?? defaults.Kd,
    Tf: Math.max(1e-4, resolved.Tf ?? defaults.Tf),
  };
}

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
