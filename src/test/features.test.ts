/**
 * Minimal feature coverage — one focused check per product area.
 * Prefer short assertions; deep demos live in their own cases below.
 */
import { describe, expect, it } from 'vitest';
import { PLANT_RECIPES } from '../model/builder';
import {
  EXAMPLES,
  aircraftDocument,
  documentGraph,
  harmonicDocument,
  motorDocument,
  observerDocument,
  oscillatorDocument,
  pendulumDocument,
  pidDocument,
  pneumaticDocument,
  quadrotorDocument,
} from '../model/examples';
import { QUADROTOR_ODE, CART_DOUBLE_PENDULUM_ODE } from '../model/plants';
import { SCENE_AIRCRAFT, SCENE_CART_PENDULUM, SCENE_QUAD, SCENE_ROTOR, SCENE_TANK } from '../model/scenes';
import {
  AIRCRAFT_X0_SEED,
  DEFAULT_AIRCRAFT,
  aircraftDerivatives,
  aircraftPlantVars,
  linearizeAircraft,
  resolveAircraftParams,
  trimAircraft,
} from '../engine/aircraft6dof';
import { getBlock } from '../engine/blocks';
import { HistoryStack } from '../sim/history';
import { SimCompileError, compile } from '../engine/compile';
import { eigenvalues } from '../engine/eig';
import { runExperiment } from '../engine/experiments';
import { decodeDocumentShare, encodeDocumentShare, traceToCsv } from '../engine/exportShare';
import { compileExpression } from '../engine/expr';
import { frequencyResponseBatchCpu, packPlant } from '../engine/freqBatch';
import { designDynamicsLqr, lqr } from '../engine/lqr';
import { linearizeBlock } from '../engine/linearize';
import { sampleMcRange } from '../engine/mcSample';
import { aggregateCampaign, clampCampaignSize, percentile, pickOverlayRuns } from '../engine/mcStats';
import { applyMonteCarlo, countUncertainParams, drawNumeric, recommendMcRuns } from '../engine/montecarlo';
import { SimulationEngine } from '../engine/runtime';
import {
  fitStageCamera,
  parseStageConfig,
  stageFollowPoint,
  stageTrailTip,
  stageWorldBounds,
  worldToCanvas,
} from '../engine/scene';
import { runSensitivity } from '../engine/sensitivity';
import {
  analyzeStability,
  closedLoopMatrix,
  frequencyResponse,
  logspace,
  loopMargins,
  loopResponse,
  parseVector,
  rootLocus,
} from '../engine/stability';
import { expandGraph, stringifyBlueprint } from '../engine/subsystem';
import { CONTROLLER_OPTIONS } from '../engine/controllers';
import {
  niceBounds,
  niceTicks,
  nicholsPhaseSeries,
  resolveAxisBounds,
  symmetricLimit,
  wrapNicholsPhase,
} from '../engine/plotAxes';
import {
  designDeadbeat,
  designLead,
  designLqi,
  designObserverLqr,
  parsePoleList,
  placePolesSiso,
  tunePidImc,
} from '../engine/synthesis';
import { close, runEngine } from './helpers';

describe('plot axes', () => {
  it('wraps Nichols phase into [−180°, 180°] and splits wrap jumps', () => {
    expect(wrapNicholsPhase(10)).toBe(10);
    expect(wrapNicholsPhase(-180)).toBe(-180);
    expect(wrapNicholsPhase(190)).toBe(-170);
    expect(wrapNicholsPhase(-400)).toBe(-40);
    expect(niceTicks(-2, 2, 5).length).toBeGreaterThanOrEqual(3);
    const segs = nicholsPhaseSeries([
      { phaseDeg: 170, magDb: 0 },
      { phaseDeg: 190, magDb: -1 },
      { phaseDeg: -170, magDb: -2 },
    ]);
    expect(segs.length).toBeGreaterThanOrEqual(2);
  });

  it('picks padded nice bounds and robust complex limits', () => {
    const bode = niceBounds(-3, 12, { padFrac: 0.1, minSpan: 10, anchors: [0] });
    expect(bode.min).toBeLessThanOrEqual(-3);
    expect(bode.max).toBeGreaterThanOrEqual(12);
    expect(bode.min).toBeLessThanOrEqual(0);
    const nichols = niceBounds(-120, -40, {
      padFrac: 0.08,
      minSpan: 90,
      anchors: [-180, 0, 180],
      clamp: { min: -180, max: 180 },
    });
    expect(nichols.min).toBeGreaterThanOrEqual(-180);
    expect(nichols.max).toBeLessThanOrEqual(180);
    expect(nichols.max - nichols.min).toBeGreaterThanOrEqual(90);
    const lim = symmetricLimit([0.5, 0.8, 1.2, 1.1, 50], { floor: 2, ceil: 12, percentile: 0.9, include: [1] });
    expect(lim).toBeGreaterThanOrEqual(2);
    expect(lim).toBeLessThanOrEqual(12);
    const manual = resolveAxisBounds(
      { xMin: -2, xMax: 2, yMin: -1, yMax: 1 },
      { xMin: -5, yMax: 3 }
    );
    expect(manual.xMin).toBe(-5);
    expect(manual.xMax).toBe(2);
    expect(manual.yMin).toBe(-1);
    expect(manual.yMax).toBe(3);
  });
});

