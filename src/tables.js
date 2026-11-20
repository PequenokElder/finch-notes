// Live, editable tables. A Markdown (GFM) table in the note is drawn as a real table; edits to its cells are
// written back into the Markdown text, so the file on disk stays plain Markdown.
import { StateField } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { syntaxTree, ensureSyntaxTree } from '@codemirror/language';
import { renderInline } from './render.js';

// ---------- Markdown <-> model ----------

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '|') { cur += '|'; i++; }
    else if (ch === '|') { cells.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

const fit = (cells, n) => Array.from({ length: n }, (_, i) => cells[i] ?? '');

export function parseTable(text) {
  const lines = text.split('\n');
  if (lines.length < 2) return null;
  const header = splitRow(lines[0]);
  const delim = splitRow(lines[1]);
  if (!delim.length || !delim.every((c) => /^:?-+:?$/.test(c))) return null;
  const n = header.length;
  const align = fit(delim, n).map((c) => {
    if (!c) return null;
    const l = c.startsWith(':'), r = c.endsWith(':');
    return l && r ? 'center' : r ? 'right' : l ? 'left' : null;
  });
  const rows = lines.slice(2).filter((l) => l.trim()).map((l) => fit(splitRow(l), n));
  return { header, align, rows };
}

const esc = (c) => c.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim();

export function serializeTable(m) {
  const n = m.header.length;
  const rows = [m.header, ...m.rows].map((r) => r.map(esc));
  const w = Array.from({ length: n }, (_, c) => Math.max(3, ...rows.map((r) => [...r[c]].length)));
  const fmt = (r) => '| ' + r.map((cell, c) => cell + ' '.repeat(w[c] - [...cell].length)).join(' | ') + ' |';
  const delim =
    '| ' +
    m.align
      .map((a, c) => {
        const d = '-'.repeat(w[c]);
        return a === 'center' ? ':' + d.slice(2) + ':' : a === 'left' ? ':' + d.slice(1) : a === 'right' ? d.slice(1) + ':' : d;
      })
      .join(' | ') +
    ' |';
  return [fmt(rows[0]), delim, ...rows.slice(1).map(fmt)].join('\n');
}

const cloneModel = (m) => ({ header: [...m.header], align: [...m.align], rows: m.rows.map((r) => [...r]) });
const blankRow = (n) => Array.from({ length: n }, () => '');

// ---------- locating a table in the document ----------

let tableFieldRef; // set below; lets helpers find the decorations

function tablePos(view, dom) {
  const p = view.posAtDOM(dom);
  let found = null;
  view.state.field(tableFieldRef).between(0, view.state.doc.length, (from, to) => {
    if (!found && p >= from && p <= to) found = { from, to };
  });
  return found;
}

// Edit the Markdown. `focus` says which cell to re-focus once the table has been redrawn.
function commit(view, dom, focus) {
  const st = dom.__tbl;
  const pos = tablePos(view, dom);
  if (!pos) return;
  const text = serializeTable(st.model);
  if (focus) view._tblPending = { pos: pos.from, ...focus };
  if (text !== view.state.sliceDoc(pos.from, pos.to)) {
    view.dispatch({ changes: { from: pos.from, to: pos.to, insert: text }, userEvent: 'input.table' });
  }
}

// Move the cursor out of the table into the note around it.
function exitTable(view, dom, after) {
  const pos = tablePos(view, dom);
  if (!pos) return;
  const doc = view.state.doc;
  let target;
  if (after) {
    if (pos.to >= doc.length) {
      view.dispatch({ changes: { from: doc.length, insert: '\n' } });
      target = view.state.doc.length;
    } else target = pos.to + 1;
  } else if (pos.from > 0) target = pos.from - 1;
  else {
    view.dispatch({ changes: { from: 0, insert: '\n' } });
    target = 0;
  }
  view.dispatch({ selection: { anchor: target }, scrollIntoView: true });
  view.focus();
}

function focusCell(dom, r, c, select) {
  const td = dom.querySelector(`[data-r="${r}"][data-c="${c}"]`);
  if (!td) return;
  td.classList.add('editing');
  if (dom.__tbl) { dom.__tbl.active = { r, c }; updateBar(dom); } // don't rely on focus events alone
  const ta = td.querySelector('textarea');
  ta.focus();
  if (select) ta.select();
  else ta.setSelectionRange(ta.value.length, ta.value.length);
}

// Tell the editor to focus a cell of the table that is about to appear at `pos`.
export function queueTableFocus(view, pos, r = 0, c = 0) {
  view._tblPending = { pos, r, c, select: true };
}

// ---------- the widget ----------

const BAR = [
  ['rowAbove', '+Row ↑', 'Add row above'],
  ['rowBelow', '+Row ↓', 'Add row below'],
  ['delRow', '−Row', 'Delete this row'],
  '|',
  ['colLeft', '+Col ←', 'Add column to the left'],
  ['colRight', '+Col →', 'Add column to the right'],
  ['delCol', '−Col', 'Delete this column'],
  '|',
  ['alignLeft', 'Left', 'Align column left'],
  ['alignCenter', 'Center', 'Center column'],
  ['alignRight', 'Right', 'Align column right'],
  '|',
  ['delTable', 'Delete table', 'Delete the whole table'],
];

class TableWidget extends WidgetType {
  constructor(model) {
    super();
    this.model = model;
    this.key = serializeTable(model);
  }
  eq(other) {
    return other.key === this.key;
  }
  // Reuse the existing DOM when it already shows exactly this table, e.g. after the user typed in a cell.
  updateDOM(dom) {
    const st = dom.__tbl;
    if (!st) return false;
    // Only text inside cells may differ; if rows, columns or alignment changed, the DOM must be rebuilt.
    const m = st.model;
    const same =
      st.built.rows === m.rows.length &&
      st.built.cols === m.header.length &&
      st.built.align.every((a, i) => a === m.align[i]);
    return same && serializeTable(m) === this.key;
  }
  get estimatedHeight() {
    return 52 + (this.model.rows.length + 1) * 36;
  }
  ignoreEvent() {
    return true; // the cells handle their own mouse and keyboard events
  }
  toDOM(view) {
    const dom = document.createElement('div');
    dom.className = 'cm-tbl-wrap';
    dom.__tbl = { model: cloneModel(this.model), active: { r: 0, c: 0 } };
    build(view, dom);
    requestAnimationFrame(() => {
      const p = view._tblPending;
      if (!p || !dom.isConnected) return;
      const pos = tablePos(view, dom);
      if (pos && Math.abs(pos.from - p.pos) <= 1) {
        view._tblPending = null;
        focusCell(dom, p.r, p.c, p.select);
      }
    });
    return dom;
  }
}

function build(view, dom) {
  const st = dom.__tbl;
  const m = st.model;
  st.built = { rows: m.rows.length, cols: m.header.length, align: [...m.align] }; // what this DOM shows
  dom.textContent = '';

  // toolbar (appears when you hover or edit the table)
  const bar = document.createElement('div');
  bar.className = 'cm-tbl-bar';
  for (const item of BAR) {
    if (item === '|') {
      const s = document.createElement('span');
      s.className = 'sep';
      bar.appendChild(s);
      continue;
    }
    const b = document.createElement('button');
    b.textContent = item[1];
    b.title = item[2];
    b.dataset.act = item[0];
    bar.appendChild(b);
  }
  // mousedown preventDefault keeps focus (and so the active cell) where it is
  bar.addEventListener('mousedown', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    e.preventDefault();
    barAction(view, dom, btn.dataset.act);
  });
  dom.appendChild(bar);

  const scroll = document.createElement('div');
  scroll.className = 'cm-tbl-scroll';
  const table = document.createElement('table');
  table.className = 'cm-tbl';
  const thead = table.createTHead().insertRow();
  m.header.forEach((v, c) => thead.appendChild(makeCell(view, dom, 0, c, 'th')));
  const tbody = table.createTBody();
  m.rows.forEach((row, i) => {
    const tr = tbody.insertRow();
    row.forEach((v, c) => tr.appendChild(makeCell(view, dom, i + 1, c, 'td')));
  });
  scroll.appendChild(table);
  dom.appendChild(scroll);
  updateBar(dom);
}

