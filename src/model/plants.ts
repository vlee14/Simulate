/** Reusable plant parameter packs built from generic Dynamics blocks. */

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