describe('controller synthesis', () => {
  it('catalog covers optimal, classical, compensators, observers', () => {
    expect(CONTROLLER_OPTIONS.length).toBeGreaterThanOrEqual(12);
    expect(CONTROLLER_OPTIONS.some((o) => o.id === 'lqi')).toBe(true);
    expect(CONTROLLER_OPTIONS.some((o) => o.id === 'hinf-loop')).toBe(true);
    expect(CONTROLLER_OPTIONS.some((o) => o.id === 'leadlag')).toBe(true);
  });

  it('LQI, observer, lead, deadbeat produce finite gains', () => {
    const A = [
      [0, 1],
      [-2, -0.8],
    ];
    const B = [[0], [1]];
    const lqi = designLqi(A, B, [10, 1], 1, 25);
    expect(lqi.Kx.length).toBe(2);
    expect(Number.isFinite(lqi.Ki)).toBe(true);
    expect(lqi.polesClosed.every((p) => p.real < 0)).toBe(true);

    const obs = designObserverLqr(A, [10, 1], 1);
    expect(obs.L.length).toBe(2);
    expect(obs.poles.every((p) => p.real < 0)).toBe(true);

    const lead = designLead({ omegaC: 4, phaseBoostDeg: 40 });
    expect(lead.numerator.split(/\s+/).length).toBe(2);
    expect(lead.denominator.split(/\s+/).length).toBe(2);

    const db = designDeadbeat(A, B, 0.05);
    expect(db.K.length).toBe(2);
    expect(db.K.every((k) => Number.isFinite(k))).toBe(true);
  });
});

describe('core numerics', () => {
  it('eigenvalues and scalar LQR', () => {
    const reals = eigenvalues([
      [0, 1],
      [-2, -3],
    ])
      .map((e) => e.real)
      .sort((a, b) => a - b);
    close(reals[0], -2, 1e-6);
    close(reals[1], -1, 1e-6);
    close(lqr([[0]], [[1]], [1], 1).K[0], 1, 1e-5);
  });

  it('expressions and algebraic-loop detection', () => {
    const expr = compileExpression('sin(u1)^2 + cos(u1)^2 + 0.5*u2');
    close(expr({ u1: 0.4, u2: 4 }), 3, 1e-9);
    expect(() =>
      compile(
        [
          { id: 'a', blockType: 'gain', parameters: { k: 1 } },
          { id: 'b', blockType: 'gain', parameters: { k: 1 } },
        ],
        [
          { id: 'e1', source: 'a', sourceHandle: 'out', target: 'b', targetHandle: 'in' },
          { id: 'e2', source: 'b', sourceHandle: 'out', target: 'a', targetHandle: 'in' },
        ]
      )
    ).toThrow(SimCompileError);
  });
});

