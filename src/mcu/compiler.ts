/**
 * Ohm Studio – Arduino-Sketch-Übersetzer.
 *
 * Übersetzt eine große Teilmenge von Arduino-C/C++ in JavaScript-Generatorfunktionen.
 * Der Generator gibt bei delay() & Co. die Kontrolle an den Simulator zurück, so dass
 * Mikrocontroller und Schaltung auf einer gemeinsamen Zeitachse laufen.
 */

export class CompileError extends Error {
  constructor(public line: number, message: string) {
    super(message);
  }
}

/* ------------------------------ Lexer ------------------------------ */

type TokT = 'id' | 'num' | 'str' | 'chr' | 'op' | 'eof';
interface Tok {
  t: TokT;
  v: string;
  line: number;
  f?: boolean; // Gleitkommazahl
  n?: number;
}

const OPS3 = ['<<=', '>>=', '...'];
const OPS2 = ['->', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '::'];

interface Macro {
  params?: string[];
  body: Tok[];
}

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  let line = 1;
  const n = src.length;
  let lineStart = true;
  while (i < n) {
    const c = src[i];
    if (c === '\n') {
      line++;
      i++;
      lineStart = true;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') line++;
        i++;
      }
      i += 2;
      continue;
    }
    if (c === '#' && lineStart) {
      // Präprozessorzeile inkl. Fortsetzungen
      let s = '';
      while (i < n && src[i] !== '\n') {
        if (src[i] === '\\' && src[i + 1] === '\n') {
          i += 2;
          line++;
          s += ' ';
          continue;
        }
        s += src[i++];
      }
      out.push({ t: 'op', v: '#', line, n: 0 });
      out.push({ t: 'str', v: s, line });
      continue;
    }
    lineStart = false;
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
      out.push({ t: 'id', v: src.slice(i, j), line });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i;
      let isF = false;
      let val: number;
      if (c === '0' && (src[i + 1] === 'x' || src[i + 1] === 'X')) {
        j = i + 2;
        while (j < n && /[0-9a-fA-F]/.test(src[j])) j++;
        val = parseInt(src.slice(i + 2, j), 16);
      } else if (c === '0' && (src[i + 1] === 'b' || src[i + 1] === 'B')) {
        j = i + 2;
        while (j < n && /[01]/.test(src[j])) j++;
        val = parseInt(src.slice(i + 2, j), 2);
      } else {
        while (j < n && /[0-9]/.test(src[j])) j++;
        if (src[j] === '.') {
          isF = true;
          j++;
          while (j < n && /[0-9]/.test(src[j])) j++;
        }
        if (src[j] === 'e' || src[j] === 'E') {
          isF = true;
          j++;
          if (src[j] === '-' || src[j] === '+') j++;
          while (j < n && /[0-9]/.test(src[j])) j++;
        }
        val = parseFloat(src.slice(i, j));
      }
      while (j < n && /[uUlLfF]/.test(src[j])) {
        if (src[j] === 'f' || src[j] === 'F') isF = true;
        j++;
      }
      out.push({ t: 'num', v: src.slice(i, j), n: val, f: isF, line });
      i = j;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let s = '';
      while (j < n && src[j] !== '"') {
        if (src[j] === '\\') {
          s += unescapeChar(src[j + 1]);
          j += 2;
        } else {
          if (src[j] === '\n') throw new CompileError(line, `Zeile ${line}: Ein Text in Anführungszeichen wurde nicht geschlossen.`);
          s += src[j++];
        }
      }
      i = j + 1;
      // benachbarte Literale verbinden
      const prev = out[out.length - 1];
      if (prev && prev.t === 'str' && out[out.length - 2]?.v !== '#') prev.v += s;
      else out.push({ t: 'str', v: s, line });
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      let ch: string;
      if (src[j] === '\\') {
        ch = unescapeChar(src[j + 1]);
        j += 2;
      } else ch = src[j++];
      if (src[j] !== "'") throw new CompileError(line, `Zeile ${line}: Ein Zeichen in einfachen Anführungszeichen ist ungültig.`);
      out.push({ t: 'chr', v: ch, n: ch.charCodeAt(0), line });
      i = j + 1;
      continue;
    }
    const s3 = src.slice(i, i + 3);
    const s2 = src.slice(i, i + 2);
    if (OPS3.includes(s3)) {
      out.push({ t: 'op', v: s3, line });
      i += 3;
    } else if (OPS2.includes(s2)) {
      out.push({ t: 'op', v: s2, line });
      i += 2;
    } else {
      out.push({ t: 'op', v: c, line });
      i++;
    }
  }
  out.push({ t: 'eof', v: '', line });
  return out;
}

function unescapeChar(c: string): string {
  switch (c) {
    case 'n':
      return '\n';
    case 't':
      return '\t';
    case 'r':
      return '\r';
    case '0':
      return '\0';
    default:
      return c;
  }
}

/** Präprozessor: #define (auch mit Parametern), #include ignorieren, #if-Blöcke grob behandeln */
function preprocess(toks: Tok[], predefined: Record<string, string>): { toks: Tok[]; includes: string[] } {
  const macros = new Map<string, Macro>();
  for (const [k, v] of Object.entries(predefined)) macros.set(k, { body: lex(v).slice(0, -1) });
  const includes: string[] = [];
  const out: Tok[] = [];
  const skipStack: boolean[] = [];
  const skipping = () => skipStack.some((s) => s);
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t === 'op' && t.v === '#' && t.n === 0) {
      const line = toks[++i].v.trim();
      const m = /^#\s*(\w+)\s*(.*)$/.exec(line);
      if (!m) continue;
      const [, dir, rest] = m;
      if (dir === 'ifdef' || dir === 'ifndef') {
        const has = macros.has(rest.trim());
        skipStack.push(dir === 'ifdef' ? !has : has);
      } else if (dir === 'if') {
        skipStack.push(/^0\b/.test(rest.trim()));
      } else if (dir === 'else' || dir === 'elif') {
        if (skipStack.length) skipStack[skipStack.length - 1] = !skipStack[skipStack.length - 1];
      } else if (dir === 'endif') {
        skipStack.pop();
      } else if (skipping()) {
        continue;
      } else if (dir === 'include') {
        includes.push(rest.replace(/[<>"]/g, '').trim());
      } else if (dir === 'define') {
        const dm = /^(\w+)(\(([^)]*)\))?\s*(.*)$/.exec(rest);
        if (dm) {
          const body = lex(dm[4]).slice(0, -1).map((x) => ({ ...x, line: t.line }));
          macros.set(dm[1], { params: dm[2] ? dm[3].split(',').map((p) => p.trim()).filter(Boolean) : undefined, body });
        }
      } else if (dir === 'undef') {
        macros.delete(rest.trim());
      }
      continue;
    }
    if (skipping()) continue;
    out.push(t);
  }
  // Makros expandieren (mehrfach für verschachtelte Makros)
  const expand = (list: Tok[], depth: number): Tok[] => {
    if (depth > 20) return list;
    const res: Tok[] = [];
    let changed = false;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      const mac = t.t === 'id' ? macros.get(t.v) : undefined;
      if (!mac) {
        res.push(t);
        continue;
      }
      if (mac.params) {
        if (list[i + 1]?.v !== '(') {
          res.push(t);
          continue;
        }
        // Argumente einsammeln
        const args: Tok[][] = [[]];
        let d = 0;
        let j = i + 2;
        for (; j < list.length; j++) {
          const a = list[j];
          if (a.v === '(' && a.t === 'op') d++;
          if (a.v === ')' && a.t === 'op') {
            if (d === 0) break;
            d--;
          }
          if (a.v === ',' && a.t === 'op' && d === 0) {
            args.push([]);
            continue;
          }
          args[args.length - 1].push(a);
        }
        for (const bt of mac.body) {
          const pi = bt.t === 'id' ? mac.params.indexOf(bt.v) : -1;
          if (pi >= 0) res.push({ t: 'op', v: '(', line: t.line }, ...(args[pi] ?? []), { t: 'op', v: ')', line: t.line });
          else res.push({ ...bt, line: t.line });
        }
        i = j;
      } else {
        for (const bt of mac.body) res.push({ ...bt, line: t.line });
      }
      changed = true;
    }
    return changed ? expand(res, depth + 1) : res;
  };
  return { toks: expand(out, 0), includes };
}

