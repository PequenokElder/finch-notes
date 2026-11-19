import { undo, redo } from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';
import { createEditor, loadText, insertImageMarkdown } from './editor.js';
import { setImageBase } from './images.js';
import { renderMarkdown, buildPdfHtml, DOC_CSS } from './render.js';
import * as fmt from './format.js';

const $ = (sel) => document.querySelector(sel);
const api = window.finch;

// ---------- icons ----------

const I = {
  bold: '<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/>',
  italic: '<line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/>',
  strike: '<path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" x2="20" y1="12" y2="12"/>',
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  quote: '<path d="M4 5v14"/><path d="M9 8h11"/><path d="M9 12h11"/><path d="M9 16h7"/>',
  ul: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  ol: '<path d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
  task: '<path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  codeblock: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m10 9-3 3 3 3M14 9l3 3-3 3"/>',
  hr: '<path d="M4 12h16"/><path d="M8 6h.01M12 6h.01M16 6h.01M8 18h.01M12 18h.01M16 18h.01"/>',
  table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  export: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  sidebar: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${I[name]}</svg>`;

// ---------- formatting actions (shared by toolbar, floating bar and the native menu) ----------

let view;
const actions = {
  'format:bold': () => fmt.toggleInline(view, '**'),
  'format:italic': () => fmt.toggleInline(view, '_'),
  'format:strike': () => fmt.toggleInline(view, '~~'),
  'format:code': () => fmt.toggleInline(view, '`'),
  'format:link': () => fmt.link(view),
  'format:h1': () => fmt.setHeading(view, 1),
  'format:h2': () => fmt.setHeading(view, 2),
  'format:h3': () => fmt.setHeading(view, 3),
  'format:p': () => fmt.setHeading(view, 0),
  'format:quote': () => fmt.toggleQuote(view),
  'format:ul': () => fmt.setList(view, 'bullet'),
  'format:ol': () => fmt.setList(view, 'ordered'),
  'format:task': () => fmt.setList(view, 'task'),
  'format:codeblock': () => fmt.codeBlock(view),
  'format:hr': () => fmt.insertDivider(view),
  'format:table': () => fmt.insertTable(view),
  'format:image': async () => {
    const rels = await api.pickImage();
    if (rels.length) insertImageMarkdown(view, rels);
  },
};

// [action, label (text) or icon name, tooltip]
const TOOLBAR = [
  ['format:h1', 'H1', 'Heading 1 (⌘1)'],
  ['format:h2', 'H2', 'Heading 2 (⌘2)'],
  ['format:h3', 'H3', 'Heading 3 (⌘3)'],
  '|',
  ['format:bold', { icon: 'bold' }, 'Bold (⌘B)'],
  ['format:italic', { icon: 'italic' }, 'Italic (⌘I)'],
  ['format:strike', { icon: 'strike' }, 'Strikethrough (⇧⌘X)'],
  ['format:code', { icon: 'code' }, 'Inline code (⌘E)'],
  ['format:link', { icon: 'link' }, 'Link (⌘K)'],
  '|',
  ['format:quote', { icon: 'quote' }, 'Block quote (⇧⌘.)'],
  ['format:codeblock', { icon: 'codeblock' }, 'Code block (⌥⌘C)'],
  '|',
  ['format:ul', { icon: 'ul' }, 'Bulleted list (⇧⌘8)'],
  ['format:ol', { icon: 'ol' }, 'Numbered list (⇧⌘7)'],
  ['format:task', { icon: 'task' }, 'Checklist (⇧⌘T)'],
  '|',
  ['format:hr', { icon: 'hr' }, 'Divider (⇧⌘H)'],
  ['format:table', { icon: 'table' }, 'Table (⌥⌘T)'],
  ['format:image', { icon: 'image' }, 'Insert image (⇧⌘M) — or paste or drag one in'],
];