const getVal = (m, r, c) => (r === 0 ? m.header[c] : m.rows[r - 1][c]);
const setVal = (m, r, c, v) => { if (r === 0) m.header[c] = v; else m.rows[r - 1][c] = v; };

function makeCell(view, dom, r, c, tag) {
  const st = dom.__tbl;
  const m = st.model;
  const cell = document.createElement(tag);
  cell.dataset.r = r;
  cell.dataset.c = c;
  if (m.align[c]) cell.style.textAlign = m.align[c];

  const shown = document.createElement('div');
  shown.className = 'cm-tbl-view';
  const paint = () => { shown.innerHTML = renderInline(getVal(m, r, c)) || '&nbsp;'; };
  paint();

  const ta = document.createElement('textarea');
  ta.className = 'cm-tbl-cell';
  ta.rows = 1;
  ta.spellcheck = true;
  ta.value = getVal(m, r, c);
  if (m.align[c]) ta.style.textAlign = m.align[c];

  shown.addEventListener('mousedown', (e) => {
    if (e.target.closest('a')) e.preventDefault();
    e.preventDefault();
    focusCell(dom, r, c, false);
  });
  ta.addEventListener('focus', () => {
    st.active = { r, c };
    cell.classList.add('editing');
    updateBar(dom);
  });
  ta.addEventListener('blur', () => {
    cell.classList.remove('editing');
    paint();
  });
  ta.addEventListener('input', () => {
    if (/\n/.test(ta.value)) ta.value = ta.value.replace(/\s*\n\s*/g, ' ');
    setVal(m, r, c, ta.value);
    commit(view, dom, null);
  });
  ta.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    const rows = m.rows.length;
    const cols = m.header.length;
    if (e.key === 'Tab') {
      e.preventDefault();
      let nr = r, nc = c + (e.shiftKey ? -1 : 1);
      if (nc >= cols) { nc = 0; nr++; }
      if (nc < 0) { nc = cols - 1; nr--; }
      if (nr < 0) return;
      if (nr > rows) {
        m.rows.push(blankRow(cols));
        commit(view, dom, { r: nr, c: 0, select: true });
      } else focusCell(dom, nr, nc, true);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) return;
      if (r + 1 <= rows) focusCell(dom, r + 1, c, true);
      else {
        m.rows.push(blankRow(cols));
        commit(view, dom, { r: r + 1, c, select: true });
      }
    } else if (e.key === 'ArrowDown' && ta.selectionStart === ta.value.length && !e.shiftKey) {
      e.preventDefault();
      if (r + 1 <= rows) focusCell(dom, r + 1, c, false);
      else exitTable(view, dom, true);
    } else if (e.key === 'ArrowUp' && ta.selectionEnd === 0 && !e.shiftKey) {
      e.preventDefault();
      if (r - 1 >= 0) focusCell(dom, r - 1, c, false);
      else exitTable(view, dom, false);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      exitTable(view, dom, true);
    }
  });

  cell.append(shown, ta);
  return cell;
}