/* ------------------------------ Typen ------------------------------ */

export type Base = 'int' | 'float' | 'bool' | 'string' | 'char' | 'void' | 'obj' | 'any';
export interface Ty {
  base: Base;
  bits?: number; // für int
  unsigned?: boolean;
  cls?: string;
  dims?: number; // Array-Dimension
}

const T = {
  int: { base: 'int', bits: 16 } as Ty,
  float: { base: 'float' } as Ty,
  bool: { base: 'bool' } as Ty,
  string: { base: 'string' } as Ty,
  char: { base: 'char', bits: 8 } as Ty,
  void: { base: 'void' } as Ty,
  any: { base: 'any' } as Ty,
  ulong: { base: 'int', bits: 32, unsigned: true } as Ty,
  long: { base: 'int', bits: 32 } as Ty,
};

const PRIM_TYPES = new Set([
  'void', 'int', 'long', 'short', 'char', 'float', 'double', 'bool', 'boolean', 'byte', 'word', 'String', 'size_t', 'unsigned', 'signed',
  'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t', 'int8_t', 'int16_t', 'int32_t', 'int64_t', 'auto',
]);
const QUALIFIERS = new Set(['const', 'static', 'volatile', 'extern', 'inline', 'RTC_DATA_ATTR', 'PROGMEM', 'constexpr', 'IRAM_ATTR', 'ICACHE_RAM_ATTR', 'register', 'struct', 'class', 'typename', 'mutable']);

/* ------------------------------ AST ------------------------------ */

type Expr =
  | { k: 'num'; v: number; f: boolean; line: number }
  | { k: 'str'; v: string; line: number }
  | { k: 'chr'; v: number; line: number }
  | { k: 'id'; n: string; line: number }
  | { k: 'scope'; o: string; n: string; line: number }
  | { k: 'bin'; op: string; a: Expr; b: Expr; line: number }
  | { k: 'un'; op: string; a: Expr; line: number }
  | { k: 'post'; op: string; a: Expr; line: number }
  | { k: 'asg'; op: string; t: Expr; v: Expr; line: number }
  | { k: 'tern'; c: Expr; a: Expr; b: Expr; line: number }
  | { k: 'call'; f: Expr; args: Expr[]; line: number }
  | { k: 'mem'; o: Expr; n: string; line: number }
  | { k: 'idx'; a: Expr; i: Expr; line: number }
  | { k: 'cast'; ty: Ty; a: Expr; line: number }
  | { k: 'init'; items: Expr[]; line: number };

interface VarDecl {
  n: string;
  dims: (Expr | null)[];
  init?: Expr;
  ctor?: Expr[];
  line: number;
}

type Stmt =
  | { k: 'block'; body: Stmt[] }
  | { k: 'decl'; ty: Ty; vars: VarDecl[]; line: number; isConst?: boolean }
  | { k: 'expr'; e: Expr; line: number }
  | { k: 'if'; c: Expr; a: Stmt; b?: Stmt }
  | { k: 'while'; c: Expr; body: Stmt }
  | { k: 'do'; c: Expr; body: Stmt }
  | { k: 'for'; init?: Stmt; c?: Expr; step?: Expr; body: Stmt }
  | { k: 'switch'; e: Expr; cases: { v: Expr | null; body: Stmt[] }[] }
  | { k: 'break' }
  | { k: 'continue' }
  | { k: 'return'; e?: Expr; line: number }
  | { k: 'empty' };

interface FnDef {
  name: string;
  ret: Ty;
  params: { n: string; ty: Ty }[];
  body?: Stmt;
  line: number;
}

interface EnumDef {
  names: [string, number][];
}

/* ------------------------------ Parser ------------------------------ */

class Parser {
  i = 0;
  constructor(private toks: Tok[], private classes: Set<string>) {}
  peek(o = 0) {
    return this.toks[Math.min(this.i + o, this.toks.length - 1)];
  }
  next() {
    return this.toks[this.i++];
  }
  is(v: string, o = 0) {
    const t = this.peek(o);
    return (t.t === 'op' || t.t === 'id') && t.v === v;
  }
  accept(v: string) {
    if (this.is(v)) {
      this.i++;
      return true;
    }
    return false;
  }
  expect(v: string, what?: string): Tok {
    const t = this.peek();
    if (!this.is(v)) {
      const line = v === ';' ? this.toks[this.i - 1]?.line ?? t.line : t.line;
      const got = t.t === 'eof' ? 'das Ende des Programms' : `„${t.v}“`;
      if (v === ';') throw new CompileError(line, `Zeile ${line}: Hier fehlt ein Semikolon „;“ am Zeilenende.`);
      if (v === ')') throw new CompileError(t.line, `Zeile ${t.line}: Eine schließende Klammer „)“ fehlt (gefunden: ${got}).`);
      if (v === '}') throw new CompileError(t.line, `Zeile ${t.line}: Eine schließende geschweifte Klammer „}“ fehlt (gefunden: ${got}).`);
      throw new CompileError(t.line, `Zeile ${t.line}: Erwartet wurde „${what ?? v}“, gefunden wurde ${got}.`);
    }
    return this.next();
  }
  ident(): string {
    const t = this.next();
    if (t.t !== 'id') throw new CompileError(t.line, `Zeile ${t.line}: Hier wird ein Name erwartet, gefunden wurde „${t.v}“.`);
    return t.v;
  }

  /** beginnt hier eine Typangabe? */
  isTypeStart(o = 0): boolean {
    const t = this.peek(o);
    if (t.t !== 'id') return false;
    if (PRIM_TYPES.has(t.v) || QUALIFIERS.has(t.v) || this.classes.has(t.v)) return true;
    // Unbekannte Klasse: Name gefolgt von Name (z. B. „MeinTyp x;“) oder Name* Name
    const n1 = this.peek(o + 1);
    if (n1.t === 'id') return true;
    if ((n1.v === '*' || n1.v === '&') && this.peek(o + 2).t === 'id' && (this.peek(o + 3).v === '=' || this.peek(o + 3).v === ';' || this.peek(o + 3).v === '(' || this.peek(o + 3).v === ',' || this.peek(o + 3).v === ')')) return true;
    return false;
  }