// Compact set shown when you highlight text.
const FLOAT = [
  ['format:h1', 'H1', 'Heading 1 (⌘1)'],
  ['format:h2', 'H2', 'Heading 2 (⌘2)'],
  ['format:h3', 'H3', 'Heading 3 (⌘3)'],
  '|',
  ['format:bold', { icon: 'bold' }, 'Bold (⌘B)'],
  ['format:italic', { icon: 'italic' }, 'Italic (⌘I)'],
  ['format:strike', { icon: 'strike' }, 'Strikethrough (⇧⌘X)'],
  ['format:code', { icon: 'code' }, 'Inline code (⌘E)'],
  ['format:link', { icon: 'link' }, 'Link (⌘K)'],
  '|',
  ['format:quote', { icon: 'quote' }, 'Block quote (⇧⌘.)'],
  ['format:ul', { icon: 'ul' }, 'Bulleted list (⇧⌘8)'],
  ['format:ol', { icon: 'ol' }, 'Numbered list (⇧⌘7)'],
  ['format:task', { icon: 'task' }, 'Checklist (⇧⌘T)'],
  ['format:codeblock', { icon: 'codeblock' }, 'Code block (⌥⌘C)'],
];

function buildBar(container, spec, btnClass, sepClass) {
  for (const entry of spec) {
    if (entry === '|') {
      const s = document.createElement('span');
      s.className = sepClass;
      container.appendChild(s);
      continue;
    }
    const [action, label, tip] = entry;
    const b = document.createElement('button');
    b.className = btnClass;
    b.title = tip;
    b.dataset.action = action;
    b.innerHTML = typeof label === 'string' ? label : icon(label.icon);
    container.appendChild(b);
  }
  // mousedown preventDefault keeps the editor's selection and focus intact.
  container.addEventListener('mousedown', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    e.preventDefault();
    actions[btn.dataset.action]?.();
  });
}

function buildToolbar() {
  const tb = $('#toolbar');
  const sb = document.createElement('button');
  sb.className = 'tb-btn';
  sb.title = 'Toggle sidebar (⌥⌘S)';
  sb.innerHTML = icon('sidebar');
  sb.addEventListener('click', toggleSidebar);
  tb.appendChild(sb);
  const sep = document.createElement('span');
  sep.className = 'tb-sep';
  tb.appendChild(sep);

  const group = document.createElement('div');
  group.style.cssText = 'display:flex;align-items:center;gap:1px;';
  buildBar(group, TOOLBAR, 'tb-btn', 'tb-sep');
  tb.appendChild(group);

  const spacer = document.createElement('div');
  spacer.className = 'tb-spacer';
  tb.appendChild(spacer);

  const mk = (id, ic, tip, handler) => {
    const b = document.createElement('button');
    b.className = 'tb-btn';
    b.id = id;
    b.title = tip;
    b.innerHTML = icon(ic);
    b.addEventListener('click', handler);
    tb.appendChild(b);
    return b;
  };
  mk('btn-pin', 'pin', 'Pin note (⇧⌘D)', togglePin);
  mk('btn-preview', 'eye', 'Preview (⇧⌘P)', cyclePreview);
  mk('btn-export', 'export', 'Export as PDF (⇧⌘E)', toggleExportPop);
  mk('btn-trash', 'trash', 'Move note to Trash (⇧⌘⌫)', deleteCurrent);
}

// ---------- floating selection toolbar ----------

const floatBar = $('#float-bar');
let mouseDown = false;

function positionFloatBar() {
  if (!view || !(view.hasFocus || window.__finchAssumeFocus) || mode === 'preview') return hideFloat();
  const sel = view.state.selection.main;
  if (sel.empty || mouseDown) return hideFloat();
  const start = view.coordsAtPos(sel.from);
  const end = view.coordsAtPos(sel.to);
  if (!start || !end) return hideFloat();

  floatBar.hidden = false;
  const w = floatBar.offsetWidth;
  const h = floatBar.offsetHeight;
  const editorRect = $('#editor-wrap').getBoundingClientRect();
  const sameLine = Math.abs(start.top - end.top) < 4;
  const centerX = sameLine ? (start.left + end.right) / 2 : start.left + 80;
  let left = Math.min(Math.max(centerX - w / 2, editorRect.left + 8), editorRect.right - w - 8);
  let top = start.top - h - 10;
  if (top < editorRect.top + 4) top = end.bottom + 10; // not enough room above → go below
  floatBar.style.left = left + 'px';
  floatBar.style.top = top + 'px';
}

