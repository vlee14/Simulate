/** Reusable Stage scene configs — data only, no engine special-cases. */

export const SCENE_CART_PENDULUM = {
  inputs: 'x:mechanical,th1:mechanical,th2:mechanical,force:mechanical',
  scale: 140,
  trail: 'l2',
  nudgePlant: 'plant',
  nudge: 'Tip θ₁|1|0.12; Tip θ₂|2|-0.12; Shove cart|3|0.6',
  readouts: 'x|x|number;θ₁|th1|deg;θ₂|th2|deg;F|force|number',
  control: 'Hand force|manual|-25|25',
  disturbance: 'Kick →|pulse|pulse|16; Kick ←|pulse|pulse|-16',
  interact: 'cart|nudge|3|0.5; l1|nudge|1|0.12; l2|nudge|2|-0.12; *|control',
  scene: JSON.stringify([
    { type: 'ground' },
    { type: 'box', id: 'cart', x: '$x', y: 0, w: 0.72, h: 0.26, color: '#8b97a8' },
    { type: 'link', id: 'l1', from: 'cart', angle: '$th1', length: 0.4, color: '#e7a23a' },
    { type: 'link', id: 'l2', from: 'l1', angle: '$th2', length: 0.4, color: '#5ec8ff' },
    { type: 'arrow', value: '$force' },
  ]),
} as const;

export const SCENE_ROTOR = {
  inputs: 'theta:mechanical,torque:mechanical',
  scale: 120,
  trail: 'tip',
  nudge: '',
  nudgePlant: '',
  readouts: 'θ|theta|deg;T|torque|number',
  control: '',
  disturbance: '',
  interact: '',
  scene: JSON.stringify([
    { type: 'disk', id: 'rotor', x: 0, y: 0.4, radius: 0.35, angle: '$theta', color: '#5ec8ff' },
    { type: 'link', id: 'tip', from: 'rotor', angle: '$theta', length: 0.35, color: '#e7a23a' },
  ]),
} as const;

export const SCENE_TANK = {
  inputs: 'level:pneumatic,flow:pneumatic',
  scale: 80,
  trail: '',
  nudge: '',
  nudgePlant: '',
  readouts: 'level|level|number;q|flow|number',
  control: '',
  disturbance: '',
  interact: '',
  scene: JSON.stringify([
    { type: 'tank', id: 'tank', x: 0, y: 0, w: 1.2, h: 1.6, value: '$level', capacity: 5, color: '#7ddea0' },
  ]),
} as const;

export const SCENE_PISTON = {
  inputs: 'x:mechanical,force:mechanical',
  scale: 100,
  trail: '',
  nudge: '',
  nudgePlant: '',
  readouts: 'x|x|number;F|force|number',
  control: 'Push|manual|-5|5',
  disturbance: '',
  interact: '*|control',
  scene: JSON.stringify([
    { type: 'piston', id: 'piston', x: '$x', value: '$force', stroke: 0.5, color: '#e7a23a' },
  ]),
} as const;

export const SCENE_MASS_SPRING = {
  inputs: 'x:mechanical,v:mechanical',
  scale: 100,
  trail: '',
  nudge: 'Bump|0|0.2',
  nudgePlant: 'mass',
  readouts: 'x|x|number;v|v|number',
  control: 'Force|manual|-5|5',
  disturbance: 'Impulse|nudge|1|1.2',
  interact: 'm|nudge|0|0.15; *|control',
  scene: JSON.stringify([
    { type: 'springmass', id: 'm', x: '$x', color: '#e7a23a' },
  ]),
} as const;