describe('aircraft 6-DoF (NASA H-1391)', () => {
  it('trims wings-level cruise and FD-linearizes for Design analysis', () => {
    const trim = trimAircraft(DEFAULT_AIRCRAFT, { V: 60, h: 1000 });
    expect(trim.residual).toBeLessThan(1e-6);
    const f = aircraftDerivatives(trim.x, trim.u, DEFAULT_AIRCRAFT);
    // At trim: rotational/α/β accelerations ~0; North speed ≈ V.
    expect(Math.hypot(f[0]!, f[1]!, f[2]!, f[4]!, f[5]!)).toBeLessThan(1e-4);
    expect(f[10]!).toBeCloseTo(60, 0);

    const { A, B } = linearizeAircraft(trim.x, trim.u, DEFAULT_AIRCRAFT);
    expect(A).toHaveLength(12);
    expect(B[0]).toHaveLength(4);
    const viaBlock = linearizeBlock('aircraft', { ...DEFAULT_AIRCRAFT, x0: trim.x.join(' ') }, trim.x, trim.u);
    expect(viaBlock.A[3]![3]).toBeCloseTo(A[3]![3]!, 2);

    // Open-loop A (about trim) should be finite; Design FD path matches dedicated linearizeAircraft.
    expect(eigenvalues(A).every((e) => Number.isFinite(e.real))).toBe(true);
    // Elevator channel loop for margins / Bode (SISO return ratio about trim).
    const Bde = B.map((row) => [row[0] ?? 0]);
    const Kpitch = new Array(12).fill(0);
    Kpitch[1] = 0.4; // q feedback → δe
    Kpitch[4] = 1.2; // α feedback → δe
    const loop = analyzeStability(A, Bde, Kpitch, ['poles', 'bode', 'nyquist', 'nichols', 'margins']);
    expect(loop.freq.length).toBeGreaterThan(20);
    expect(loop.margins).toBeTruthy();

    const def = getBlock('aircraft');
    expect(def?.continuousStates({})).toBe(12);
    expect(PLANT_RECIPES.some((r) => r.id === 'aircraft')).toBe(true);
    expect(SCENE_AIRCRAFT.inputs.includes('xN')).toBe(true);
    expect(aircraftDocument().nodes.some((n) => n.blockType === 'aircraft')).toBe(true);
  });

  it('resolves scheduled plant parameters from states and time', () => {
    const params = {
      ...DEFAULT_AIRCRAFT,
      paramExprs: 'rho=1.225*exp(-h/8500); m=max(900, 1110-0.02*t)',
    };
    const atSL = resolveAircraftParams(params, aircraftPlantVars(AIRCRAFT_X0_SEED, [0, 0, 0, 0.4], 0));
    // seed h=1000 → ρ ≈ 1.225·e^(−1000/8500)
    expect(atSL.rho).toBeCloseTo(1.225 * Math.exp(-1000 / 8500), 5);
    expect(atSL.m).toBeCloseTo(1110, 5);

    const high = resolveAircraftParams(
      params,
      aircraftPlantVars([0, 0, 0, 60, 0.05, 0, 0, 0.05, 0, 5000, 0, 0], [0, 0, 0, 0.4], 0)
    );
    expect(high.rho).toBeCloseTo(1.225 * Math.exp(-5000 / 8500), 5);
    expect(high.rho).toBeLessThan(atSL.rho);

    const burned = resolveAircraftParams(
      params,
      aircraftPlantVars(AIRCRAFT_X0_SEED, [0, 0, 0, 0.4], 20_000)
    );
    expect(burned.m).toBe(900); // floor of max(900, 1110-400)

    const trim = trimAircraft(
      (x, u) => resolveAircraftParams(params, aircraftPlantVars(x, u, 0)),
      { V: 60, h: 1000 }
    );
    expect(trim.residual).toBeLessThan(1e-4);

    const viaBlock = linearizeBlock('aircraft', { ...params, x0: trim.x.join(' ') }, trim.x, trim.u);
    expect(viaBlock.A).toHaveLength(12);
    expect(eigenvalues(viaBlock.A).every((e) => Number.isFinite(e.real))).toBe(true);

    // Analysis time t* freezes m(t): A at t=0 differs from A at t=20000 (mass floor).
    const at0 = linearizeBlock('aircraft', { ...params, x0: trim.x.join(' ') }, trim.x, trim.u, 1e-6, 0);
    const atBurn = linearizeBlock('aircraft', { ...params, x0: trim.x.join(' ') }, trim.x, trim.u, 1e-6, 20_000);
    expect(Math.abs((at0.A[3]?.[3] ?? 0) - (atBurn.A[3]?.[3] ?? 0))).toBeGreaterThan(1e-6);

    const doc = aircraftDocument();
    const plant = doc.nodes.find((n) => n.blockType === 'aircraft');
    expect(String(plant?.parameters?.paramExprs ?? '')).toContain('rho=');
    expect(doc.design.tOp).toBe(10);
  });
});