function hideFloat() {
  floatBar.hidden = true;
}

// ---------- notes state ----------

let notes = [];
let currentId = null;
let saveTimer = null;
let dirty = false;
let activeTag = null;
let query = '';
let mode = 'edit'; // edit | split | preview

const relDate = (ms) => {
  const d = new Date(ms);
  const now = new Date();
  const days = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  if (days === 0) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (days === 1) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString([], { weekday: 'long' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
};

function renderSidebar() {
  updatePinButton();
  // tags (from all notes, not just the filtered list)
  const tagEl = $('#tags');
  tagEl.innerHTML = '';
  const counts = new Map();
  for (const n of notes) for (const t of n.tags) counts.set(t, (counts.get(t) || 0) + 1);
  for (const [t] of [...counts.entries()].sort()) {
    const b = document.createElement('button');
    b.className = 'tag-chip' + (activeTag === t ? ' active' : '');
    b.textContent = '#' + t;
    b.addEventListener('click', () => {
      activeTag = activeTag === t ? null : t;
      renderSidebar();
    });
    tagEl.appendChild(b);
  }

  const list = $('#note-list');
  list.innerHTML = '';
  const shown = activeTag ? notes.filter((n) => n.tags.includes(activeTag)) : notes;
  if (!shown.length) {
    list.innerHTML = `<li class="empty-list">${query ? 'No matching notes' : 'No notes yet'}</li>`;
    return;
  }
  const addLabel = (text) => {
    const li = document.createElement('li');
    li.className = 'list-label';
    li.textContent = text;
    list.appendChild(li);
  };
  const addItem = (n) => {
    const li = document.createElement('li');
    li.className = 'note-item' + (n.id === currentId ? ' active' : '') + (n.pinned ? ' pinned' : '');
    li.dataset.id = n.id;
    li.innerHTML = `<div class="note-title"></div><div class="note-meta"><span class="note-date"></span><span class="note-snippet"></span></div>`;
    li.querySelector('.note-title').textContent = n.title;
    li.querySelector('.note-date').textContent = relDate(n.mtime);
    li.querySelector('.note-snippet').textContent = n.snippet;
    if (n.pinned) li.insertAdjacentHTML('beforeend', `<span class="pin-mark">${icon('pin')}</span>`);
    li.addEventListener('click', () => openNote(n.id));
    list.appendChild(li);
  };
  const pinned = shown.filter((n) => n.pinned);
  const rest = shown.filter((n) => !n.pinned);
  if (pinned.length) {
    addLabel('Pinned');
    pinned.forEach(addItem);
    if (rest.length) addLabel('Notes');
  }
  rest.forEach(addItem);
}

function updatePinButton() {
  const n = notes.find((x) => x.id === currentId);
  const b = $('#btn-pin');
  if (!b) return;
  b.classList.toggle('on', !!n?.pinned);
  b.title = n?.pinned ? 'Unpin note (⇧⌘D)' : 'Pin note (⇧⌘D)';
}

async function togglePin() {
  const n = notes.find((x) => x.id === currentId);
  if (!n) return;
  await api.pin(currentId, !n.pinned);
  await refreshList();
}

const store = {
  get: (k) => { try { return localStorage.getItem('finch.' + k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem('finch.' + k, v); } catch {} },
};

async function refreshList() {
  notes = await api.list(query);
  renderSidebar();
}

// A note's id is its file name, which follows its title; pick up the new name when it changes.
function adoptId(from, to) {
  if (to && to !== from && currentId === from) {
    currentId = to;
    store.set('last', to);
  }
}

async function flush() {
  clearTimeout(saveTimer);
  if (dirty && currentId) {
    dirty = false;
    const id = currentId;
    adoptId(id, await api.write(id, view.state.doc.toString()));
  }
}

// Keep the file name in step with the title, but only after you pause: no churn while you type a title.
let renameTimer = null;
let renamePending = false;
async function renameNow() {
  clearTimeout(renameTimer);
  renamePending = false;
  if (!currentId) return;
  const id = currentId;
  const rid = await api.rename(id, view.state.doc.toString());
  adoptId(id, rid);
  if (rid !== id) refreshList();
}

async function openNote(id) {
  if (id === currentId) return;
  await leaveCurrent();
  const text = await api.read(id);
  currentId = id;
  store.set('last', id);
  loadText(view, text);
  renderPreview();
  updateStatus();
  renderSidebar();
  refreshList(); // also drops any abandoned blank note from the list
  view.focus();
  view.dispatch({ selection: { anchor: 0 } });
}

async function leaveCurrent() {
  if (!currentId) return;
  await flush();
  await renameNow();
  await api.discardIfEmpty(currentId); // abandoned blank notes disappear
  currentId = null;
}

// Every new note starts as a Heading 1; Shift+Enter then steps down to H2, H3 and body text.
const NEW_NOTE_TEXT = '# ';
const isBlankNote = (t) => /^\s*(#{1,6}\s*)?$/.test(t);

async function newNote() {
  // If the current note is still blank, just keep using it.
  if (currentId && isBlankNote(view.state.doc.toString())) {
    if (view.state.doc.length === 0) view.dispatch({ changes: { from: 0, insert: NEW_NOTE_TEXT } });
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    view.focus();
    return;
  }
  await leaveCurrent();
  query = '';
  $('#search').value = '';
  activeTag = null;
  const id = await api.create(NEW_NOTE_TEXT);
  currentId = id;
  store.set('last', id);
  loadText(view, NEW_NOTE_TEXT);
  view.dispatch({ selection: { anchor: NEW_NOTE_TEXT.length } }); // cursor ready to type the title
  await refreshList();
  renderPreview();
  updateStatus();
  view.focus();
}

async function deleteCurrent() {
  if (!currentId) return;
  await flush();
  const id = currentId;
  const ok = await api.trash(id);
  if (!ok) return;
  currentId = null;
  await refreshList();
  if (notes.length) await openNote(notes[0].id);
  else await newNote();
}

function scheduleSave() {
  dirty = true;
  setSaved(false);
  clearTimeout(saveTimer);
  clearTimeout(renameTimer);
  renamePending = true;
  saveTimer = setTimeout(async () => {
    await flush();
    setSaved(true);
    refreshList();
    renameTimer = setTimeout(renameNow, 2500);
  }, 500);
}

function setSaved(saved) {
  $('#stat-saved').textContent = saved ? 'Saved' : 'Editing…';
}

function updateStatus() {
  const text = view.state.doc.toString();
  const words = (text.match(/\S+/g) || []).length;
  const mins = Math.max(1, Math.round(words / 220));
  $('#stat-words').textContent = `${words} word${words === 1 ? '' : 's'} · ${text.length} characters${words > 150 ? ` · ${mins} min read` : ''}`;
  setSaved(true);
}

// ---------- preview ----------

let previewTimer = null;
function renderPreview() {
  if (mode === 'edit') return;
  $('#preview').innerHTML = renderMarkdown(view.state.doc.toString());
}
function schedulePreview() {
  if (mode === 'edit') return;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 120);
}

function setMode(next) {
  mode = next;
  store.set('mode', next);
  const app = $('#app');
  app.classList.toggle('mode-preview', mode === 'preview');
  $('#preview-wrap').hidden = mode === 'edit';
  $('#btn-preview').classList.toggle('on', mode !== 'edit');
  $('#btn-preview').title =
    mode === 'edit' ? 'Show preview (⇧⌘P)' : mode === 'split' ? 'Preview only (⇧⌘P)' : 'Back to editing (⇧⌘P)';
  renderPreview();
  hideFloat();
  if (mode !== 'preview') view.focus();
}
function cyclePreview() {
  setMode(mode === 'edit' ? 'split' : mode === 'split' ? 'preview' : 'edit');
}

function toggleSidebar() {
  $('#app').classList.toggle('sidebar-hidden');
  store.set('sidebarHidden', $('#app').classList.contains('sidebar-hidden') ? '1' : '0');
}

// ---------- PDF export ----------

const pop = $('#export-pop');
function loadExportPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem('finch.export') || '{}');
    if (p.size) $('#exp-size').value = p.size;
    if (typeof p.numbers === 'boolean') $('#exp-numbers').checked = p.numbers;
  } catch {}
}
function saveExportPrefs() {
  try {
    localStorage.setItem('finch.export', JSON.stringify({ size: $('#exp-size').value, numbers: $('#exp-numbers').checked }));
  } catch {}
}
function toggleExportPop() {
  pop.hidden = !pop.hidden;
}