  parseType(): { ty: Ty; isConst: boolean } {
    let isConst = false;
    let unsigned = false;
    let longs = 0;
    let short = false;
    let base: string | null = null;
    for (;;) {
      const t = this.peek();
      if (t.t !== 'id') break;
      if (QUALIFIERS.has(t.v)) {
        if (t.v === 'const' || t.v === 'constexpr') isConst = true;
        this.i++;
        continue;
      }
      if (t.v === 'unsigned') {
        unsigned = true;
        this.i++;
        continue;
      }
      if (t.v === 'signed') {
        this.i++;
        continue;
      }
      if (t.v === 'long') {
        longs++;
        this.i++;
        continue;
      }
      if (t.v === 'short') {
        short = true;
        this.i++;
        continue;
      }
      if (base === null && (PRIM_TYPES.has(t.v) || this.classes.has(t.v) || this.peek(1).t === 'id' || this.peek(1).v === '*' || this.peek(1).v === '&' || this.peek(1).v === '::')) {
        base = t.v;
        this.i++;
        // Namespace-Typen wie std::string
        while (this.is('::')) {
          this.i++;
          base = this.ident();
        }
        // Template-Argumente überspringen
        if (this.is('<')) {
          let d = 0;
          do {
            if (this.is('<')) d++;
            if (this.is('>')) d--;
            this.i++;
          } while (d > 0 && this.peek().t !== 'eof');
        }
        continue;
      }
      break;
    }
    let ptr = false;
    while (this.is('*') || this.is('&')) {
      if (this.is('*')) ptr = true;
      this.i++;
    }
    if (this.is('const')) this.i++;
    let ty: Ty;
    if (base === null) base = longs || short || unsigned ? 'int' : 'int';
    switch (base) {
      case 'void':
        ty = T.void;
        break;
      case 'int':
        ty = { base: 'int', bits: longs ? 32 : short ? 16 : 0, unsigned };
        break;
      case 'long':
        ty = { base: 'int', bits: 32, unsigned };
        break;
      case 'char':
        ty = ptr ? T.string : { base: 'char', bits: 8, unsigned };
        break;
      case 'float':
      case 'double':
        ty = T.float;
        break;
      case 'bool':
      case 'boolean':
        ty = T.bool;
        break;
      case 'byte':
      case 'uint8_t':
        ty = { base: 'int', bits: 8, unsigned: true };
        break;
      case 'word':
      case 'uint16_t':
        ty = { base: 'int', bits: 16, unsigned: true };
        break;
      case 'int8_t':
        ty = { base: 'int', bits: 8 };
        break;
      case 'int16_t':
        ty = { base: 'int', bits: 16 };
        break;
      case 'uint32_t':
      case 'size_t':
        ty = { base: 'int', bits: 32, unsigned: true };
        break;
      case 'int32_t':
        ty = { base: 'int', bits: 32 };
        break;
      case 'uint64_t':
      case 'int64_t':
        ty = { base: 'int', bits: 53, unsigned: base === 'uint64_t' };
        break;
      case 'String':
      case 'string':
        ty = T.string;
        break;
      case 'auto':
        ty = T.any;
        break;
      default:
        ty = { base: 'obj', cls: base };
    }
    if (ty.base === 'int' && longs && !ty.bits) ty.bits = 32;
    return { ty, isConst };
  }

  program(): { fns: FnDef[]; globals: Stmt[]; enums: EnumDef[] } {
    const fns: FnDef[] = [];
    const globals: Stmt[] = [];
    const enums: EnumDef[] = [];
    while (this.peek().t !== 'eof') {
      if (this.accept(';')) continue;
      if (this.is('using')) {
        while (!this.accept(';')) this.i++;
        continue;
      }
      if (this.is('typedef')) {
        while (!this.accept(';')) this.i++;
        continue;
      }
      if (this.is('enum')) {
        enums.push(this.enumDef());
        continue;
      }
      if ((this.is('struct') || this.is('class')) && this.peek(2).v === '{') {
        throw new CompileError(this.peek().line, `Zeile ${this.peek().line}: Eigene struct/class-Definitionen werden in der Simulation noch nicht unterstützt. Nutze stattdessen einzelne Variablen oder Arrays.`);
      }
      const line = this.peek().line;
      const { ty, isConst } = this.parseType();
      const name = this.ident();
      if (this.is('(') && ty.base !== 'obj') {
        // Funktion
        this.i++;
        const params: { n: string; ty: Ty }[] = [];
        if (!this.is(')')) {
          if (this.is('void') && this.peek(1).v === ')') this.i++;
          else
            do {
              const p = this.parseType();
              const pn = this.peek().t === 'id' ? this.ident() : `_p${params.length}`;
              let pty = p.ty;
              while (this.accept('[')) {
                while (!this.accept(']')) this.i++;
                pty = { ...pty, dims: (pty.dims ?? 0) + 1 };
              }
              if (this.accept('=')) this.expr(); // Standardwerte ignorieren
              params.push({ n: pn, ty: pty });
            } while (this.accept(','));
        }
        this.expect(')');
        if (this.accept(';')) {
          fns.push({ name, ret: ty, params, line });
          continue;
        }
        const body = this.block();
        fns.push({ name, ret: ty, params, body, line });
        continue;
      }
      this.i--; // Name zurück
      globals.push(this.declRest(ty, isConst, line));
    }
    return { fns, globals, enums };
  }

  enumDef(): EnumDef {
    this.expect('enum');
    if (this.is('class')) this.i++;
    if (this.peek().t === 'id') this.i++;
    if (this.accept(':')) this.parseType();
    this.expect('{');
    const names: [string, number][] = [];
    let val = 0;
    while (!this.accept('}')) {
      const n = this.ident();
      if (this.accept('=')) {
        const e = this.expr();
        if (e.k === 'num') val = e.v;
        else if (e.k === 'un' && e.op === '-' && e.a.k === 'num') val = -e.a.v;
      }
      names.push([n, val++]);
      this.accept(',');
    }
    // „enum X {...} var;“
    while (!this.accept(';')) this.i++;
    return { names };
  }

  declRest(ty: Ty, isConst: boolean, line: number): Stmt {
    const vars: VarDecl[] = [];
    do {
      while (this.accept('*') || this.accept('&'));
      const n = this.ident();
      const dims: (Expr | null)[] = [];
      while (this.accept('[')) {
        if (this.accept(']')) dims.push(null);
        else {
          dims.push(this.expr());
          this.expect(']');
        }
      }
      const v: VarDecl = { n, dims, line: this.peek().line };
      if (this.accept('=')) v.init = this.is('{') ? this.initList() : this.assign();
      else if (this.is('{') && ty.base === 'obj') {
        v.ctor = (this.initList() as Extract<Expr, { k: 'init' }>).items;
      } else if (this.is('(')) {
        this.i++;
        const args: Expr[] = [];
        if (!this.is(')'))
          do args.push(this.assign());
          while (this.accept(','));
        this.expect(')');
        if (ty.base === 'obj') v.ctor = args;
        else v.init = args[0];
      }
      vars.push(v);
    } while (this.accept(','));
    this.expect(';');
    return { k: 'decl', ty, vars, line, isConst };
  }

  initList(): Expr {
    const line = this.expect('{').line;
    const items: Expr[] = [];
    while (!this.accept('}')) {
      items.push(this.is('{') ? this.initList() : this.assign());
      if (!this.accept(',')) {
        this.expect('}');
        break;
      }
    }
    return { k: 'init', items, line };
  }

  block(): Stmt {
    this.expect('{');
    const body: Stmt[] = [];
    while (!this.is('}')) {
      if (this.peek().t === 'eof') this.expect('}');
      body.push(this.stmt());
    }
    this.i++;
    return { k: 'block', body };
  }