describe('dynamics + LQR + stability', () => {
  it('ODE plant falls open-loop and LQR stabilizes upright', () => {
    const openLoop = new SimulationEngine(
      [{ id: 'plant', blockType: 'ode', parameters: { ...CART_DOUBLE_PENDULUM_ODE, x0: '0 0.08 0 0 0 0' } }],
      [],
      { solver: 'rk4', stepSize: 0.001, stopTime: 0.5, startTime: 0, speed: 1 }
    );
    openLoop.compile();
    openLoop.reset();
    while (openLoop.time < 0.45 - 1e-9) openLoop.step(0.001);
    expect(Math.abs(openLoop.compiled!.byId.get('plant')!.outputs.y1)).toBeGreaterThan(0.15);

    const { A, B } = linearizeBlock('ode', { ...CART_DOUBLE_PENDULUM_ODE });
    expect(eigenvalues(A).some((e) => e.real > 0.5)).toBe(true);
    const designed = designDynamicsLqr('ode', { ...CART_DOUBLE_PENDULUM_ODE }, [40, 20, 20, 10, 0.5, 0.5], 0.8);
    expect(designed.polesClosed.every((e) => e.real < 0)).toBe(true);

    const report = analyzeStability(
      A,
      B.map((row) => [row[0] ?? 0]),
      designed.K,
      ['poles', 'ctrb', 'margins', 'bode', 'nyquist', 'nichols', 'rlocus']
    );
    expect(report.closedStable).toBe(true);
    expect(report.freq.length).toBeGreaterThan(20);
    expect(report.rootLocus.length).toBe(6);
    expect(report.margins).toBeTruthy();
    expect(report.conclusions.closedLoop).toBe('stable');
    expect(report.conclusions.headline.length).toBeGreaterThan(0);
    expect(report.conclusions.bullets.length).toBeGreaterThan(1);
    expect(report.summary[0]).toBe(report.conclusions.headline);
    expect(parseVector('0 0.2 -0.1 0 0 0', 6)[1]).toBeCloseTo(0.2);
  });

  it('always attaches conclusions and margins, including delay margin when PM/ω_gc exist', () => {
    // L(s)=2/(s+1) → ω_gc=√3, PM=120°, GM undefined (no −180° cross).
    const A = [[-1]];
    const B = [[1]];
    const K = [2];
    const report = analyzeStability(A, B, K, ['poles']);
    expect(report.conclusions.closedLoop).toBe('stable');
    expect(report.margins).not.toBeNull();
    expect(report.margins!.phaseMarginDeg!).toBeCloseTo(120, 0);
    expect(report.margins!.gainCrossoverRad!).toBeCloseTo(Math.sqrt(3), 1);
    expect(report.margins!.gainMarginDb).toBeNull();
    expect(report.margins!.delayMarginSec!).toBeCloseTo(((120 * Math.PI) / 180) / Math.sqrt(3), 1);
    expect(report.conclusions.margins).toBe('adequate');
    expect(report.conclusions.bullets.some((b) => /margin/i.test(b))).toBe(true);
  });
});

