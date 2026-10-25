type Expr =
  | { kind: 'num'; v: number }
  | { kind: 'var'; name: string }
  | { kind: 'neg'; a: Expr }
  | { kind: 'bin'; op: string; a: Expr; b: Expr }
  | { kind: 'call'; name: string; args: Expr[] };

type Tok =
  | { k: 'num'; v: number }
  | { k: 'id'; v: string }
  | { k: 'op'; v: string }
  | { k: 'lp' }
  | { k: 'rp' }
  | { k: 'comma' };

const FUNCS = new Set(['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'abs', 'sqrt', 'exp', 'ln', 'log', 'min', 'max', 'sign', 'pow', 'hypot']);

function tokenize(source: string): Tok[] {
  const s = source.trim();
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\n') {
      i++;
      continue;
    }
    if (c === '(') {
      out.push({ k: 'lp' });
      i++;
      continue;
    }
    if (c === ')') {
      out.push({ k: 'rp' });
      i++;
      continue;
    }
    if (c === ',') {
      out.push({ k: 'comma' });
      i++;
      continue;
    }
    if ('+-*/^'.includes(c)) {
      out.push({ k: 'op', v: c });
      i++;
      continue;
    }
    if ((c >= '0' && c <= '9') || (c === '.' && s[i + 1] >= '0' && s[i + 1] <= '9')) {
      let j = i + 1;
      while (j < s.length && ((s[j] >= '0' && s[j] <= '9') || s[j] === '.')) j++;
      if (s[j] === 'e' || s[j] === 'E') {
        let k = j + 1;
        if (s[k] === '+' || s[k] === '-') k++;
        while (k < s.length && s[k] >= '0' && s[k] <= '9') k++;
        j = k;
      }
      const v = Number(s.slice(i, j));
      if (!Number.isFinite(v)) throw new Error(`Bad number in "${source}"`);
      out.push({ k: 'num', v });
      i = j;
      continue;
    }
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_') {
      let j = i + 1;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      out.push({ k: 'id', v: s.slice(i, j) });
      i = j;
      continue;
    }
    throw new Error(`Unexpected "${c}" in expression`);
  }
  return out;
}

function parse(tokens: Tok[]): Expr {
  let i = 0;
  const peek = () => tokens[i];
  const eat = () => tokens[i++];

  function parseExpr(): Expr {
    let left = parseTerm();
    while (peek()?.k === 'op' && (peek() as { v: string }).v.match(/^[+-]$/)) {
      const op = (eat() as { v: string }).v;
      const right = parseTerm();
      left = { kind: 'bin', op, a: left, b: right };
    }
    return left;
  }
  function parseTerm(): Expr {
    let left = parseUnary();
    while (peek()?.k === 'op' && (peek() as { v: string }).v.match(/^[*/]$/)) {
      const op = (eat() as { v: string }).v;
      const right = parseUnary();
      left = { kind: 'bin', op, a: left, b: right };
    }
    return left;
  }
  function parseUnary(): Expr {
    if (peek()?.k === 'op' && (peek() as { v: string }).v === '+') {
      eat();
      return parseUnary();
    }
    if (peek()?.k === 'op' && (peek() as { v: string }).v === '-') {
      eat();
      return { kind: 'neg', a: parseUnary() };
    }
    return parsePower();
  }
  function parsePower(): Expr {
    const base = parsePrimary();
    if (peek()?.k === 'op' && (peek() as { v: string }).v === '^') {
      eat();
      return { kind: 'bin', op: '^', a: base, b: parseUnary() };
    }
    return base;
  }
  function parsePrimary(): Expr {
    const t = peek();
    if (!t) throw new Error('Expression ended early');
    if (t.k === 'num') {
      eat();
      return { kind: 'num', v: t.v };
    }
    if (t.k === 'id') {
      eat();
      if (peek()?.k === 'lp') {
        eat();
        const args: Expr[] = [];
        if (peek()?.k !== 'rp') {
          args.push(parseExpr());
          while (peek()?.k === 'comma') {
            eat();
            args.push(parseExpr());
          }
        }
        if (peek()?.k !== 'rp') throw new Error(`Missing ) after ${t.v}`);
        eat();
        if (!FUNCS.has(t.v)) throw new Error(`Unknown function ${t.v}`);
        return { kind: 'call', name: t.v, args };
      }
      return { kind: 'var', name: t.v };
    }
    if (t.k === 'lp') {
      eat();
      const e = parseExpr();
      if (peek()?.k !== 'rp') throw new Error('Missing )');
      eat();
      return e;
    }
    throw new Error('Bad expression');
  }

  const ast = parseExpr();
  if (i !== tokens.length) throw new Error('Unexpected extra tokens');
  return ast;
}

function evalExpr(e: Expr, vars: Record<string, number>): number {
  switch (e.kind) {
    case 'num':
      return e.v;
    case 'var': {
      if (e.name === 'pi') return Math.PI;
      if (e.name === 'e') return Math.E;
      const v = vars[e.name];
      if (v === undefined || Number.isNaN(v)) return 0;
      return v;
    }
    case 'neg':
      return -evalExpr(e.a, vars);
    case 'bin': {
      const a = evalExpr(e.a, vars);
      const b = evalExpr(e.b, vars);
      switch (e.op) {
        case '+':
          return a + b;
        case '-':
          return a - b;
        case '*':
          return a * b;
        case '/':
          return b === 0 ? 0 : a / b;
        case '^':
          return Math.pow(a, b);
        default:
          return 0;
      }
    }
    case 'call': {
      const args = e.args.map((a) => evalExpr(a, vars));
      switch (e.name) {
        case 'sin':
          return Math.sin(args[0] ?? 0);
        case 'cos':
          return Math.cos(args[0] ?? 0);
        case 'tan':
          return Math.tan(args[0] ?? 0);
        case 'asin':
          return Math.asin(args[0] ?? 0);
        case 'acos':
          return Math.acos(args[0] ?? 0);
        case 'atan':
          return Math.atan(args[0] ?? 0);
        case 'atan2':
          return Math.atan2(args[0] ?? 0, args[1] ?? 0);
        case 'abs':
          return Math.abs(args[0] ?? 0);
        case 'sqrt':
          return Math.sqrt(Math.max(0, args[0] ?? 0));
        case 'exp':
          return Math.exp(args[0] ?? 0);
        case 'ln':
        case 'log':
          return Math.log(Math.max(1e-15, args[0] ?? 0));
        case 'min':
          return Math.min(args[0] ?? 0, args[1] ?? 0);
        case 'max':
          return Math.max(args[0] ?? 0, args[1] ?? 0);
        case 'sign':
          return Math.sign(args[0] ?? 0);
        case 'pow':
          return Math.pow(args[0] ?? 0, args[1] ?? 0);
        case 'hypot':
          return Math.hypot(args[0] ?? 0, args[1] ?? 0);
        default:
          return 0;
      }
    }
  }
}

export function compileExpression(source: string): (vars: Record<string, number>) => number {
  const ast = parse(tokenize(source));
  return (vars) => evalExpr(ast, vars);
}

/** How many scalar inputs an expression addresses (u or u1…uN). */
export function expressionInputCount(source: string): number {
  let max = 0;
  if (/(^|[^A-Za-z0-9_])u([^0-9]|$)/.test(source)) max = 1;
  const re = /\bu(\d+)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) max = Math.max(max, Number(m[1]));
  return Math.max(1, Math.min(8, max));
}