  stmt(): Stmt {
    const t = this.peek();
    if (t.v === '{' && t.t === 'op') return this.block();
    if (t.v === ';' && t.t === 'op') {
      this.i++;
      return { k: 'empty' };
    }
    if (t.t === 'id') {
      switch (t.v) {
        case 'if': {
          this.i++;
          this.expect('(');
          const c = this.expr();
          this.expect(')');
          const a = this.stmt();
          const b = this.accept('else') ? this.stmt() : undefined;
          return { k: 'if', c, a, b };
        }
        case 'while': {
          this.i++;
          this.expect('(');
          const c = this.expr();
          this.expect(')');
          return { k: 'while', c, body: this.stmt() };
        }
        case 'do': {
          this.i++;
          const body = this.stmt();
          this.expect('while');
          this.expect('(');
          const c = this.expr();
          this.expect(')');
          this.expect(';');
          return { k: 'do', c, body };
        }
        case 'for': {
          this.i++;
          this.expect('(');
          let init: Stmt | undefined;
          if (!this.accept(';')) {
            if (this.isTypeStart()) {
              const line = this.peek().line;
              const { ty, isConst } = this.parseType();
              init = this.declRest(ty, isConst, line);
            } else {
              const line = this.peek().line;
              init = { k: 'expr', e: this.expr(), line };
              this.expect(';');
            }
          }
          const c = this.is(';') ? undefined : this.expr();
          this.expect(';');
          const step = this.is(')') ? undefined : this.expr();
          this.expect(')');
          return { k: 'for', init, c, step, body: this.stmt() };
        }
        case 'switch': {
          this.i++;
          this.expect('(');
          const e = this.expr();
          this.expect(')');
          this.expect('{');
          const cases: { v: Expr | null; body: Stmt[] }[] = [];
          while (!this.accept('}')) {
            if (this.accept('case')) {
              const v = this.ternary();
              this.expect(':');
              cases.push({ v, body: [] });
            } else if (this.accept('default')) {
              this.expect(':');
              cases.push({ v: null, body: [] });
            } else {
              if (!cases.length) throw new CompileError(this.peek().line, `Zeile ${this.peek().line}: In einem switch muss zuerst ein „case“ stehen.`);
              cases[cases.length - 1].body.push(this.stmt());
            }
          }
          return { k: 'switch', e, cases };
        }
        case 'break':
          this.i++;
          this.expect(';');
          return { k: 'break' };
        case 'continue':
          this.i++;
          this.expect(';');
          return { k: 'continue' };
        case 'return': {
          this.i++;
          const line = t.line;
          if (this.accept(';')) return { k: 'return', line };
          const e = this.expr();
          this.expect(';');
          return { k: 'return', e, line };
        }
      }
      if (this.isTypeStart() && !(this.peek(1).v === '(' && !PRIM_TYPES.has(t.v) && !this.classes.has(t.v)) && this.peek(1).v !== '.' && this.peek(1).v !== '::' && this.peek(1).v !== '->' && this.peek(1).v !== '=') {
        const { ty, isConst } = this.parseType();
        return this.declRest(ty, isConst, t.line);
      }
    }
    const e = this.expr();
    this.expect(';');
    return { k: 'expr', e, line: t.line };
  }

  expr(): Expr {
    let e = this.assign();
    while (this.is(',')) {
      const line = this.next().line;
      e = { k: 'bin', op: ',', a: e, b: this.assign(), line };
    }
    return e;
  }

  assign(): Expr {
    const lhs = this.ternary();
    const t = this.peek();
    if (t.t === 'op' && ['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>='].includes(t.v)) {
      this.i++;
      const v = this.is('{') ? this.initList() : this.assign();
      if (!['id', 'idx', 'mem', 'un'].includes(lhs.k)) throw new CompileError(t.line, `Zeile ${t.line}: Links vom „${t.v}“ muss eine Variable stehen.`);
      return { k: 'asg', op: t.v, t: lhs, v, line: t.line };
    }
    return lhs;
  }

  ternary(): Expr {
    const c = this.binary(0);
    if (this.is('?')) {
      const line = this.next().line;
      const a = this.assign();
      this.expect(':');
      const b = this.assign();
      return { k: 'tern', c, a, b, line };
    }
    return c;
  }

  static PREC: string[][] = [['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='], ['<', '>', '<=', '>='], ['<<', '>>'], ['+', '-'], ['*', '/', '%']];

  binary(level: number): Expr {
    if (level >= Parser.PREC.length) return this.unary();
    let a = this.binary(level + 1);
    for (;;) {
      const t = this.peek();
      if (t.t === 'op' && Parser.PREC[level].includes(t.v)) {
        this.i++;
        const b = this.binary(level + 1);
        a = { k: 'bin', op: t.v, a, b, line: t.line };
      } else return a;
    }
  }

  unary(): Expr {
    const t = this.peek();
    if (t.t === 'op') {
      if (['!', '~', '-', '+', '*', '&'].includes(t.v)) {
        this.i++;
        const a = this.unary();
        if (t.v === '*' || t.v === '&' || t.v === '+') return a; // Zeiger ignorieren
        return { k: 'un', op: t.v, a, line: t.line };
      }
      if (t.v === '++' || t.v === '--') {
        this.i++;
        const a = this.unary();
        return { k: 'asg', op: t.v === '++' ? '+=' : '-=', t: a, v: { k: 'num', v: 1, f: false, line: t.line }, line: t.line };
      }
      if (t.v === '(' && this.isCast()) {
        this.i++;
        const { ty } = this.parseType();
        this.expect(')');
        const a = this.unary();
        return { k: 'cast', ty, a, line: t.line };
      }
    }
    if (t.t === 'id' && t.v === 'sizeof') {
      this.i++;
      this.expect('(');
      let d = 1;
      const start = this.i;
      while (d > 0) {
        if (this.is('(')) d++;
        if (this.is(')')) d--;
        this.i++;
      }
      const inner = this.toks.slice(start, this.i - 1);
      return { k: 'call', f: { k: 'id', n: '__sizeof', line: t.line }, args: [{ k: 'str', v: inner.map((x) => x.v).join(' '), line: t.line }], line: t.line };
    }
    return this.postfix();
  }

  isCast(): boolean {
    const t = this.peek(1);
    if (t.t !== 'id') return false;
    if (!(PRIM_TYPES.has(t.v) || QUALIFIERS.has(t.v))) return false;
    // (int)x, (unsigned long)x, (char*)x
    let j = 1;
    while (this.peek(j).t === 'id' && (PRIM_TYPES.has(this.peek(j).v) || QUALIFIERS.has(this.peek(j).v))) j++;
    while (this.peek(j).v === '*') j++;
    return this.peek(j).v === ')';
  }

  postfix(): Expr {
    let e = this.primary();
    for (;;) {
      const t = this.peek();
      if (t.t !== 'op') return e;
      if (t.v === '(') {
        this.i++;
        const args: Expr[] = [];
        if (!this.is(')'))
          do args.push(this.is('{') ? this.initList() : this.assign());
          while (this.accept(','));
        this.expect(')');
        e = { k: 'call', f: e, args, line: t.line };
      } else if (t.v === '[') {
        this.i++;
        const i = this.expr();
        this.expect(']');
        e = { k: 'idx', a: e, i, line: t.line };
      } else if (t.v === '.' || t.v === '->') {
        this.i++;
        e = { k: 'mem', o: e, n: this.ident(), line: t.line };
      } else if (t.v === '++' || t.v === '--') {
        this.i++;
        e = { k: 'post', op: t.v, a: e, line: t.line };
      } else return e;
    }
  }

  primary(): Expr {
    const t = this.next();
    switch (t.t) {
      case 'num':
        return { k: 'num', v: t.n!, f: !!t.f, line: t.line };
      case 'str':
        return { k: 'str', v: t.v, line: t.line };
      case 'chr':
        return { k: 'chr', v: t.n!, line: t.line };
      case 'id': {
        if (t.v === 'true') return { k: 'num', v: 1, f: false, line: t.line };
        if (t.v === 'false') return { k: 'num', v: 0, f: false, line: t.line };
        if (t.v === 'nullptr' || t.v === 'NULL') return { k: 'num', v: 0, f: false, line: t.line };
        if (this.is('::')) {
          this.i++;
          const n = this.ident();
          return { k: 'scope', o: t.v, n, line: t.line };
        }
        // Funktionsartiger Cast: int(x), float(x), String(x)
        if (this.is('(') && ['int', 'float', 'double', 'long', 'byte', 'char', 'bool', 'word', 'uint8_t'].includes(t.v)) {
          this.i++;
          const a = this.expr();
          this.expect(')');
          const save = this.toks;
          void save;
          const ty = new Parser([{ t: 'id', v: t.v, line: t.line }, { t: 'eof', v: '', line: t.line }], this.classes).parseType().ty;
          return { k: 'cast', ty, a, line: t.line };
        }
        return { k: 'id', n: t.v, line: t.line };
      }
      case 'op':
        if (t.v === '(') {
          const e = this.expr();
          this.expect(')');
          return e;
        }
        if (t.v === '{') {
          this.i--;
          return this.initList();
        }
        throw new CompileError(t.line, `Zeile ${t.line}: Unerwartetes Zeichen „${t.v}“.`);
      default:
        throw new CompileError(t.line, `Zeile ${t.line}: Das Programm endet unerwartet – fehlt eine Klammer „}“?`);
    }
  }
}