describe('stability analysis correctness', () => {
  it('matches analytical GM/PM for L=4/(s+1)^3 and skips delay margin when PM≤0', () => {
    // Companion form of 1/(s+1)^3; K=[4,0,0] → L=4/(s+1)^3.
    // Phase −180° at ω=√3 with |L|=1/2 → GM=6 dB.
    const A = [
      [0, 1, 0],
      [0, 0, 1],
      [-1, -3, -3],
    ];
    const B = [[0], [0], [1]];
    const K = [4, 0, 0];
    const m = loopMargins(A, B, K);
    expect(m.phaseCrossoverRad!).toBeCloseTo(Math.sqrt(3), 1);
    expect(m.gainMarginDb!).toBeCloseTo(6.02, 0);
    const wgc = Math.sqrt(Math.pow(4, 2 / 3) - 1);
    const pm = 180 - (3 * Math.atan(wgc) * 180) / Math.PI;
    expect(m.gainCrossoverRad!).toBeCloseTo(wgc, 1);
    expect(m.phaseMarginDeg!).toBeCloseTo(pm, 0);

    const bad = loopMargins(A, B, [40, 0, 0]);
    expect(bad.phaseMarginDeg!).toBeLessThan(0);
    expect(bad.delayMarginSec).toBeNull();
  });

  it('gain-scales the Nichols locus through the origin for LF/HF ω_gc and phase-crossover GM', () => {
    // Plant G=1/(s+1)^3. Scaling K shifts |L| dB so chosen frequencies hit the Nichols origin axes.
    const A = [
      [0, 1, 0],
      [0, 0, 1],
      [-1, -3, -3],
    ];
    const B = [[0], [0], [1]];
    const unit = [1, 0, 0];
    const scaleToUnityAt = (w: number) => {
      const G = loopResponse(A, B, unit, w)!;
      const mag = Math.hypot(G.re, G.im);
      expect(mag).toBeGreaterThan(1e-9);
      return [1 / mag, 0, 0];
    };

    const phaseOfG = (w: number) => (-3 * Math.atan(w) * 180) / Math.PI;

    // Low-frequency 0 dB cross: shift plot so |L(ω_lo)|=1 → ω_gc reports that frequency.
    const wLo = 0.4;
    const Klo = scaleToUnityAt(wLo);
    const mLo = loopMargins(A, B, Klo, frequencyResponse(A, B, Klo, 240));
    expect(mLo.gainCrossoverRad!).toBeCloseTo(wLo, 1);
    const Llo = loopResponse(A, B, Klo, mLo.gainCrossoverRad!)!;
    expect(Math.hypot(Llo.re, Llo.im)).toBeCloseTo(1, 2);
    expect(mLo.phaseMarginDeg!).toBeCloseTo(180 + phaseOfG(mLo.gainCrossoverRad!), 0);

    // High-frequency 0 dB cross (same plant, higher gain scale → crossing further along the locus).
    const wHi = 2.2;
    const Khi = scaleToUnityAt(wHi);
    const mHi = loopMargins(A, B, Khi, frequencyResponse(A, B, Khi, 240));
    expect(mHi.gainCrossoverRad!).toBeCloseTo(wHi, 1);
    const Lhi = loopResponse(A, B, Khi, mHi.gainCrossoverRad!)!;
    expect(Math.hypot(Lhi.re, Lhi.im)).toBeCloseTo(1, 2);
    expect(mHi.phaseMarginDeg!).toBeCloseTo(180 + phaseOfG(mHi.gainCrossoverRad!), 0);

    // Phase margin / GM at critical point: |L(j√3)|=1 ⇒ locus through (−180°, 0 dB), GM≈0, ω_pc=√3.
    const wPc = Math.sqrt(3);
    const Kpc = scaleToUnityAt(wPc);
    const mPc = loopMargins(A, B, Kpc, frequencyResponse(A, B, Kpc, 240));
    expect(mPc.phaseCrossoverRad!).toBeCloseTo(wPc, 1);
    expect(Math.abs(mPc.gainMarginDb!)).toBeLessThan(0.35);
    const Lpc = loopResponse(A, B, Kpc, mPc.phaseCrossoverRad!)!;
    expect(Lpc.re).toBeLessThan(0);
    expect(Math.abs(Lpc.im)).toBeLessThan(0.05);
    expect(Math.hypot(Lpc.re, Lpc.im)).toBeCloseTo(1, 2);
  });

  it('keeps Bode/Nyquist/Nichols samples consistent with L(jω)=K(jωI−A)⁻¹B', () => {
    const A = [
      [0, 1],
      [0, -1],
    ];
    const B = [[0], [1]];
    const K = [1, 0]; // L=1/(s(s+1))
    const freq = frequencyResponse(A, B, K, 80);
    expect(freq.length).toBeGreaterThan(40);
    for (const p of freq) {
      const L = loopResponse(A, B, K, p.w)!;
      expect(p.re).toBeCloseTo(L.re, 8);
      expect(p.im).toBeCloseTo(L.im, 8);
      expect(p.mag).toBeCloseTo(Math.hypot(L.re, L.im), 8);
      expect(p.magDb).toBeCloseTo(20 * Math.log10(Math.max(p.mag, 1e-16)), 4);
      // Unwrapped phase stays within 180° of principal arg.
      let principal = (Math.atan2(L.im, L.re) * 180) / Math.PI;
      while (principal - p.phaseDeg > 180) principal -= 360;
      while (principal - p.phaseDeg < -180) principal += 360;
      expect(Math.abs(principal - p.phaseDeg)).toBeLessThan(1e-6);
    }
    const m = loopMargins(A, B, K, freq);
    // |L|=1 ⇒ ω√(ω²+1)=1 ⇒ ω²=(-1+√5)/2, PM=90°+atan(ω) complement → ≈51.83°.
    const w = Math.sqrt((-1 + Math.sqrt(5)) / 2);
    expect(m.gainCrossoverRad!).toBeCloseTo(w, 2);
    expect(m.phaseMarginDeg!).toBeCloseTo(180 - 90 - (Math.atan(w) * 180) / Math.PI, 0);
    expect(m.gainMarginDb).toBeNull();
  });

  it('reports open/closed poles, damping, controllability, and root locus at ρ=1', () => {
    const A = [
      [0, 1],
      [-2, -0.4],
    ];
    const B = [[0], [1]];
    const K = [0.5, 0.2];
    const report = analyzeStability(A, B, K, ['poles', 'ctrb', 'damping', 'rlocus', 'margins']);
    const open = eigenvalues(A);
    const closed = eigenvalues(closedLoopMatrix(A, B, K));
    expect(report.polesOpen).toHaveLength(2);
    expect(report.polesClosed).toHaveLength(2);
    for (const p of open) {
      expect(Math.min(...report.polesOpen.map((q) => Math.hypot(q.real - p.real, q.imag - p.imag)))).toBeLessThan(1e-6);
    }
    for (const p of closed) {
      expect(Math.min(...report.polesClosed.map((q) => Math.hypot(q.real - p.real, q.imag - p.imag)))).toBeLessThan(1e-6);
    }
    expect(report.closedStable).toBe(closed.every((e) => e.real < 0));
    expect(report.controllable).toBe(true);
    expect(report.controllabilityRank).toBe(2);
    expect(report.modes.length).toBeGreaterThanOrEqual(1);
    const osc = report.modes.find((m) => m.imag > 0);
    if (osc) {
      expect(osc.wn).toBeCloseTo(Math.hypot(osc.real, osc.imag), 8);
      expect(osc.zeta).toBeCloseTo(-osc.real / osc.wn, 8);
    }
    const locus = rootLocus(A, B, K, 24, 1);
    const atOne = locus.map((b) => b.points[b.points.length - 1]);
    for (const p of closed) {
      const d = Math.min(...atOne.map((q) => Math.hypot(q.real - p.real, q.imag - p.imag)));
      expect(d).toBeLessThan(0.05);
    }
    expect(report.freq.length).toBeGreaterThan(0);
    expect(report.margins).toBeTruthy();
  });
});

