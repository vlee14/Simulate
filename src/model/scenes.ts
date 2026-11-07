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
  inputs: 'theta:mechanical,torque:mechanical,omega:mechanical',
  scale: 120,
  trail: 'tip',
  nudge: 'Spin+|1|2; Spin−|1|-2',
  nudgePlant: 'motor',
  readouts: 'θ|theta|deg;ω|omega|number;T|torque|number',
  control: 'Va trim|manual|-12|12',
  disturbance: 'Load kick|pulse|load|0.08',
  interact: 'rotor|nudge|1|1.5; tip|nudge|1|-1.5; *|control',
  scene: JSON.stringify([
    { type: 'disk', id: 'rotor', x: 0, y: 0.4, radius: 0.35, angle: '$theta', color: '#5ec8ff' },
    { type: 'link', id: 'tip', from: 'rotor', angle: '$theta', length: 0.35, color: '#e7a23a' },
    { type: 'arrow', value: '$torque' },
  ]),
} as const;

export const SCENE_TANK = {
  inputs: 'level:pneumatic,flow:pneumatic',
  scale: 80,
  trail: '',
  nudge: '',
  nudgePlant: '',
  readouts: 'level|level|number;q|flow|number',
  control: 'Valve trim|manual|0|1',
  disturbance: 'Burp open|pulse|burp|1',
  interact: '*|control',
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

/** Side-view Stage for planar quadrotor chase (interceptor + target). */
export const SCENE_QUAD = {
  inputs: 'x:mechanical,z:mechanical,theta:mechanical,xt:mechanical,zt:mechanical,thrust:mechanical',
  scale: 36,
  trail: 'quad',
  nudgePlant: 'plant',
  nudge: 'Pitch+|5|1.2; Pitch−|5|-1.2',
  readouts: 'x|x|number;z|z|number;θ|theta|deg;xt|xt|number',
  control: 'Alt bias|zbias|-2|2',
  disturbance: 'Gust|pulse|gust|5',
  interact: 'quad|nudge|5|0.8; *|control',
  scene: JSON.stringify([
    { type: 'ground' },
    { type: 'box', id: 'tgt', x: '$xt', y: '$zt', w: 0.55, h: 0.18, color: '#e76f51' },
    { type: 'box', id: 'quad', x: '$x', y: '$z', w: 0.7, h: 0.16, color: '#5ec8ff' },
    { type: 'link', id: 'nose', from: 'quad', angle: '$theta', length: 0.42, color: '#e7a23a' },
    { type: 'arrow', value: '$thrust' },
  ]),
} as const;

/** Compact Stage for the second-order PID demo (position readout + hand disturbance). */
export const SCENE_SECOND_ORDER = {
  inputs: 'y:signal,u:signal',
  scale: 90,
  trail: '',
  nudge: 'Bump y|0|0.25',
  nudgePlant: 'plant',
  readouts: 'y|y|number;u|u|number',
  control: 'Hand u|manual|-3|3',
  disturbance: 'Kick|pulse|kick|2',
  interact: '*|control',
  scene: JSON.stringify([
    { type: 'springmass', id: 'm', x: '$y', color: '#5ec8ff' },
    { type: 'arrow', value: '$u' },
  ]),
} as const;