/* ------------------------------ Codegen ------------------------------ */

export interface BuiltinSpec {
  ret: Ty;
  block?: boolean;
}

export interface CompileEnv {
  /** Breite von int in Bit (AVR 16, ESP32/RP2040 32) */
  intBits: number;
  /** vordefinierte Konstanten (Board-Pins etc.) */
  constants: Record<string, number>;
  /** bekannte Klassen (Bibliotheken) */
  classes: string[];
  /** globale Objekte wie Serial, WiFi */
  objects: string[];
}

export const BUILTINS: Record<string, BuiltinSpec> = {
  pinMode: { ret: T.void },
  digitalWrite: { ret: T.void },
  digitalRead: { ret: T.int },
  analogRead: { ret: T.int },
  analogReadMilliVolts: { ret: T.int },
  analogWrite: { ret: T.void },
  analogReadResolution: { ret: T.void },
  analogWriteResolution: { ret: T.void },
  analogReference: { ret: T.void },
  analogWriteFrequency: { ret: T.void },
  delay: { ret: T.void, block: true },
  delayMicroseconds: { ret: T.void, block: true },
  yield: { ret: T.void, block: true },
  millis: { ret: T.ulong },
  micros: { ret: T.ulong },
  tone: { ret: T.void },
  noTone: { ret: T.void },
  pulseIn: { ret: T.ulong, block: true },
  pulseInLong: { ret: T.ulong, block: true },
  shiftOut: { ret: T.void },
  shiftIn: { ret: T.int },
  random: { ret: T.long },
  randomSeed: { ret: T.void },
  map: { ret: T.long },
  constrain: { ret: T.any },
  min: { ret: T.any },
  max: { ret: T.any },
  abs: { ret: T.any },
  sq: { ret: T.any },
  sqrt: { ret: T.float },
  pow: { ret: T.float },
  sin: { ret: T.float },
  cos: { ret: T.float },
  tan: { ret: T.float },
  asin: { ret: T.float },
  acos: { ret: T.float },
  atan: { ret: T.float },
  atan2: { ret: T.float },
  floor: { ret: T.float },
  ceil: { ret: T.float },
  round: { ret: T.long },
  log: { ret: T.float },
  log10: { ret: T.float },
  exp: { ret: T.float },
  fabs: { ret: T.float },
  fmod: { ret: T.float },
  isnan: { ret: T.bool },
  isinf: { ret: T.bool },
  radians: { ret: T.float },
  degrees: { ret: T.float },
  bitRead: { ret: T.int },
  bitWrite: { ret: T.any },
  bitSet: { ret: T.any },
  bitClear: { ret: T.any },
  bit: { ret: T.ulong },
  lowByte: { ret: T.int },
  highByte: { ret: T.int },
  attachInterrupt: { ret: T.void },
  detachInterrupt: { ret: T.void },
  digitalPinToInterrupt: { ret: T.int },
  interrupts: { ret: T.void },
  noInterrupts: { ret: T.void },
  isDigit: { ret: T.bool },
  isAlpha: { ret: T.bool },
  isSpace: { ret: T.bool },
  isAlphaNumeric: { ret: T.bool },
  isUpperCase: { ret: T.bool },
  isLowerCase: { ret: T.bool },
  toUpperCase: { ret: T.char },
  toLowerCase: { ret: T.char },
  String: { ret: T.string },
  atoi: { ret: T.int },
  atol: { ret: T.long },
  atof: { ret: T.float },
  strlen: { ret: T.int },
  strcmp: { ret: T.int },
  ledcSetup: { ret: T.int },
  ledcAttachPin: { ret: T.void },
  ledcAttach: { ret: T.bool },
  ledcAttachChannel: { ret: T.bool },
  ledcWrite: { ret: T.void },
  ledcWriteTone: { ret: T.int },
  ledcDetach: { ret: T.void },
  esp_deep_sleep_start: { ret: T.void, block: true },
  esp_deep_sleep: { ret: T.void, block: true },
  esp_light_sleep_start: { ret: T.void, block: true },
  esp_sleep_enable_timer_wakeup: { ret: T.void },
  esp_sleep_enable_ext0_wakeup: { ret: T.void },
  esp_sleep_enable_ext1_wakeup: { ret: T.void },
  esp_deep_sleep_enable_gpio_wakeup: { ret: T.void },
  esp_sleep_get_wakeup_cause: { ret: T.int },
  esp_random: { ret: T.ulong },
  temperatureRead: { ret: T.float },
  touchRead: { ret: T.int },
  neopixelWrite: { ret: T.void },
  rgbLedWrite: { ret: T.void },
  __sizeof: { ret: T.int },
  sprintf: { ret: T.int },
  snprintf: { ret: T.int },
  dtostrf: { ret: T.string },
  F: { ret: T.string },
  PSTR: { ret: T.string },
  setCpuFrequencyMhz: { ret: T.void },
  sleep_ms: { ret: T.void, block: true },
  sleep_us: { ret: T.void, block: true },
};

/** Methoden mit bekanntem Rückgabetyp (für Ganzzahldivision & Ausgabeformat) */
const METHOD_RET: Record<string, Ty> = {
  readTemperature: T.float,
  readHumidity: T.float,
  readPressure: T.float,
  readAltitude: T.float,
  getTempCByIndex: T.float,
  getTempFByIndex: T.float,
  toFloat: T.float,
  toInt: T.long,
  length: T.int,
  available: T.int,
  read: T.int,
  readString: T.string,
  readStringUntil: T.string,
  substring: T.string,
  c_str: T.string,
  toString: T.string,
  getName: T.string,
  getAddress: T.any,
  getRSSI: T.int,
  getCount: T.int,
  indexOf: T.int,
  lastIndexOf: T.int,
  charAt: T.char,
  equals: T.bool,
  equalsIgnoreCase: T.bool,
  startsWith: T.bool,
  endsWith: T.bool,
  localIP: T.string,
  macAddress: T.string,
  SSID: T.string,
  RSSI: T.int,
  status: T.int,
  isConnected: T.bool,
  getAccelerationX: T.float,
  getTemperature: T.float,
  readLightLevel: T.float,
  readVoltage: T.float,
  readCurrent: T.float,
  getVoltage: T.float,
  ping_cm: T.int,
  read_cm: T.int,
};

const STRING_MUTATORS = new Set(['trim', 'toUpperCase', 'toLowerCase', 'replace', 'remove', 'concat', 'setCharAt', 'reserve']);

interface Sym {
  ty: Ty;
  js: string;
  isConst?: boolean;
}

class Gen {
  scopes: Map<string, Sym>[] = [new Map()];
  fns = new Map<string, FnDef>();
  out: string[] = [];
  curFn: FnDef | null = null;
  constructor(private env: CompileEnv) {}