function updateBar(dom) {
  const { model: m, active } = dom.__tbl;
  dom.querySelectorAll('.cm-tbl-bar [data-act^="align"]').forEach((b) => {
    const want = b.dataset.act === 'alignLeft' ? 'left' : b.dataset.act === 'alignCenter' ? 'center' : 'right';
    b.classList.toggle('on', m.align[active.c] === want);
  });
}

function barAction(view, dom, act) {
  const st = dom.__tbl;
  const m = st.model;
  const { r, c } = st.active;
  const cols = m.header.length;
  switch (act) {
    case 'rowAbove': {
      const at = Math.max(r - 1, 0);
      m.rows.splice(at, 0, blankRow(cols));
      return commit(view, dom, { r: at + 1, c, select: true });
    }
    case 'rowBelow': {
      m.rows.splice(r, 0, blankRow(cols));
      return commit(view, dom, { r: r + 1, c, select: true });
    }
    case 'delRow': {
      if (r === 0) return; // the header row stays
      m.rows.splice(r - 1, 1);
      return commit(view, dom, { r: Math.min(r, m.rows.length) || 0, c });
    }
    case 'colLeft':
    case 'colRight': {
      const at = act === 'colLeft' ? c : c + 1;
      m.header.splice(at, 0, `Column ${cols + 1}`);
      m.align.splice(at, 0, null);
      m.rows.forEach((row) => row.splice(at, 0, ''));
      return commit(view, dom, { r: 0, c: at, select: true });
    }
    case 'delCol': {
      if (cols <= 1) return;
      m.header.splice(c, 1);
      m.align.splice(c, 1);
      m.rows.forEach((row) => row.splice(c, 1));
      return commit(view, dom, { r, c: Math.min(c, cols - 2) });
    }
    case 'alignLeft':
    case 'alignCenter':
    case 'alignRight': {
      const want = act === 'alignLeft' ? 'left' : act === 'alignCenter' ? 'center' : 'right';
      m.align[c] = m.align[c] === want ? null : want;
      return commit(view, dom, { r, c });
    }
    case 'delTable': {
      const pos = tablePos(view, dom);
      if (!pos) return;
      const to = Math.min(pos.to + 1, view.state.doc.length);
      view.dispatch({ changes: { from: pos.from, to }, selection: { anchor: pos.from }, userEvent: 'delete.table' });
      return view.focus();
    }
  }
}

