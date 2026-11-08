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
    label: 'LQR',
    help: 'Optimal state feedback',
    target: 'state-feedback',
  },
  {
    id: 'lqi',
    group: 'Optimal',
    label: 'LQI',
    help: 'LQR with integral action',
    target: 'state-feedback',
  },
  {
    id: 'lqg',
    group: 'Optimal',
    label: 'LQG',
    help: 'State feedback + observer',
    target: 'lqg',
  },
  {
    id: 'poleplace',
    group: 'Classical',
    label: 'Pole placement',
    help: 'Place desired closed-loop poles',
    target: 'state-feedback',
  },
  {
    id: 'pid-imc',
    group: 'Classical',
    label: 'PID (IMC)',
    help: 'IMC tune for a PID block',
    target: 'pid',
  },
  {
    id: 'pid-zn',
    group: 'Classical',
    label: 'PID (Z–N)',
    help: 'Ziegler–Nichols PID tune',
    target: 'pid',
  },
  {
    id: 'pi-imc',
    group: 'Classical',
    label: 'PI',
    help: 'IMC PI tune',
    target: 'pid',
  },
  {
    id: 'pd',
    group: 'Classical',
    label: 'PD',
    help: 'PD from plant response',
    target: 'pid',
  },
  {
    id: 'p',
    group: 'Classical',
    label: 'P',
    help: 'Proportional gain',
    target: 'pid',
  },
  {
    id: 'lead',
    group: 'Compensators',
    label: 'Lead',
    help: 'Lead compensator',
    target: 'transfer',
  },
  {
    id: 'lag',
    group: 'Compensators',
    label: 'Lag',
    help: 'Lag for steady-state error',
    target: 'transfer',
  },
  {
    id: 'leadlag',
    group: 'Compensators',
    label: 'Lead–lag',
    help: 'Combined lead–lag',
    target: 'transfer',
  },
  {
    id: 'hinf-loop',
    group: 'Advanced',
    label: 'Loop shaping',
    help: 'Lead near crossover for phase margin',
    target: 'transfer',
  },
  {
    id: 'observer-lqr',
    group: 'Observers',
    label: 'Observer',
    help: 'Observer gains from LQR dual',
    target: 'observer',
  },
  {
    id: 'deadbeat',
    group: 'Advanced',
    label: 'Deadbeat',
    help: 'Discrete deadbeat (Ts from Setup)',
    target: 'state-feedback',
  },
];

export function controllerOption(id: ControllerKind): ControllerOption {
  return CONTROLLER_OPTIONS.find((o) => o.id === id) ?? CONTROLLER_OPTIONS[0];
}
