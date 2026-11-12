/** Leichtgewichtiger Code-Editor mit Syntaxhervorhebung (Arduino-C++) */
import { useEffect, useMemo, useRef } from 'react';

const KW = new Set(['if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'return', 'const', 'static', 'volatile', 'unsigned', 'signed', 'struct', 'class', 'enum', 'typedef', 'true', 'false', 'HIGH', 'LOW', 'INPUT', 'OUTPUT', 'INPUT_PULLUP', 'nullptr', 'NULL', 'sizeof', 'new', 'delete', 'auto', 'public', 'private']);
const TY = new Set(['void', 'int', 'long', 'short', 'char', 'float', 'double', 'bool', 'boolean', 'byte', 'word', 'String', 'size_t', 'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t', 'int8_t', 'int16_t', 'int32_t', 'int64_t']);

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const PY_KW = new Set(['def', 'class', 'if', 'elif', 'else', 'for', 'while', 'in', 'not', 'and', 'or', 'return', 'import', 'from', 'as', 'True', 'False', 'None', 'try', 'except', 'finally', 'with', 'pass', 'break', 'continue', 'lambda', 'global', 'async', 'await', 'raise', 'is', 'del', 'yield']);

export function highlightPy(code: string): string {
  let out = '';
  const re = /(#[^\n]*)|("""[\s\S]*?"""|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_]\w*\b)(\s*\()?/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    out += esc(code.slice(last, m.index));
    if (m[1]) out += `<span class="tok-com">${esc(m[1])}</span>`;
    else if (m[2]) out += `<span class="tok-str">${esc(m[2])}</span>`;
    else if (m[3]) out += `<span class="tok-num">${m[3]}</span>`;
    else if (m[4]) {
      const w = m[4];
      if (PY_KW.has(w)) out += `<span class="tok-kw">${w}</span>`;
      else if (m[5]) out += `<span class="tok-fn">${w}</span>`;
      else out += w;
      if (m[5]) out += esc(m[5]);
    }
    last = re.lastIndex;
  }
  return out + esc(code.slice(last));
}

export function highlight(code: string): string {
  let out = '';
  const re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(^[ \t]*#[^\n]*)|(\b0x[0-9a-fA-F]+\b|\b\d+(?:\.\d+)?[uUlLfF]*\b)|(\b[A-Za-z_]\w*\b)(\s*\()?/gm;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    out += esc(code.slice(last, m.index));
    if (m[1]) out += `<span class="tok-com">${esc(m[1])}</span>`;
    else if (m[2]) out += `<span class="tok-str">${esc(m[2])}</span>`;
    else if (m[3]) out += `<span class="tok-pre">${esc(m[3])}</span>`;
    else if (m[4]) out += `<span class="tok-num">${esc(m[4])}</span>`;
    else if (m[5]) {
      const w = m[5];
      if (KW.has(w)) out += `<span class="tok-kw">${w}</span>`;
      else if (TY.has(w)) out += `<span class="tok-ty">${w}</span>`;
      else if (m[6]) out += `<span class="tok-fn">${w}</span>`;
      else out += w;
      if (m[6]) out += esc(m[6]);
    }
    last = re.lastIndex;
  }
  out += esc(code.slice(last));
  return out;
}

export function CodeEditor({ value, onChange, errorLine, readOnly, lang = 'arduino', breakpoints, onToggleBreakpoint, currentLine }: { value: string; onChange: (v: string) => void; errorLine?: number | null; readOnly?: boolean; lang?: string; breakpoints?: number[]; onToggleBreakpoint?: (line: number) => void; currentLine?: number | null }) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const lines = value.split('\n').length;
  const html = useMemo(() => {
    const h = lang === 'micropython' || lang === 'python' ? highlightPy(value) : highlight(value);
    const parts = h.split('\n');
    if (errorLine && parts[errorLine - 1] !== undefined) parts[errorLine - 1] = `<span class="err-line">${parts[errorLine - 1] || ' '}</span>`;
    if (currentLine && parts[currentLine - 1] !== undefined) parts[currentLine - 1] = `<span class="cur-line">${parts[currentLine - 1] || ' '}</span>`;
    return parts.join('\n') + '\n';
  }, [value, errorLine, lang, currentLine]);

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, wrap.current?.clientHeight ?? 0)}px`;
    el.style.width = 'auto';
    el.style.width = `${Math.max(el.scrollWidth, wrap.current?.clientWidth ?? 0)}px`;
  }, [value]);

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const { selectionStart: s, selectionEnd: en } = el;
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        const ls = value.lastIndexOf('\n', s - 1) + 1;
        if (value.slice(ls, ls + 2) === '  ') {
          onChange(value.slice(0, ls) + value.slice(ls + 2));
          requestAnimationFrame(() => el.setSelectionRange(Math.max(ls, s - 2), Math.max(ls, en - 2)));
        }
        return;
      }
      const nv = value.slice(0, s) + '  ' + value.slice(en);
      onChange(nv);
      requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const ls = value.lastIndexOf('\n', s - 1) + 1;
      const indent = /^[ \t]*/.exec(value.slice(ls, s))![0];
      const extra = /[{(]\s*$/.test(value.slice(ls, s)) ? '  ' : '';
      const closing = /^\s*}/.test(value.slice(en)) && extra;
      const ins = '\n' + indent + extra + (closing ? '\n' + indent : '');
      onChange(value.slice(0, s) + ins + value.slice(en));
      const pos = s + 1 + indent.length + extra.length;
      requestAnimationFrame(() => el.setSelectionRange(pos, pos));
    } else if (e.key === '}' && s === en) {
      const ls = value.lastIndexOf('\n', s - 1) + 1;
      if (/^\s+$/.test(value.slice(ls, s)) && value.slice(ls, s).length >= 2) {
        e.preventDefault();
        onChange(value.slice(0, s - 2) + '}' + value.slice(en));
        requestAnimationFrame(() => el.setSelectionRange(s - 1, s - 1));
      }
    } else if ((e.metaKey || e.ctrlKey) && e.key === '/') {
      e.preventDefault();
      const ls = value.lastIndexOf('\n', s - 1) + 1;
      let le = value.indexOf('\n', en);
      if (le < 0) le = value.length;
      const block = value.slice(ls, le).split('\n');
      const all = block.every((l) => /^\s*\/\//.test(l) || !l.trim());
      const nb = block.map((l) => (all ? l.replace(/^(\s*)\/\/ ?/, '$1') : l.trim() ? l.replace(/^(\s*)/, '$1// ') : l)).join('\n');
      onChange(value.slice(0, ls) + nb + value.slice(le));
    }
  };

  return (
    <div className="editor">
      <div className="gutter" ref={gutter}>
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className={`${errorLine === i + 1 ? 'err' : ''} ${breakpoints?.includes(i + 1) ? 'bp' : ''} ${currentLine === i + 1 ? 'cur' : ''}`} onClick={() => onToggleBreakpoint?.(i + 1)} title={onToggleBreakpoint ? 'Haltepunkt setzen/entfernen' : undefined}>
            {i + 1}
          </div>
        ))}
      </div>
      <div
        className="code-wrap"
        ref={wrap}
        onScroll={(e) => {
          if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
        }}
      >
        <pre aria-hidden dangerouslySetInnerHTML={{ __html: html }} />
        <textarea ref={ta} value={value} spellCheck={false} autoCapitalize="off" autoCorrect="off" readOnly={readOnly} onChange={(e) => onChange(e.target.value)} onKeyDown={onKey} />
      </div>
    </div>
  );
}
