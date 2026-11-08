import { ControllerKind } from './types';

export interface ControllerOption {
  id: ControllerKind;
  group: 'Optimal' | 'Classical' | 'Compensators' | 'Observers' | 'Advanced';
  label: string;
  help: string;
  /** Where gains / parameters are written. */
  target: 'state-feedback' | 'pid' | 'transfer' | 'observer' | 'lqg';
}

/** Catalog of synthesizable controllers available in Design. */
export const CONTROLLER_OPTIONS: ControllerOption[] = [
  {
    id: 'lqr',
    group: 'Optimal',
    label: 'LQR (state feedback)',
    help: 'Linear-quadratic regulator → roles k0… / kref',
    target: 'state-feedback',
  },
  {
    id: 'lqi',
    group: 'Optimal',
    label: 'LQI (integral LQR)',
    help: 'Augmented LQR with integral action → k0… + PID Ki (or ki)',
    target: 'state-feedback',
  },
  {
    id: 'lqg',
    group: 'Optimal',
    label: 'LQG (LQR + Kalman observer)',
    help: 'Separation: state-feedback K plus observer L',
    target: 'lqg',
  },
  {
    id: 'poleplace',
    group: 'Classical',
    label: 'Pole placement',
    help: 'Ackermann placement onto k0… / kref',
    target: 'state-feedback',
  },
  {
    id: 'pid-imc',
    group: 'Classical',
    label: 'PID (IMC)',
    help: 'Internal-model PID onto a PID block',
    target: 'pid',
  },
  {
    id: 'pid-zn',
    group: 'Classical',
    label: 'PID (Ziegler–Nichols)',
    help: 'Ultimate-gain PID onto a PID block',
    target: 'pid',
  },
  {
    id: 'pi-imc',
    group: 'Classical',
    label: 'PI (IMC)',
    help: 'PI-only IMC tune (Kd = 0)',
    target: 'pid',
  },
  {
    id: 'pd',
    group: 'Classical',
    label: 'PD',
    help: 'Proportional–derivative from plant τ / DC gain',
    target: 'pid',
  },
  {
    id: 'p',
    group: 'Classical',
    label: 'P (proportional)',
    help: 'Static gain from DC / bandwidth rule of thumb',
    target: 'pid',
  },
  {
    id: 'lead',
    group: 'Compensators',
    label: 'Lead compensator',
    help: 'Phase-lead TF written onto a Transfer Fcn block',
    target: 'transfer',
  },
  {
    id: 'lag',
    group: 'Compensators',
    label: 'Lag compensator',
    help: 'Phase-lag TF for steady-state error improvement',
    target: 'transfer',
  },
  {
    id: 'leadlag',
    group: 'Compensators',
    label: 'Lead–lag',
    help: 'Cascade lead×lag written as one proper TF',
    target: 'transfer',
  },
  {
    id: 'hinf-loop',
    group: 'Advanced',
    label: 'H∞ loop-shaping (approx.)',
    help: 'Lead at ωc for target phase margin — practical H∞-ish shaping',
    target: 'transfer',
  },
  {
    id: 'observer-lqr',
    group: 'Observers',
    label: 'Observer (dual LQR)',
    help: 'Luenberger L from dual LQR onto an Observer block',
    target: 'observer',
  },
  {
    id: 'deadbeat',
    group: 'Advanced',
    label: 'Deadbeat (discrete)',
    help: 'Sampled Ackermann with poles at 0 → k0… (Ts from Setup)',
    target: 'state-feedback',
  },
];

export function controllerOption(id: ControllerKind): ControllerOption {
  return CONTROLLER_OPTIONS.find((o) => o.id === id) ?? CONTROLLER_OPTIONS[0];
}