async function doExport() {
  pop.hidden = true;
  saveExportPrefs();
  const text = view.state.doc.toString();
  const note = notes.find((n) => n.id === currentId);
  const title = note?.title || 'Note';
  const html = buildPdfHtml(text, { title, pageSize: $('#exp-size').value });
  try {
    const out = await api.exportPdf({ html, name: title, pageNumbers: $('#exp-numbers').checked });
    if (out) toast(`PDF saved`, [['Open', () => api.open(out)], ['Show in Finder', () => api.reveal(out)]]);
  } catch (err) {
    toast('Export failed: ' + (err?.message || err));
  }
}

let toastTimer;
function toast(msg, buttons = []) {
  const el = $('#toast');
  el.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = msg;
  el.appendChild(span);
  for (const [label, fn] of buttons) {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', () => {
      fn();
      el.hidden = true;
    });
    el.appendChild(b);
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 6000);
}

// ---------- themes & settings ----------

const THEMES = [
  { id: 'goldfinch', name: 'Goldfinch', tag: 'Warm cream and sunny gold. The classic.' },
  { id: 'nightingale', name: 'Nightingale', tag: 'Soft charcoal for late-night writing.' },
  { id: 'snowfinch', name: 'Snowfinch', tag: 'Crisp white, black text, bold blue. Maximum contrast.' },
  { id: 'blackbird', name: 'Blackbird', tag: 'True black with canary yellow. Loud and clear.' },
  { id: 'bluebird', name: 'Bluebird', tag: 'A cool, breezy morning sky.' },
  { id: 'meadowlark', name: 'Meadowlark', tag: 'Soft sage greens. Gentle, low-contrast.' },
  { id: 'cardinal', name: 'Cardinal', tag: 'Warm ember dark with a red crest.' },
  { id: 'swallow', name: 'Twilight Swallow', tag: 'Indigo dusk. Moody but easy on the eyes.' },
];