describe('stage DSL + camera', () => {
  it('parses scene data and follows cart / chase subjects', () => {
    const stage = pendulumDocument().nodes.find((n) => n.blockType === 'stage')!;
    const cfg = parseStageConfig(stage.parameters ?? {});
    expect(cfg.elements.length).toBeGreaterThanOrEqual(3);
    expect(cfg.control?.block).toBe('manual');
    expect(stageTrailTip(cfg, { x: 0.1, th1: 0.2, th2: -0.1, force: 1 })).toBeTruthy();
    expect(SCENE_CART_PENDULUM.inputs.includes('th1')).toBe(true);

    const far = { x: 2.4, th1: 0.15, th2: -0.1, force: 0 };
    const bounds = stageWorldBounds(cfg, far)!;
    expect((bounds.minX + bounds.maxX) / 2).toBeGreaterThan(1.5);
    const cam = fitStageCamera(cfg, far, 640, 220, null);
    expect(cam.lookX).toBeGreaterThan(1.2);

    const quadCfg = parseStageConfig({ ...SCENE_QUAD });
    const chase = { x: 12.9, z: 2.9, theta: 0, nose: 1.57, xt: 1.4, zt: 2.9, thrust: 12 };
    const follow = stageFollowPoint(quadCfg, chase)!;
    const chaseCam = fitStageCamera(quadCfg, chase, 420, 220, {
      scale: 56,
      lookX: follow.x - 3,
      lookY: follow.y - 1,
      originX: 210,
      originY: 110,
    });
    expect(chaseCam.lookX).toBeCloseTo(follow.x, 5);
    const px = worldToCanvas(chaseCam, follow.x, follow.y);
    expect(Math.abs(px.x - 210)).toBeLessThan(1);
  });
});