// ⌘B, ⌘I, … while a cell is being edited: apply to the cell's text (the menu would otherwise act on the note).
export function tableCellFormat(action) {
  const ta = document.activeElement;
  if (!ta || !ta.classList || !ta.classList.contains('cm-tbl-cell')) return false;
  const marks = { 'format:bold': '**', 'format:italic': '_', 'format:strike': '~~', 'format:code': '`' };
  const done = () => ta.dispatchEvent(new Event('input', { bubbles: true }));
  if (marks[action]) {
    const m = marks[action];
    const a = ta.selectionStart, b = ta.selectionEnd;
    const t = ta.value;
    if (a !== b && t.slice(a, b).startsWith(m) && t.slice(a, b).endsWith(m) && b - a >= 2 * m.length) {
      ta.setRangeText(t.slice(a + m.length, b - m.length), a, b, 'select');
    } else if (t.slice(a - m.length, a) === m && t.slice(b, b + m.length) === m && a >= m.length) {
      ta.setRangeText(t.slice(a, b), a - m.length, b + m.length, 'select');
    } else {
      ta.setRangeText(m + t.slice(a, b) + m, a, b, 'preserve');
      ta.setSelectionRange(a + m.length, b + m.length);
    }
    done();
  } else if (action === 'format:link') {
    const a = ta.selectionStart, b = ta.selectionEnd;
    const sel = ta.value.slice(a, b) || 'link text';
    ta.setRangeText(`[${sel}](https://)`, a, b, 'end');
    done();
  }
  return true; // other formatting doesn't apply inside a cell
}

// ---------- the editor extension ----------

function buildTables(state) {
  const tree = ensureSyntaxTree(state, state.doc.length, 40) || syntaxTree(state);
  const out = [];
  tree.iterate({
    enter(node) {
      if (node.name !== 'Table') return;
      if (node.node.parent && node.node.parent.name !== 'Document') return false; // only top-level tables
      const from = state.doc.lineAt(node.from).from;
      const to = state.doc.lineAt(node.to).to;
      const model = parseTable(state.sliceDoc(from, to));
      if (model) out.push(Decoration.replace({ widget: new TableWidget(model), block: true }).range(from, to));
      return false;
    },
  });
  return Decoration.set(out);
}

export const tableField = StateField.define({
  create: buildTables,
  update(value, tr) {
    return tr.docChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state) ? buildTables(tr.state) : value;
  },
  provide: (f) => [EditorView.decorations.from(f), EditorView.atomicRanges.of((view) => view.state.field(f))],
});
tableFieldRef = tableField;