function applyTheme(id) {
  const root = document.documentElement;
  if (THEMES.some((t) => t.id === id)) root.dataset.theme = id;
  else delete root.dataset.theme; // "auto": Goldfinch by day, Nightingale by night
  store.set('theme', id || 'auto');
  document.querySelectorAll('.theme-card').forEach((c) => c.classList.toggle('selected', c.dataset.pick === (id || 'auto')));
}

function previewHtml() {
  return `<div class="tc-side"><div class="tc-bar h"></div><div class="tc-bar s"></div><div class="tc-bar s"></div></div>
    <div class="tc-main"><div class="tc-bar h"></div><div class="tc-bar"></div><div class="tc-bar s"></div><div class="tc-quote"></div></div>`;
}

async function openSettings() {
  const box = $('#settings');
  const current = store.get('theme') || 'auto';
  const info = await api.info();
  const cards = THEMES.map((t) => `
    <button class="theme-card" data-pick="${t.id}" data-theme="${t.id}">
      <div class="tc-preview">${previewHtml()}</div>
      <div class="tc-name">${t.name}</div><div class="tc-tag">${t.tag}</div>
    </button>`).join('');
  box.innerHTML = `
    <div class="panel" role="dialog" aria-label="Settings">
      <div class="set-head"><h2>Settings</h2><button class="btn" id="set-close">Done</button></div>
      <h3>Appearance</h3>
      <p class="sub">Pick a look. Changes apply instantly. PDFs always export in the clean paper style.</p>
      <div class="theme-grid">
        <button class="theme-card" data-pick="auto" data-theme="goldfinch">
          <div class="tc-preview tc-auto">
            <div data-theme="goldfinch" style="display:flex;background:var(--bg)">${previewHtml()}</div>
            <div data-theme="nightingale" style="display:flex;background:var(--bg)">${previewHtml()}</div>
          </div>
          <div class="tc-name">Auto</div><div class="tc-tag">Goldfinch by day, Nightingale by night, following your Mac.</div>
        </button>
        ${cards}
      </div>
      <h3>Writing</h3>
      <label class="pop-row check" style="margin:6px 0"><input type="checkbox" id="set-autoh"><span>Turn the line above a new list into a Heading 2</span></label>
      <p class="sub">Only short, standalone lines that don't end in a period. ⌘Z undoes it.</p>
      <h3>Notes folder</h3>
      <p class="sub">Where Finch keeps your notes as plain Markdown files.</p>
      <div class="folder-row"><div class="folder-path" title="${info.notesDir}">${info.notesDir}</div>
        <button class="btn" id="set-reveal">Show</button><button class="btn" id="set-folder">Change…</button></div>
    </div>`;
  box.hidden = false;
  box.querySelectorAll('.theme-card').forEach((c) => {
    c.classList.toggle('selected', c.dataset.pick === current);
    c.addEventListener('click', () => applyTheme(c.dataset.pick === 'auto' ? null : c.dataset.pick));
  });
  $('#set-autoh').checked = store.get('autoHeading') !== '0';
  $('#set-autoh').addEventListener('change', (e) => store.set('autoHeading', e.target.checked ? '1' : '0'));
  $('#set-close').addEventListener('click', closeSettings);
  $('#set-reveal').addEventListener('click', () => api.reveal(info.notesDir));
  $('#set-folder').addEventListener('click', () => api.chooseFolder());
  box.addEventListener('mousedown', (e) => { if (e.target === box) closeSettings(); }, { once: true });
}
function closeSettings() {
  $('#settings').hidden = true;
  view?.focus();
}