describe('runtime blocks', () => {
  it('manual+pulse feedthrough and sensor gain/bias', () => {
    const control = new SimulationEngine(
      [
        { id: 'manual', blockType: 'manual', parameters: { value: 0, min: -10, max: 10 } },
        { id: 'pulse', blockType: 'pulse', parameters: { amplitude: 5, delay: 1e9, width: 0.2, period: 0 } },
        { id: 'sum', blockType: 'sum', parameters: { signs: '++' } },
      ],
      [
        { id: 'e1', source: 'manual', sourceHandle: 'out', target: 'sum', targetHandle: 'in0' },
        { id: 'e2', source: 'pulse', sourceHandle: 'out', target: 'sum', targetHandle: 'in1' },
      ],
      { solver: 'rk4', stepSize: 0.01, stopTime: 1, startTime: 0, speed: 1 }
    );
    control.compile();
    control.reset();
    control.rebuildParams([
      { id: 'manual', blockType: 'manual', parameters: { value: 3, min: -10, max: 10 } },
      { id: 'pulse', blockType: 'pulse', parameters: { amplitude: 5, delay: 0, width: 0.2, period: 0 } },
      { id: 'sum', blockType: 'sum', parameters: { signs: '++' } },
    ]);
    control.step(0.01);
    close(control.compiled!.byId.get('sum')!.outputs.out, 8, 1e-9);

    const sens = new SimulationEngine(
      [
        { id: 'c', blockType: 'constant', parameters: { value: 1 } },
        { id: 's', blockType: 'sensor', parameters: { gain: 2, bias: 0.5, noise: 0, tau: 0 } },
      ],
      [{ id: 'e', source: 'c', sourceHandle: 'out', target: 's', targetHandle: 'in' }],
      { solver: 'rk4', stepSize: 0.01, stopTime: 0.05, startTime: 0, speed: 1 }
    );
    sens.compile();
    sens.reset();
    sens.step(0.01);
    close(sens.compiled!.byId.get('s')!.outputs.out, 2.5, 1e-9);
  });

  it('expands plant recipe subsystems', () => {
    const recipe = PLANT_RECIPES.find((item) => item.id === 'cart-pendulum')!;
    const expanded = expandGraph(
      [{ id: 'pack', blockType: 'subsystem', parameters: { blueprint: stringifyBlueprint(recipe.blueprint!()) } }],
      []
    );
    expect(expanded.nodes.some((n) => n.blockType === 'ode')).toBe(true);
    expect(expanded.nodes.some((n) => n.blockType === 'subsystem')).toBe(false);
  });
});

describe('example demos', () => {
  it('ships MC + Design defaults on every example', () => {
    for (const example of EXAMPLES) {
      const demo = example.create();
      expect(countUncertainParams(documentGraph(demo).nodes)).toBeGreaterThan(0);
      expect(demo.config.mcCampaignSize ?? 0).toBeGreaterThanOrEqual(500);
      expect(demo.design.analysis).toContain('bode');
    }
    expect(SCENE_ROTOR.control && SCENE_ROTOR.disturbance).toBeTruthy();
    expect(SCENE_TANK.control && SCENE_TANK.disturbance).toBeTruthy();
    expect(harmonicDocument().nodes.some((n) => n.blockType === 'secondorder')).toBe(true);
  });

  it('balances pendulum and settles plant demos', () => {
    const eng = runEngine(pendulumDocument(), 14);
    const plant = eng.compiled!.byId.get('plant')!;
    expect(Math.abs(plant.outputs.y1)).toBeLessThan(0.06);
    expect(Math.abs(plant.outputs.y0)).toBeLessThan(0.25);

    expect(Math.abs(runEngine(oscillatorDocument(), 14).compiled!.byId.get('mass')!.outputs.x - 1)).toBeLessThan(0.2);
    expect(Math.abs(runEngine(motorDocument(), 3.5).compiled!.byId.get('motor')!.outputs.w - 5)).toBeLessThan(1);
    expect(runEngine(pneumaticDocument(), 9).compiled!.byId.get('tank')!.outputs.p).toBeGreaterThan(2);
  });

  it('quadrotor Pro-Nav chase closes range', () => {
    const quad = quadrotorDocument();
    expect(quad.nodes.some((n) => n.blockType === 'pronav')).toBe(true);
    expect(quad.nodes.filter((n) => n.blockType === 'pid').length).toBeGreaterThanOrEqual(3);
    expect(QUADROTOR_ODE.nx).toBe(10);

    const out = runEngine(quad, 6).compiled!.byId.get('plant')!;
    const xi = out.outputs.y0;
    const xt = out.outputs.y6;
    expect(xi).toBeGreaterThan(1);
    expect(Math.hypot(xt - xi, out.outputs.y7 - out.outputs.y1)).toBeLessThan(8);
  });

  it('observer + Kalman demo stays finite', () => {
    const eng = runEngine(observerDocument(), 1.5);
    expect(Number.isFinite(eng.compiled!.byId.get('obs')!.outputs.x0)).toBe(true);
    expect(Number.isFinite(eng.compiled!.byId.get('kf')!.outputs.x0)).toBe(true);
  });
});

