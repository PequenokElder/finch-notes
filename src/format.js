// Markdown formatting commands. Every command takes an EditorView and edits the selection.
import { EditorSelection } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { queueTableFocus } from './tables.js';

// ---------- helpers ----------

function selectedLines(state, range) {
  const doc = state.doc;
  const first = doc.lineAt(range.from);
  let last = doc.lineAt(range.to);
  // A selection that ends at the very start of a line shouldn't include that line.
  if (!range.empty && range.to === last.from && last.number > first.number) last = doc.line(last.number - 1);
  const lines = [];
  for (let n = first.number; n <= last.number; n++) lines.push(doc.line(n));
  return lines;
}

// Split a line into its quote prefix, indent, list marker, heading marker and the rest.
function parse(text) {
  const q = text.match(/^(?:\s{0,3}>\s?)*/)[0];
  let rest = text.slice(q.length);
  const indent = rest.match(/^\s*/)[0];
  rest = rest.slice(indent.length);
  let list = null;
  let heading = 0;
  let m;
  if ((m = rest.match(/^([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/))) {
    list = { kind: m[2] ? 'task' : /\d/.test(m[1]) ? 'ordered' : 'bullet', raw: m[0] };
    rest = rest.slice(m[0].length);
  } else if ((m = rest.match(/^(#{1,6})\s+/))) {
    heading = m[1].length;
    rest = rest.slice(m[0].length);
  }
  return { q, indent, list, heading, rest };
}

function build(p) {
  return p.q + p.indent + (p.list ? p.list.raw : '') + (p.heading ? '#'.repeat(p.heading) + ' ' : '') + p.rest;
}

function replaceLines(view, edit) {
  const { state } = view;
  const changes = [];
  const seen = new Set();
  for (const range of state.selection.ranges) {
    const lines = selectedLines(state, range).filter((l) => !seen.has(l.number));
    lines.forEach((l) => seen.add(l.number));
    edit(lines, (line, text) => {
      if (text === line.text) return;
      // Touch only the part that changed, so the cursor stays where it was.
      const old = line.text;
      const max = Math.min(old.length, text.length);
      let pre = 0;
      while (pre < max && old[pre] === text[pre]) pre++;
      let suf = 0;
      while (suf < max - pre && old[old.length - 1 - suf] === text[text.length - 1 - suf]) suf++;
      changes.push({ from: line.from + pre, to: line.to - suf, insert: text.slice(pre, text.length - suf) });
    });
  }
  if (changes.length) {
    const cs = state.changes(changes);
    view.dispatch({ changes, selection: state.selection.map(cs, 1), scrollIntoView: true });
  }
  view.focus();
}

// ---------- inline: bold, italic, strike, code ----------

export function toggleInline(view, mark) {
  const { state } = view;
  const m = mark.length;
  const tr = state.changeByRange((range) => {
    const doc = state.doc;

    // Segments: each selected line's trimmed, non-empty text.
    const segs = [];
    if (!range.empty) {
      for (const line of selectedLines(state, range)) {
        const from = Math.max(line.from, range.from);
        const to = Math.min(line.to, range.to);
        const t = doc.sliceString(from, to);
        const lead = t.length - t.trimStart().length;
        const trimmed = t.trim();
        if (trimmed) segs.push({ from: from + lead, to: from + lead + trimmed.length });
      }
    }

    if (!segs.length) {
      const at = range.head;
      const before = doc.sliceString(Math.max(0, at - m), at);
      const after = doc.sliceString(at, Math.min(doc.length, at + m));
      if (before === mark && after === mark) {
        return { changes: [{ from: at - m, to: at + m }], range: EditorSelection.cursor(at - m) };
      }
      return { changes: [{ from: at, insert: mark + mark }], range: EditorSelection.cursor(at + m) };
    }

    const isInner = (s) => {
      const t = doc.sliceString(s.from, s.to);
      return t.length >= 2 * m && t.startsWith(mark) && t.endsWith(mark);
    };
    const isOuter = (s) =>
      s.from - m >= 0 &&
      doc.sliceString(s.from - m, s.from) === mark &&
      doc.sliceString(s.to, Math.min(doc.length, s.to + m)) === mark;

    const unwrap = segs.every((s) => isInner(s) || isOuter(s));
    const changes = [];
    for (const s of segs) {
      if (unwrap) {
        if (isInner(s)) {
          changes.push({ from: s.from, to: s.from + m }, { from: s.to - m, to: s.to });
        } else {
          changes.push({ from: s.from - m, to: s.from }, { from: s.to, to: s.to + m });
        }
      } else if (!isInner(s)) {
        changes.push({ from: s.from, insert: mark }, { from: s.to, insert: mark });
      }
    }
    const cs = state.changes(changes);
    return {
      changes,
      range: EditorSelection.range(cs.mapPos(segs[0].from, 1), cs.mapPos(segs[segs.length - 1].to, -1)),
    };
  });
  view.dispatch(tr, { scrollIntoView: true });
  view.focus();
}

// ---------- block: headings, quote, lists ----------

export function setHeading(view, level) {
  replaceLines(view, (lines, set) => {
    const body = lines.filter((l) => l.text.trim());
    const allSame = level > 0 && body.length && body.every((l) => parse(l.text).heading === level);
    const target = allSame ? 0 : level;
    for (const l of body) {
      const p = parse(l.text);
      p.list = null;
      p.heading = target;
      set(l, build(p));
    }
  });
}

export function toggleQuote(view) {
  replaceLines(view, (lines, set) => {
    const hasQuote = (l) => /^\s{0,3}>/.test(l.text);
    const allQuoted = lines.every(hasQuote);
    for (const l of lines) {
      if (allQuoted) set(l, l.text.replace(/^(\s{0,3})>\s?/, '$1'));
      else if (!hasQuote(l)) set(l, l.text.trim() ? '> ' + l.text : lines.length === 1 ? '> ' : '>'); // don't nest a quoted line
    }
  });
}

export function setList(view, kind) {
  replaceLines(view, (lines, set) => {
    const body = lines.filter((l) => l.text.trim());
    const allSame = body.length && body.every((l) => parse(l.text).list?.kind === kind);
    let n = 1;
    for (const l of body) {
      const p = parse(l.text);
      p.heading = 0;
      if (allSame) p.list = null;
      else p.list = { kind, raw: kind === 'ordered' ? `${n++}. ` : kind === 'task' ? '- [ ] ' : '- ' };
      set(l, build(p));
    }
  });
}

// ---------- code block ----------

function enclosingFence(state, pos) {
  let node = syntaxTree(state).resolveInner(pos, -1);
  while (node && node.name !== 'FencedCode') node = node.parent;
  return node;
}

export function codeBlock(view) {
  const { state } = view;
  const doc = state.doc;
  const range = state.selection.main;

  // Inside an existing fenced block → unwrap it.
  const fence = enclosingFence(state, range.from);
  if (fence) {
    const first = doc.lineAt(fence.from);
    const last = doc.lineAt(fence.to);
    const changes = [{ from: first.from, to: Math.min(first.to + 1, doc.length) }];
    if (last.number !== first.number) {
      changes.push({ from: Math.max(last.from - 1, first.to + 1), to: last.to });
    }
    view.dispatch({ changes });
    view.focus();
    return;
  }

  const lines = selectedLines(state, range);
  const first = lines[0];
  const last = lines[lines.length - 1];
  const empty = lines.length === 1 && !first.text.trim();
  if (empty) {
    view.dispatch({
      changes: { from: first.from, to: first.to, insert: '```\n\n```' },
      selection: { anchor: first.from + 4 },
    });
  } else {
    view.dispatch({
      changes: [
        { from: first.from, insert: '```\n' },
        { from: last.to, insert: '\n```' },
      ],
      selection: { anchor: first.from + 4, head: last.to + 4 },
    });
  }
  view.focus();
}

// ---------- link, divider, table ----------

export function link(view) {
  const { state } = view;
  const range = state.selection.main;
  const text = state.doc.sliceString(range.from, range.to);
  const url = 'https://';
  let insert, selFrom, selTo;
  if (!text) {
    insert = `[link text](${url})`;
    selFrom = range.from + 1;
    selTo = selFrom + 'link text'.length;
  } else if (/^https?:\/\/\S+$/.test(text.trim())) {
    insert = `[](${text.trim()})`;
    selFrom = selTo = range.from + 1;
  } else {
    insert = `[${text}](${url})`;
    selFrom = range.from + text.length + 3;
    selTo = selFrom + url.length;
  }
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: { anchor: selFrom, head: selTo },
    scrollIntoView: true,
  });
  view.focus();
}

function insertBlock(view, block, cursorOffset, cursorLen = 0) {
  const { state } = view;
  const doc = state.doc;
  const line = doc.lineAt(state.selection.main.to);
  const lead = line.text.trim() ? '\n\n' : '\n';
  const trail = '\n';
  const at = line.to;
  const text = lead + block + trail;
  const start = at + lead.length + cursorOffset;
  view.dispatch({
    changes: { from: at, insert: text },
    selection: { anchor: start, head: start + cursorLen },
    scrollIntoView: true,
  });
  view.focus();
}

export function insertDivider(view) {
  insertBlock(view, '---\n', 4);
}

export function insertTable(view) {
  const block = '| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n';
  const line = view.state.doc.lineAt(view.state.selection.main.to);
  const start = line.to + (line.text.trim() ? 2 : 1); // where the table will begin (see insertBlock)
  insertBlock(view, block, 2, 'Column 1'.length);
  queueTableFocus(view, start);
}