// ---------- hover tooltips with keyboard shortcuts ----------
// Any element with a title like "Bold (⌘B)" gets a styled tooltip showing the shortcut as keycaps.

const tipEl = document.createElement('div');
tipEl.id = 'tip';
tipEl.hidden = true;
document.body.appendChild(tipEl);
let tipTimer = null;
let tipTarget = null;

function parseTip(text) {
  const m = text.match(/^(.*?)\s*\(([⌘⇧⌥⌃][^)]*)\)\s*(?:—\s*(.*))?$/);
  return m ? { name: m[1], keys: m[2], note: m[3] || '' } : { name: text, keys: '', note: '' };
}

function showTip(el) {
  const raw = el.dataset.tip;
  if (!raw) return;
  const { name, keys, note } = parseTip(raw);
  tipEl.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'tip-row';
  const label = document.createElement('span');
  label.className = 'tip-name';
  label.textContent = name;
  row.appendChild(label);
  if (keys) {
    const caps = document.createElement('span');
    caps.className = 'tip-keys';
    // Each modifier glyph is its own keycap; whatever follows is the key itself.
    const mods = [...keys].filter((c, i) => i < keys.length && '⌘⇧⌥⌃'.includes(c) && [...keys].slice(0, i).every((p) => '⌘⇧⌥⌃'.includes(p)));
    const rest = [...keys].slice(mods.length).join('');
    for (const k of [...mods, rest].filter(Boolean)) {
      const kbd = document.createElement('kbd');
      kbd.textContent = k;
      caps.appendChild(kbd);
    }
    row.appendChild(caps);
  }
  tipEl.appendChild(row);
  if (note) {
    const n = document.createElement('div');
    n.className = 'tip-note';
    n.textContent = note;
    tipEl.appendChild(n);
  }
  tipEl.hidden = false;
  const r = el.getBoundingClientRect();
  const w = tipEl.offsetWidth;
  const h = tipEl.offsetHeight;
  let left = Math.min(Math.max(r.left + r.width / 2 - w / 2, 8), window.innerWidth - w - 8);
  const above = el.closest('#float-bar') || r.bottom + h + 12 > window.innerHeight;
  const top = above ? r.top - h - 8 : r.bottom + 8;
  tipEl.style.left = left + 'px';
  tipEl.style.top = Math.max(4, top) + 'px';
}