describe('monte carlo', () => {
  it('seeded draws, recommendations, and campaign aggregate', () => {
    const unc = { kind: 'normal' as const, seed: 0xc0ffee, spread: 0.5 };
    close(drawNumeric(1, unc, 0), 1, 0);
    close(drawNumeric(1, unc, 1), drawNumeric(1, unc, 1), 0);

    const nodes = [
      {
        id: 'mass',
        blockType: 'mass',
        parameters: { m: 1, x0: 0, v0: 0 } as Record<string, number>,
        uncertainty: { m: unc },
      },
    ];
    close(Number(applyMonteCarlo(nodes, 1)[0].parameters.m), drawNumeric(1, unc, 1), 1e-12);

    const advice = recommendMcRuns(
      [
        {
          id: 'm',
          blockType: 'mass',
          parameters: { m: 2, x0: 0, v0: 0 } as Record<string, number>,
          uncertainty: { m: { kind: 'percent' as const, seed: 1, spread: 10 } },
        },
      ],
      { confidence: 0.95, relError: 0.05 }
    );
    close(advice.cv, 0.1, 1e-9);
    close(clampCampaignSize(50_000), 10_000, 0);
    close(percentile([1, 2, 3, 4, 5], 0.5), 3, 0);
    expect(pickOverlayRuns(100, 10, 42)).toContain(42);

    const plantNodes = [
      {
        id: 'plant',
        blockType: 'secondorder',
        parameters: { wn: 2, zeta: 0.3, y0: 0, dy0: 0 } as Record<string, number>,
        uncertainty: { wn: { kind: 'percent' as const, seed: 9, spread: 5 } },
      },
    ];
    const samples = sampleMcRange({
      plantId: 'plant',
      blockType: 'secondorder',
      nodes: plantNodes as never,
      xOp: [0, 0],
      uOp: [0],
      K: [1, 0.5],
      runStart: 1,
      runEnd: 12,
      computeFreq: true,
      nOmega: 32,
    });
    expect(samples.length).toBeGreaterThanOrEqual(8);
    const ws = logspace(1e-3, 1e3, 32);
    const stats = aggregateCampaign(samples, ws, { overlayCount: 6, backend: 'cpu', elapsedMs: 1 });
    expect(stats.bodeMag?.p50.length).toBe(32);
    const packed = [packPlant([[0, 1], [-4, -1.2]], [[0], [1]])];
    expect(frequencyResponseBatchCpu(packed, [1, 0.5], ws).length).toBe(32 * 4);
  });
});

describe('lab suite', () => {
  it('experiments, sensitivity, synthesis, share, undo', () => {
    const doc = pidDocument();
    const graph = documentGraph(doc);
    const exp = runExperiment(graph.nodes, graph.edges, doc.config, {
      kind: 'step',
      outputBlock: 'plant',
      outputPort: 'y',
      inputBlock: 'ref',
      stopTime: 4,
      stepSize: 0.005,
      mcRuns: 8,
    });
    expect(exp.nominal.trace.t.length).toBeGreaterThan(10);
    expect(traceToCsv(exp.nominal.trace.t, exp.nominal.trace.y)).toContain('\n');

    const sens = runSensitivity(graph.nodes, graph.edges, doc.config, {
      outputBlock: 'plant',
      outputPort: 'y',
      inputBlock: 'ref',
      kind: 'step',
      metric: 'settlingTime',
    });
    expect(sens.tornado.length).toBeGreaterThanOrEqual(1);

    const place = placePolesSiso(
      [
        [0, 1],
        [-2, -0.8],
      ],
      [[0], [1]],
      parsePoleList('-2 -3')
    );
    expect(place.K.length).toBe(2);
    expect(tunePidImc('secondorder', { wn: 2, zeta: 0.3, K: 1 }).Kp).not.toBe(0);

    const obs = observerDocument();
    const shared = decodeDocumentShare(encodeDocumentShare(obs));
    expect(shared.nodes.length).toBe(obs.nodes.length);

    const hist = new HistoryStack();
    const snapA = {
      elements: [] as never[],
      name: 'A',
      description: '',
      config: { ...obs.config },
      design: { ...obs.design },
    };
    hist.push(snapA);
    const snapB = { ...snapA, name: 'B' };
    expect(hist.undo(snapB)?.name).toBe('A');
  });
});