  push() {
    this.scopes.push(new Map());
  }
  pop() {
    this.scopes.pop();
  }
  declare(name: string, sym: Sym) {
    this.scopes[this.scopes.length - 1].set(name, sym);
  }
  lookup(name: string): Sym | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const s = this.scopes[i].get(name);
      if (s) return s;
    }
    return undefined;
  }

  intTy(ty: Ty): Ty {
    if (ty.base === 'int' && !ty.bits) return { ...ty, bits: this.env.intBits };
    return ty;
  }

  /** Wert beim Zuweisen an eine Variable dieses Typs anpassen */
  coerce(js: string, ty: Ty, from: Ty): string {
    if (ty.dims) return js;
    const t = this.intTy(ty);
    switch (t.base) {
      case 'int':
        if (from.base === 'string') return `rt.toInt(${js})`;
        return `rt.wrap(${js},${t.bits},${t.unsigned ? 1 : 0})`;
      case 'char':
        if (from.base === 'string') return `rt.toInt(${js})`;
        return `rt.wrap(${js},8,${t.unsigned ? 1 : 0})`;
      case 'bool':
        return `((${js})?1:0)`;
      case 'float':
        if (from.base === 'string') return `rt.toFloat(${js})`;
        return `(+(${js}))`;
      case 'string':
        if (from.base === 'string') return js;
        return `rt.str(${js},${JSON.stringify(from.base)})`;
      default:
        return js;
    }
  }

  defaultValue(ty: Ty): string {
    switch (ty.base) {
      case 'string':
        return '""';
      case 'obj':
        return `rt.create(${JSON.stringify(ty.cls)},[])`;
      default:
        return '0';
    }
  }

  run(prog: { fns: FnDef[]; globals: Stmt[]; enums: EnumDef[] }): string {
    for (const [k, v] of Object.entries(this.env.constants)) this.declare(k, { ty: T.int, js: String(v), isConst: true });
    for (const o of this.env.objects) this.declare(o, { ty: { base: 'obj', cls: o }, js: `rt.obj.${o}` });
    for (const e of prog.enums) for (const [n, v] of e.names) this.declare(n, { ty: T.int, js: String(v), isConst: true });
    for (const f of prog.fns) {
      const prev = this.fns.get(f.name);
      if (prev?.body && f.body) throw new CompileError(f.line, `Zeile ${f.line}: Die Funktion „${f.name}“ ist doppelt definiert.`);
      if (!prev || f.body) this.fns.set(f.name, f);
    }
    if (!this.fns.get('setup')?.body) throw new CompileError(1, 'Es fehlt die Funktion „void setup()“. Jeder Arduino-Sketch braucht setup() und loop().');
    if (!this.fns.get('loop')?.body) throw new CompileError(1, 'Es fehlt die Funktion „void loop()“. Jeder Arduino-Sketch braucht setup() und loop().');
    const lines: string[] = ['"use strict";'];
    for (const g of prog.globals) {
      lines.push(this.stmt(g, true));
      if (g.k === 'decl') for (const v of g.vars) if (!v.ctor) this.globalNames.push(v.n);
    }
    for (const f of this.fns.values()) {
      if (!f.body) continue;
      this.curFn = f;
      this.push();
      const params = f.params.map((p) => {
        const js = 'u_' + p.n;
        this.declare(p.n, { ty: p.ty, js });
        return js;
      });
      lines.push(`function* u_${f.name}(${params.join(',')}){if(rt.tick())yield 0;${this.stmt(f.body)}}`);
      this.pop();
      this.curFn = null;
    }
    lines.push(`return {setup:u_setup,loop:u_loop,vars:()=>({${this.globalNames.map((n) => `${JSON.stringify(n)}:u_${n}`).join(',')}})};`);
    return lines.join('\n');
  }

  stmt(s: Stmt, global = false): string {
    switch (s.k) {
      case 'block': {
        this.push();
        const r = '{' + s.body.map((b) => this.stmt(b)).join('') + '}';
        this.pop();
        return r;
      }
      case 'empty':
        return ';';
      case 'decl': {
        const parts: string[] = [];
        for (const v of s.vars) {
          let ty: Ty = s.ty;
          if (v.dims.length) ty = { ...s.ty, dims: v.dims.length };
          // char name[] = "..." → String
          if ((s.ty.base === 'char') && v.dims.length === 1 && (v.init?.k === 'str' || !v.init)) ty = T.string;
          if ((s.ty.base === 'string') && v.dims.length && v.init?.k === 'init') ty = { ...T.string, dims: v.dims.length };
          let init: string;
          if (v.ctor) {
            const args = v.ctor.map((a) => this.expr(a).js);
            init = `rt.create(${JSON.stringify(s.ty.cls)},[${args.join(',')}],${v.line})`;
          } else if (v.init) {
            if (ty.dims) {
              init = this.arrayInit(v.init, ty, v.dims);
            } else {
              if (ty.base === 'any') {
                const e = this.expr(v.init);
                ty = e.ty;
                init = e.js;
              } else {
                const e = this.expr(v.init);
                init = this.coerce(e.js, ty, e.ty);
              }
            }
          } else if (ty.dims) {
            const dims = v.dims.map((d) => (d ? this.expr(d).js : '0'));
            init = `rt.arr([${dims.join(',')}],${JSON.stringify(this.defaultValue({ ...s.ty, dims: 0 }))})`;
          } else init = this.defaultValue(ty);
          const js = 'u_' + v.n;
          this.declare(v.n, { ty, js, isConst: s.isConst });
          parts.push(`${js}=${init}`);
        }
        return (global || this.inForInit ? '' : this.dbg(s.line)) + `let ${parts.join(',')};`;
      }
      case 'expr':
        return this.dbg(s.line) + this.exprStmt(s.e) + ';';
      case 'if':
        return `if(rt.truthy(${this.expr(s.c).js}))${this.wrapStmt(s.a)}${s.b ? 'else ' + this.wrapStmt(s.b) : ''}`;
      case 'while':
        return `while(rt.truthy(${this.expr(s.c).js})){if(rt.tick())yield 0;${this.wrapStmt(s.body)}}`;
      case 'do':
        return `do{if(rt.tick())yield 0;${this.wrapStmt(s.body)}}while(rt.truthy(${this.expr(s.c).js}));`;
      case 'for': {
        this.push();
        let init = '';
        if (s.init) {
          this.inForInit = true;
          init = this.stmt(s.init);
          this.inForInit = false;
          if (init.endsWith(';')) init = init.slice(0, -1);
        }
        const c = s.c ? `rt.truthy(${this.expr(s.c).js})` : '';
        const step = s.step ? this.exprStmt(s.step) : '';
        const body = this.wrapStmt(s.body);
        this.pop();
        return `for(${init};${c};${step}){if(rt.tick())yield 0;${body}}`;
      }
      case 'switch': {
        const e = this.expr(s.e).js;
        const cases = s.cases
          .map((c) => {
            this.push();
            const body = c.body.map((b) => this.stmt(b)).join('');
            this.pop();
            return (c.v ? `case ${this.expr(c.v).js}:` : 'default:') + `{${body}}`;
          })
          .join('');
        return `switch(${e}){${cases}}`;
      }
      case 'break':
        return 'break;';
      case 'continue':
        return 'continue;';
      case 'return': {
        if (!s.e) return this.dbg(s.line) + 'return;';
        const e = this.expr(s.e);
        const ret = this.curFn?.ret ?? T.any;
        return this.dbg(s.line) + `return ${ret.base === 'void' || ret.base === 'any' ? e.js : this.coerce(e.js, ret, e.ty)};`;
      }
    }
  }

  inForInit = false;
  globalNames: string[] = [];
  /** Zeilenmarke für Debugger (Haltepunkte, Einzelschritt) */
  dbg(line: number): string {
    return `rt.ln=${line};if(rt.dbg&&rt.bp(${line}))yield -2;`;
  }

  wrapStmt(s: Stmt): string {
    if (s.k === 'block') return this.stmt(s);
    this.push();
    const r = '{' + this.stmt(s) + '}';
    this.pop();
    return r;
  }

  arrayInit(e: Expr, ty: Ty, dims: (Expr | null)[]): string {
    const elemTy: Ty = { ...ty, dims: 0 };
    if (e.k === 'str') return `rt.strArr(${JSON.stringify(e.v)})`;
    if (e.k !== 'init') return this.expr(e).js;
    const rec = (x: Expr, depth: number): string => {
      if (x.k === 'init') {
        const items = x.items.map((it) => rec(it, depth + 1));
        const size = dims[depth] ? this.expr(dims[depth]!).js : String(items.length);
        return `rt.pad([${items.join(',')}],${size},${JSON.stringify(depth + 1 < dims.length ? '[]' : this.defaultValue(elemTy))})`;
      }
      const ex = this.expr(x);
      return this.coerce(ex.js, elemTy, ex.ty);
    };
    return rec(e, 0);
  }

  /** Ausdruck als Anweisung – erlaubt String-Mutatoren und sprintf in Puffer */
  exprStmt(e: Expr): string {
    if (e.k === 'call' && e.f.k === 'mem' && STRING_MUTATORS.has(e.f.n)) {
      const o = this.expr(e.f.o);
      if (o.ty.base === 'string') {
        const args = e.args.map((a) => this.expr(a).js);
        return `${o.js}=rt.strm(${o.js},${JSON.stringify(e.f.n)},[${args.join(',')}])`;
      }
    }
    if (e.k === 'call' && e.f.k === 'id' && (e.f.n === 'sprintf' || e.f.n === 'snprintf' || e.f.n === 'dtostrf' || e.f.n === 'strcpy' || e.f.n === 'strcat' || e.f.n === 'itoa')) {
      const args = e.args.map((a) => this.expr(a));
      if (e.f.n === 'sprintf') return `${args[0].js}=rt.sprintf(${args.slice(1).map((a) => a.js).join(',')})`;
      if (e.f.n === 'snprintf') return `${args[0].js}=rt.sprintf(${args.slice(2).map((a) => a.js).join(',')})`;
      if (e.f.n === 'dtostrf') return `${args[3].js}=rt.dtostrf(${args[0].js},${args[1].js},${args[2].js})`;
      if (e.f.n === 'strcpy') return `${args[0].js}=rt.str(${args[1].js},${JSON.stringify(args[1].ty.base)})`;
      if (e.f.n === 'strcat') return `${args[0].js}+=rt.str(${args[1].js},${JSON.stringify(args[1].ty.base)})`;
      if (e.f.n === 'itoa') return `${args[1].js}=(${args[0].js}).toString(${args[2]?.js ?? 10})`;
    }
    return this.expr(e).js;
  }

  lval(e: Expr): { js: string; ty: Ty } {
    if (e.k === 'id') {
      const s = this.lookup(e.n);
      if (!s) throw new CompileError(e.line, `Zeile ${e.line}: Die Variable „${e.n}“ ist nicht bekannt. Tippfehler oder fehlt die Deklaration (z. B. „int ${e.n} = 0;“)?`);
      if (s.isConst) throw new CompileError(e.line, `Zeile ${e.line}: „${e.n}“ ist eine Konstante und kann nicht verändert werden.`);
      return { js: s.js, ty: s.ty };
    }
    return this.expr(e);
  }

  expr(e: Expr): { js: string; ty: Ty } {
    switch (e.k) {
      case 'num':
        return { js: String(e.v), ty: e.f ? T.float : e.v > 2147483647 ? T.ulong : e.v > 32767 ? T.long : T.int };
      case 'str':
        return { js: JSON.stringify(e.v), ty: T.string };
      case 'chr':
        return { js: String(e.v), ty: T.char };
      case 'id': {
        const s = this.lookup(e.n);
        if (s) return { js: s.js, ty: s.ty };
        if (this.fns.has(e.n)) return { js: 'u_' + e.n, ty: T.any };
        if (e.n in BUILTINS) return { js: `rt.fn.${e.n}`, ty: T.any };
        throw new CompileError(e.line, `Zeile ${e.line}: „${e.n}“ ist nicht bekannt. Ist das ein Tippfehler, oder fehlt eine Variable bzw. ein #define?`);
      }
      case 'scope':
        return { js: `rt.obj[${JSON.stringify(e.o)}]?.[${JSON.stringify(e.n)}]`, ty: T.any };
      case 'cast': {
        const a = this.expr(e.a);
        if (e.ty.base === 'float') return { js: `(+(${a.js}))`, ty: T.float };
        return { js: this.coerce(a.js, e.ty, a.ty), ty: e.ty };
      }
      case 'tern': {
        const a = this.expr(e.a);
        const b = this.expr(e.b);
        return { js: `(rt.truthy(${this.expr(e.c).js})?${a.js}:${b.js})`, ty: a.ty.base === 'float' || b.ty.base === 'float' ? T.float : a.ty };
      }
      case 'un': {
        const a = this.expr(e.a);
        if (e.op === '!') return { js: `(rt.truthy(${a.js})?0:1)`, ty: T.bool };
        if (e.op === '~') return { js: `(~(${a.js}))`, ty: this.intTy(a.ty.base === 'int' ? a.ty : T.int) };
        if (e.op === '-') return { js: `(-(${a.js}))`, ty: a.ty.base === 'float' ? T.float : a.ty.base === 'any' ? T.any : { ...this.intTy(T.int), bits: Math.max(this.intTy(a.ty).bits ?? 16, this.env.intBits) } };
        return a;
      }
      case 'post': {
        const t = this.lval(e.a);
        const d = e.op === '++' ? '+1' : '-1';
        if (t.ty.base === 'float' || t.ty.base === 'any') return { js: `(${t.js}${e.op})`, ty: t.ty };
        const tmp = `rt.t`;
        return { js: `(${tmp}=${t.js},${t.js}=${this.coerce(`${tmp}${d}`, t.ty, t.ty)},${tmp})`.replace(/rt\.t/g, '$t'), ty: t.ty };
      }
      case 'asg': {
        const t = this.lval(e.t);
        if (e.v.k === 'init' && t.ty.dims) {
          return { js: `(${t.js}=${this.arrayInit(e.v, t.ty, new Array(t.ty.dims).fill(null))})`, ty: t.ty };
        }
        const v = this.expr(e.v);
        if (e.op === '=') return { js: `(${t.js}=${this.coerce(v.js, t.ty, v.ty)})`, ty: t.ty };
        const op = e.op.slice(0, -1);
        const bin = this.binop(op, t, v, e.line);
        return { js: `(${t.js}=${this.coerce(bin.js, t.ty, bin.ty)})`, ty: t.ty };
      }
      case 'bin': {
        if (e.op === ',') {
          const a = this.expr(e.a);
          const b = this.expr(e.b);
          return { js: `(${a.js},${b.js})`, ty: b.ty };
        }
        return this.binop(e.op, this.expr(e.a), this.expr(e.b), e.line);
      }
      case 'idx': {
        const a = this.expr(e.a);
        const i = this.expr(e.i);
        if (a.ty.base === 'string' && !a.ty.dims) return { js: `rt.charAt(${a.js},${i.js})`, ty: T.char };
        const ty: Ty = a.ty.dims ? { ...a.ty, dims: a.ty.dims - 1 || undefined } : T.any;
        return { js: `${a.js}[${i.js}]`, ty };
      }
      case 'mem': {
        const o = this.expr(e.o);
        return { js: `rt.prop(${o.js},${JSON.stringify(e.n)})`, ty: T.any };
      }
      case 'init':
        return { js: `[${e.items.map((x) => this.expr(x).js).join(',')}]`, ty: { ...T.any, dims: 1 } };
      case 'call':
        return this.call(e);
    }
  }

  binop(op: string, a: { js: string; ty: Ty }, b: { js: string; ty: Ty }, line: number): { js: string; ty: Ty } {
    const isStr = a.ty.base === 'string' && !a.ty.dims || b.ty.base === 'string' && !b.ty.dims;
    if (op === '+' && isStr) {
      return { js: `(rt.str(${a.js},${JSON.stringify(a.ty.base)})+rt.str(${b.js},${JSON.stringify(b.ty.base)}))`, ty: T.string };
    }
    const isFloat = a.ty.base === 'float' || b.ty.base === 'float';
    const isAny = a.ty.base === 'any' || b.ty.base === 'any';
    const ia = this.intTy(a.ty.base === 'int' ? a.ty : T.int);
    const ib = this.intTy(b.ty.base === 'int' ? b.ty : T.int);
    const intTy: Ty = { base: 'int', bits: Math.max(ia.bits!, ib.bits!, this.env.intBits), unsigned: ia.unsigned || ib.unsigned };
    switch (op) {
      case '&&':
        return { js: `((rt.truthy(${a.js})&&rt.truthy(${b.js}))?1:0)`, ty: T.bool };
      case '||':
        return { js: `((rt.truthy(${a.js})||rt.truthy(${b.js}))?1:0)`, ty: T.bool };
      case '==':
      case '!=':
        if (isStr) return { js: `(rt.str(${a.js},${JSON.stringify(a.ty.base)})${op}=rt.str(${b.js},${JSON.stringify(b.ty.base)})?1:0)`, ty: T.bool };
        return { js: `((${a.js})${op}(${b.js})?1:0)`, ty: T.bool };
      case '<':
      case '>':
      case '<=':
      case '>=':
        return { js: `((${a.js})${op}(${b.js})?1:0)`, ty: T.bool };
      case '/':
        if (isFloat) return { js: `((${a.js})/(${b.js}))`, ty: T.float };
        if (isAny) return { js: `rt.div(${a.js},${b.js},${line})`, ty: T.any };
        return { js: `rt.idiv(${a.js},${b.js},${line})`, ty: intTy };
      case '%':
        if (isFloat) throw new CompileError(line, `Zeile ${line}: Der Rest-Operator „%“ funktioniert in C nur mit ganzen Zahlen. Für Kommazahlen nimm fmod(a, b).`);
        return { js: `rt.imod(${a.js},${b.js},${line})`, ty: isAny ? T.any : intTy };
      case '+':
      case '-':
      case '*':
        return { js: `((${a.js})${op}(${b.js}))`, ty: isFloat ? T.float : isAny ? T.any : intTy };
      case '&':
      case '|':
      case '^':
        return { js: `rt.bitop(${a.js},${b.js},${JSON.stringify(op)})`, ty: intTy };
      case '<<':
        return { js: `rt.shl(${a.js},${b.js})`, ty: { ...intTy, bits: Math.max(intTy.bits!, 32) } };
      case '>>':
        return { js: `rt.shr(${a.js},${b.js})`, ty: intTy };
    }
    throw new CompileError(line, `Zeile ${line}: Der Operator „${op}“ wird nicht unterstützt.`);
  }

  call(e: Extract<Expr, { k: 'call' }>): { js: string; ty: Ty } {
    const f = e.f;
    const args = e.args.map((a) => this.expr(a));
    const argJs = args.map((a) => a.js).join(',');
    if (f.k === 'id') {
      const user = this.fns.get(f.n);
      if (user && !this.lookup(f.n)) {
        if (!user.body) throw new CompileError(e.line, `Zeile ${e.line}: Die Funktion „${f.n}“ wurde angekündigt, aber nie geschrieben.`);
        const conv = args.map((a, i) => {
          const p = user.params[i];
          return p ? this.coerce(a.js, p.ty, a.ty) : a.js;
        });
        return { js: `(yield* u_${f.n}(${conv.join(',')}))`, ty: user.ret };
      }
      const b = BUILTINS[f.n];
      if (b) {
        if (f.n === 'String') {
          return { js: `rt.toStr(${args[0]?.js ?? '""'},${JSON.stringify(args[0]?.ty.base ?? 'string')}${args[1] ? ',' + args[1].js : ''})`, ty: T.string };
        }
        if (f.n === 'F' || f.n === 'PSTR') return args[0];
        if (f.n === 'sprintf') return { js: `(${args[0].js}=rt.sprintf(${args.slice(1).map((a) => a.js).join(',')})).length`, ty: T.int };
        if (f.n === 'snprintf') return { js: `(${args[0].js}=rt.sprintf(${args.slice(2).map((a) => a.js).join(',')})).length`, ty: T.int };
        if (['min', 'max', 'abs', 'constrain', 'sq'].includes(f.n)) {
          const fl = args.some((a) => a.ty.base === 'float');
          return { js: `rt.fn.${f.n}(${argJs})`, ty: fl ? T.float : args[0]?.ty.base === 'int' ? args[0].ty : T.any };
        }
        if (f.n === 'bitSet' || f.n === 'bitClear' || f.n === 'bitWrite') {
          const t = this.lval(e.args[0]);
          return { js: `(${t.js}=rt.fn.${f.n}(${argJs}))`, ty: t.ty };
        }
        if (b.block) return { js: `(yield* rt.blk(rt.fn.${f.n}(${argJs})))`, ty: b.ret };
        return { js: `rt.fn.${f.n}(${argJs})`, ty: b.ret };
      }
      const sym = this.lookup(f.n);
      if (sym) return { js: `(yield* rt.callv(${sym.js},[${argJs}]))`, ty: T.any };
      throw new CompileError(
        e.line,
        `Zeile ${e.line}: Die Funktion „${f.n}()“ gibt es nicht. Tippfehler? (Groß-/Kleinschreibung beachten) – oder sie stammt aus einer Bibliothek, die die Simulation noch nicht kennt.`,
      );
    }
    if (f.k === 'mem' || f.k === 'scope') {
      const name = f.n;
      let objJs: string;
      let objTy: Ty = T.any;
      if (f.k === 'mem') {
        const o = this.expr(f.o);
        objJs = o.js;
        objTy = o.ty;
      } else objJs = `rt.obj[${JSON.stringify(f.o)}]`;
      let ret: Ty = METHOD_RET[name] ?? T.any;
      if (objTy.base === 'string' && name === 'length') ret = T.int;
      // print/println: Wert anhand des statischen Typs formatieren
      if (name === 'print' || name === 'println' || name === 'write' && args[0]?.ty.base === 'string') {
        if (args.length === 0) return { js: `(yield* rt.mcall(${objJs},${JSON.stringify(name)},[""],${e.line}))`, ty: T.int };
        const fmt = `rt.fmt(${args[0].js},${JSON.stringify(args[0].ty.base)}${args[1] ? ',' + args[1].js : ''})`;
        return { js: `(yield* rt.mcall(${objJs},${JSON.stringify(name)},[${fmt}],${e.line}))`, ty: T.int };
      }
      if (name === 'printf') {
        return { js: `(yield* rt.mcall(${objJs},"print",[rt.sprintf(${argJs})],${e.line}))`, ty: T.int };
      }
      return { js: `(yield* rt.mcall(${objJs},${JSON.stringify(name)},[${argJs}],${e.line}))`, ty: ret };
    }
    const fe = this.expr(f);
    return { js: `(yield* rt.callv(${fe.js},[${argJs}]))`, ty: T.any };
  }
}

export interface CompiledProgram {
  code: string;
  includes: string[];
  factory: (rt: unknown) => { setup: () => Generator<number, unknown, unknown>; loop: () => Generator<number, unknown, unknown>; vars?: () => Record<string, unknown> };
}

export function compileSketch(src: string, env: CompileEnv): CompiledProgram {
  const raw = lex(src);
  const { toks, includes } = preprocess(raw, {});
  const parser = new Parser(toks, new Set(env.classes));
  const prog = parser.program();
  const gen = new Gen(env);
  const body = gen.run(prog);
  const code = `let $t;\n${body}`;
  let factory: CompiledProgram['factory'];
  try {
    factory = new Function('rt', code) as CompiledProgram['factory'];
  } catch (err) {
    throw new CompileError(1, `Interner Übersetzungsfehler: ${(err as Error).message}`);
  }
  return { code, includes, factory };
}