function hideTip() {
  clearTimeout(tipTimer);
  tipTarget = null;
  tipEl.hidden = true;
}

function setupTooltips() {
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[title], [data-tip]');
    if (!el || el === tipTarget || el.closest('#tip')) return;
    // Take over the native tooltip: move title -> data-tip so the browser's own doesn't also appear.
    if (el.hasAttribute('title')) {
      el.dataset.tip = el.getAttribute('title');
      el.removeAttribute('title');
    }
    if (!el.dataset.tip) return;
    hideTip();
    tipTarget = el;
    tipTimer = setTimeout(() => showTip(el), 350);
  });
  document.addEventListener('mouseout', (e) => {
    if (tipTarget && !tipTarget.contains(e.relatedTarget)) hideTip();
  });
  for (const ev of ['mousedown', 'keydown', 'wheel', 'scroll']) document.addEventListener(ev, hideTip, true);
}

// ---------- zoom ----------

const ZOOM_MIN = 0.7, ZOOM_MAX = 2.0;
let zoom = 1;
function setZoom(z) {
  zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));
  document.documentElement.style.setProperty('--zoom', zoom);
  $('#zoom-val').textContent = Math.round(zoom * 100) + '%';
  try { localStorage.setItem('finch.zoom', String(zoom)); } catch {}
  view?.requestMeasure();
  positionFloatBar();
}
const zoomBy = (d) => setZoom(zoom + d);

// ---------- menu bridge ----------

function handleMenu(action) {
  if (actions[action]) return actions[action]();
  switch (action) {
    case 'new': return newNote();
    case 'delete': return deleteCurrent();
    case 'pin': return togglePin();
    case 'export': return toggleExportPop();
    case 'preview': return cyclePreview();
    case 'sidebar': return toggleSidebar();
    case 'settings': return openSettings();
    case 'zoom-in': return zoomBy(0.1);
    case 'zoom-out': return zoomBy(-0.1);
    case 'zoom-reset': return setZoom(1);
    case 'undo': if (mode !== 'preview') undo(view); return;
    case 'redo': if (mode !== 'preview') redo(view); return;
    case 'find': if (mode !== 'preview') { view.focus(); openSearchPanel(view); } return;
    case 'search-notes':
      $('#app').classList.remove('sidebar-hidden');
      $('#search').focus();
      $('#search').select();
      return;
  }
}

// ---------- boot ----------

