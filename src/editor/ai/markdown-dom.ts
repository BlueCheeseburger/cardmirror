/**
 * A small Markdown renderer for AI replies (the deeper card analysis). Builds
 * DOM nodes directly and only ever sets `textContent`, so nothing the model
 * writes can inject HTML. Covers what chat replies use: headings, paragraphs,
 * bullet and numbered lists (one level of nesting), block quotes, horizontal
 * rules, fenced code, and inline **bold**, *italic*, `code` and
 * ~~strikethrough~~.
 */

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'para'; lines: string[] }
  | { kind: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'rule' }
  | { kind: 'code'; text: string };

interface ListItem {
  text: string;
  children: { ordered: boolean; items: string[] } | null;
}

const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const NUMBERED = /^(\s*)(\d+)[.)]\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === '') {
      i++;
      continue;
    }
    if (/^\s*```/.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i]!)) body.push(lines[i++]!);
      i++; // closing fence (or end of input)
      blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      blocks.push({ kind: 'heading', level: h[1]!.length, text: h[2]! });
      i++;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' });
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!)) q.push(lines[i++]!.replace(/^\s*>\s?/, ''));
      blocks.push({ kind: 'quote', lines: q });
      continue;
    }
    const b = BULLET.exec(line);
    const n = NUMBERED.exec(line);
    if (b || n) {
      const ordered = !b;
      const baseIndent = (b ? b[1]! : n![1]!).length;
      const list: Block & { kind: 'list' } = {
        kind: 'list',
        ordered,
        start: n ? parseInt(n[2]!, 10) : 1,
        items: [],
      };
      while (i < lines.length) {
        const l = lines[i]!;
        if (l.trim() === '') {
          // A blank line ends the list unless the next line continues it.
          const next = lines[i + 1];
          if (next !== undefined && (ordered ? NUMBERED : BULLET).test(next)) {
            i++;
            continue;
          }
          break;
        }
        const lb = BULLET.exec(l);
        const ln = NUMBERED.exec(l);
        const m = lb ?? ln;
        if (m) {
          const indent = m[1]!.length;
          const text = lb ? lb[2]! : ln![3]!;
          const last = list.items[list.items.length - 1];
          // A top-level marker of the other kind starts a new list.
          if (indent <= baseIndent && !lb !== ordered) break;
          if (indent > baseIndent && last) {
            last.children ??= { ordered: !lb, items: [] };
            last.children.items.push(text);
          } else {
            list.items.push({ text, children: null });
          }
          i++;
          continue;
        }
        // A plain line right under an item continues that item.
        const last = list.items[list.items.length - 1];
        if (last && /^\s+\S/.test(l)) {
          last.text += ' ' + l.trim();
          i++;
          continue;
        }
        break;
      }
      blocks.push(list);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length) {
      const l = lines[i]!;
      if (
        l.trim() === '' ||
        HEADING.test(l) ||
        RULE.test(l) ||
        /^\s*>/.test(l) ||
        /^\s*```/.test(l) ||
        BULLET.test(l) ||
        NUMBERED.test(l)
      ) {
        break;
      }
      para.push(l.trim());
      i++;
    }
    blocks.push({ kind: 'para', lines: para });
  }
  return blocks;
}

const INLINE = /(\*\*|__)(.+?)\1|(\*|_)(?!\s)(.+?)(?<!\s)\3|`([^`]+)`|~~(.+?)~~/g;

/** Append `text` with inline formatting to `parent`. */
export function appendInline(parent: HTMLElement, text: string): void {
  let last = 0;
  // A fresh regex per call: this recurses into bold/italic runs, and a
  // shared /g regex would have its lastIndex reset under the outer loop.
  const re = new RegExp(INLINE.source, 'g');
  for (let m = re.exec(text); m; m = re.exec(text)) {
    // `_` only counts as emphasis at word edges (snake_case stays literal).
    if (m[3] === '_' || m[1] === '__') {
      const before = text[m.index - 1];
      const after = text[m.index + m[0].length];
      if ((before && /\w/.test(before)) || (after && /\w/.test(after))) continue;
    }
    if (m.index > last) parent.append(text.slice(last, m.index));
    if (m[2] !== undefined) {
      const el = document.createElement('strong');
      appendInline(el, m[2]);
      parent.appendChild(el);
    } else if (m[4] !== undefined) {
      const el = document.createElement('em');
      appendInline(el, m[4]);
      parent.appendChild(el);
    } else if (m[5] !== undefined) {
      const el = document.createElement('code');
      el.textContent = m[5];
      parent.appendChild(el);
    } else if (m[6] !== undefined) {
      const el = document.createElement('s');
      appendInline(el, m[6]);
      parent.appendChild(el);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parent.append(text.slice(last));
}

const EMPHASIS = /(\*\*|__)(.+?)\1|(\*|_)(?!\s)(.+?)(?<!\s)\3/g;

/** Append `text` to `parent` rendering only **bold** and *italic*; every
 *  other character, Markdown included, stays literal text. */
export function appendEmphasis(parent: HTMLElement, text: string): void {
  let last = 0;
  const re = new RegExp(EMPHASIS.source, 'g');
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[3] === '_' || m[1] === '__') {
      const before = text[m.index - 1];
      const after = text[m.index + m[0].length];
      if ((before && /\w/.test(before)) || (after && /\w/.test(after))) continue;
    }
    if (m.index > last) parent.append(text.slice(last, m.index));
    const el = document.createElement(m[2] !== undefined ? 'strong' : 'em');
    appendEmphasis(el, m[2] ?? m[4]!);
    parent.appendChild(el);
    last = m.index + m[0].length;
  }
  if (last < text.length) parent.append(text.slice(last));
}

/** A new element whose text renders bold / italic only (see appendEmphasis). */
export function emphasisEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string | undefined,
  text: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  appendEmphasis(e, text);
  return e;
}

function listEl(ordered: boolean, start: number): HTMLElement {
  const el = document.createElement(ordered ? 'ol' : 'ul');
  if (ordered && start !== 1) el.setAttribute('start', String(start));
  return el;
}

/** Render `src` as Markdown into a new container element. */
export function renderMarkdown(src: string): HTMLElement {
  const root = document.createElement('div');
  root.className = 'pmd-md';
  for (const b of parseBlocks(src)) {
    if (b.kind === 'heading') {
      // Chat replies never need a page-level h1; start at h3.
      const el = document.createElement(`h${Math.min(6, b.level + 2)}`);
      appendInline(el, b.text);
      root.appendChild(el);
    } else if (b.kind === 'para') {
      const p = document.createElement('p');
      b.lines.forEach((l, k) => {
        if (k > 0) p.appendChild(document.createElement('br'));
        appendInline(p, l);
      });
      root.appendChild(p);
    } else if (b.kind === 'list') {
      const list = listEl(b.ordered, b.start);
      for (const item of b.items) {
        const li = document.createElement('li');
        appendInline(li, item.text);
        if (item.children) {
          const sub = listEl(item.children.ordered, 1);
          for (const t of item.children.items) {
            const sli = document.createElement('li');
            appendInline(sli, t);
            sub.appendChild(sli);
          }
          li.appendChild(sub);
        }
        list.appendChild(li);
      }
      root.appendChild(list);
    } else if (b.kind === 'quote') {
      const q = document.createElement('blockquote');
      appendInline(q, b.lines.join(' '));
      root.appendChild(q);
    } else if (b.kind === 'rule') {
      root.appendChild(document.createElement('hr'));
    } else {
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = b.text;
      pre.appendChild(code);
      root.appendChild(pre);
    }
  }
  return root;
}
