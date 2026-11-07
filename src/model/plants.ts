/** Reusable plant parameter packs built from generic Dynamics blocks. */

/**
 * Planar quadrotor + coasting target in one ODE.
 * States: [x, z, vx, vz, θ, ω, xt, zt, vxt, vzt]
 * Inputs: u1 = thrust T, u2 = pitch torque τ
 * Planar rigid body: v̇x = −(T/m)sinθ, v̇z = (T/m)cosθ − g, ω̇ = τ/Iyy − bω·ω
 * Target flies at constant velocity (ẋt = vxt, …).
 */
export const QUADROTOR_ODE = {
  form: 'explicit',
  nx: 10,
  nu: 2,
  ny: 10,
  nq: 2,
  constants: 'm=1.2; Iyy=0.03; g=9.81; bw=0.04',
  dx:
    'x3; ' +
    'x4; ' +
    '-(u1/m)*sin(x5); ' +
    '(u1/m)*cos(x5) - g; ' +
    'x6; ' +
    'u2/Iyy - bw*x6; ' +
    'x9; ' +
    'x10; ' +
    '0; ' +
    '0',
  M: '1, 0; 0, 1',
  rhs: '0; 0',
  y: 'x1; x2; x3; x4; x5; x6; x7; x8; x9; x10',
  // Interceptor near hover with forward speed; target crosses above, slower closing.
  x0: '0 2.2 1.5 0 0 0 11 4.5 -1.2 -0.2',
} as const;

export const CART_DOUBLE_PENDULUM_ODE = {
  form: 'mass',
  nq: 3,
  nu: 1,
  ny: 6,
  nx: 6,
  constants: 'Mc=1; m1=0.25; m2=0.25; l1=0.4; l2=0.4; g=9.81; b=0.15; c1=0.002; c2=0.002',
  M:
    'Mc+m1+m2, (m1+m2)*l1*cos(x2), m2*l2*cos(x3); ' +
    '(m1+m2)*l1*cos(x2), (m1+m2)*l1*l1, m2*l1*l2*cos(x2-x3); ' +
    'm2*l2*cos(x3), m2*l1*l2*cos(x2-x3), m2*l2*l2',
  rhs:
    'u1 - b*x4 + (m1+m2)*l1*sin(x2)*x5^2 + m2*l2*sin(x3)*x6^2; ' +
    '-c1*x5 - m2*l1*l2*sin(x2-x3)*x6^2 + (m1+m2)*g*l1*sin(x2); ' +
    '-c2*x6 + m2*l1*l2*sin(x2-x3)*x5^2 + m2*g*l2*sin(x3)',
  y: 'x1; x2; x3; x4; x5; x6',
  x0: '0 0.18 -0.12 0 0 0',
  dx: 'x2; -x1',
} as const;