async function boot() {
  // The document look (shared with the PDF) styles the live preview pane.
  const docStyle = document.createElement('style');
  docStyle.textContent = DOC_CSS;
  document.head.appendChild(docStyle);

  buildToolbar();
  setupTooltips();
  buildBar(floatBar, FLOAT, 'fb-btn', 'fb-sep');
  $('#new-note').innerHTML = icon('plus');
  $('#open-settings').innerHTML = icon('gear') + '<span>Settings</span>';
  $('#open-settings').addEventListener('click', openSettings);
  const savedTheme = store.get('theme');
  if (savedTheme && savedTheme !== 'auto') applyTheme(savedTheme);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#settings').hidden) closeSettings(); });
  loadExportPrefs();
  try { setZoom(parseFloat(localStorage.getItem('finch.zoom')) || 1); } catch { setZoom(1); }
  $('#zoom-in').addEventListener('click', () => zoomBy(0.1));
  $('#zoom-out').addEventListener('click', () => zoomBy(-0.1));
  $('#zoom-val').addEventListener('click', () => setZoom(1));
  // Pinch (trackpad) or ⌘/Ctrl + scroll zooms the text.
  $('#panes').addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 0.05 : -0.05);
  }, { passive: false });

  view = createEditor($('#editor'), {
    onChange: () => {
      scheduleSave();
      schedulePreview();
      updateStatusSoon();
    },
    autoHeadingEnabled: () => store.get('autoHeading') !== '0',
    onImageFiles: async (files) => {
      const rels = [];
      for (const f of files) {
        const ext = f.type.split('/')[1].replace('jpeg', 'jpg').replace(/\+.*/, '');
        rels.push(await api.saveImage(new Uint8Array(await f.arrayBuffer()), ext));
      }
      return rels;
    },
    onSelection: () => requestAnimationFrame(positionFloatBar),
    onFocusChange: (v) => {
      if (!v.hasFocus) setTimeout(() => !view.hasFocus && hideFloat(), 120);
      else positionFloatBar();
    },
  });

  window.__finchView = view; // handy for debugging from DevTools
  window.__finchActions = actions;
  window.__finchApplyTheme = applyTheme;
  window.__finchState = () => ({ id: currentId, dirty, doc: view.state.doc.toString().slice(0, 40) });
  window.__finchOpenSettings = openSettings;

  let statusTimer;
  function updateStatusSoon() {
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      const text = view.state.doc.toString();
      const words = (text.match(/\S+/g) || []).length;
      const mins = Math.max(1, Math.round(words / 220));
      $('#stat-words').textContent = `${words} word${words === 1 ? '' : 's'} · ${text.length} characters${words > 150 ? ` · ${mins} min read` : ''}`;
    }, 150);
  }

  view.scrollDOM.addEventListener('scroll', () => positionFloatBar());
  window.addEventListener('resize', () => positionFloatBar());
  view.dom.addEventListener('mousedown', () => {
    mouseDown = true;
    hideFloat();
  });
  window.addEventListener('mouseup', () => {
    if (mouseDown) {
      mouseDown = false;
      requestAnimationFrame(positionFloatBar);
    }
  });
  // Cmd/Ctrl-click a link in the editor opens it.
  view.dom.addEventListener('click', (e) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    if (pos == null) return;
    const line = view.state.doc.lineAt(pos);
    const re = /\[[^\]]*\]\(([^)\s]+)[^)]*\)|(https?:\/\/[^\s)]+)/g;
    let m;
    while ((m = re.exec(line.text))) {
      const s = line.from + m.index;
      if (pos >= s && pos <= s + m[0].length) {
        api.open(m[1] || m[2]);
        break;
      }
    }
  });

  document.addEventListener('mousedown', (e) => {
    if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('#btn-export')) pop.hidden = true;
  });
  $('#exp-go').addEventListener('click', doExport);
  $('#new-note').addEventListener('click', newNote);

  let searchTimer;
  $('#search').addEventListener('input', (e) => {
    query = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(refreshList, 120);
  });
  $('#search').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.target.value = '';
      query = '';
      refreshList();
      view.focus();
    } else if (e.key === 'Enter' && notes[0]) {
      openNote(notes[0].id);
    }
  });

  api.onMenu(handleMenu);
  window.addEventListener('beforeunload', () => {
    // Quitting: save, and finish any rename that was waiting for you to pause.
    if (dirty && currentId) api.writeSync(currentId, view.state.doc.toString());
    else if (renamePending && currentId) api.renameSync(currentId, view.state.doc.toString());
  });
  window.addEventListener('blur', () => flush());

  setImageBase((await api.info()).notesDir);
  if (store.get('sidebarHidden') === '1') $('#app').classList.add('sidebar-hidden');
  const savedMode = store.get('mode');
  if (savedMode === 'split' || savedMode === 'preview') setMode(savedMode);

  await refreshList();
  const last = store.get('last');
  if (last && notes.some((n) => n.id === last)) await openNote(last);
  else if (notes.length) await openNote(notes[0].id);
  else await newNote();
}

boot();
