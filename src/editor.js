import { EditorState, Prec } from '@codemirror/state';
import {
  EditorView,
  ViewPlugin,
  Decoration,
  WidgetType,
  keymap,
  drawSelection,
  dropCursor,
  placeholder,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  syntaxTree,
  syntaxHighlighting,
  HighlightStyle,
  LanguageDescription,
  indentOnInput,
} from '@codemirror/language';
import { markdown, markdownLanguage, insertNewlineContinueMarkup } from '@codemirror/lang-markdown';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { tags as t } from '@lezer/highlight';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { json } from '@codemirror/lang-json';
import { resolveImageSrc } from './images.js';
import * as fmt from './format.js';

// ---------- code-fence languages ----------

const codeLanguages = [
  LanguageDescription.of({ name: 'javascript', alias: ['js', 'jsx', 'mjs', 'node'], support: javascript() }),
  LanguageDescription.of({ name: 'typescript', alias: ['ts', 'tsx'], support: javascript({ typescript: true, jsx: true }) }),
  LanguageDescription.of({ name: 'python', alias: ['py'], support: python() }),
  LanguageDescription.of({ name: 'css', alias: [], support: css() }),
  LanguageDescription.of({ name: 'html', alias: ['xml', 'svg'], support: html() }),
  LanguageDescription.of({ name: 'json', alias: [], support: json() }),
];

// ---------- syntax colours (themed through CSS variables in app.css) ----------

const highlightStyle = HighlightStyle.define([
  { tag: t.strong, fontWeight: '650' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--text-muted)' },
  { tag: t.link, color: 'var(--accent-ink)', textDecoration: 'underline', textUnderlineOffset: '2px' },
  { tag: t.url, color: 'var(--text-faint)' },
  { tag: t.processingInstruction, color: 'var(--mark)' },
  { tag: t.monospace, fontFamily: 'var(--mono)' },
  { tag: t.quote, color: 'var(--text-muted)' },
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: 'var(--c-keyword)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--c-string)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--c-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--text-faint)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName], color: 'var(--c-fn)' },
  { tag: [t.typeName, t.className, t.tagName], color: 'var(--c-type)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--c-prop)' },
]);

// ---------- widgets ----------

class BulletWidget extends WidgetType {
  constructor(width, text) {
    super();
    this.width = width;
    this.text = text;
  }
  eq(o) {
    return o.width === this.width && o.text === this.text;
  }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-li-mark';
    el.style.width = this.width + 'em';
    const inner = document.createElement('span');
    inner.textContent = this.text;
    el.appendChild(inner);
    return el;
  }
}

class CheckWidget extends WidgetType {
  constructor(width, checked, pos) {
    super();
    this.width = width;
    this.checked = checked;
    this.pos = pos; // doc position of the character inside [ ]
  }
  eq(o) {
    return o.width === this.width && o.checked === this.checked && o.pos === this.pos;
  }
  toDOM(view) {
    const el = document.createElement('span');
    el.className = 'cm-li-mark';
    el.style.width = this.width + 'em';
    const box = document.createElement('span');
    box.className = 'cm-checkbox' + (this.checked ? ' checked' : '');
    box.addEventListener('mousedown', (e) => {
      e.preventDefault();
      view.dispatch({ changes: { from: this.pos, to: this.pos + 1, insert: this.checked ? ' ' : 'x' } });
    });
    el.appendChild(box);
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

class ImageWidget extends WidgetType {
  constructor(src, alt) {
    super();
    this.src = src;
    this.alt = alt;
  }
  eq(o) {
    return o.src === this.src && o.alt === this.alt;
  }
  toDOM(view) {
    const img = document.createElement('img');
    img.className = 'cm-image';
    img.src = resolveImageSrc(this.src);
    img.alt = this.alt;
    img.draggable = false;
    img.addEventListener('load', () => view.requestMeasure());
    return img;
  }
}

class RuleWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-hr-rule';
    return el;
  }
}

const hide = Decoration.replace({});

// ---------- live styling ----------

function buildDecorations(view) {
  const { state } = view;
  const doc = state.doc;
  const out = [];
  const atomic = [];

  const active = new Set();
  for (const r of state.selection.ranges) {
    const a = doc.lineAt(r.from).number;
    const b = doc.lineAt(r.to).number;
    for (let n = a; n <= b; n++) active.add(n);
  }
  const isActive = (pos) => active.has(doc.lineAt(pos).number);

  const lineDeco = (pos, cls, style) => {
    const attrs = { class: cls };
    if (style) attrs.style = style;
    out.push(Decoration.line({ attributes: attrs }).range(doc.lineAt(pos).from));
  };
  const addHide = (from, to) => {
    if (to > from) {
      const r = hide.range(from, to);
      out.push(r);
      atomic.push(r);
    }
  };
  const addReplace = (from, to, widget) => {
    if (to > from) {
      const r = Decoration.replace({ widget }).range(from, to);
      out.push(r);
      atomic.push(r);
    }
  };

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name;
        let m;
        if ((m = /^ATXHeading([1-6])$/.exec(name))) {
          lineDeco(node.from, `cm-h cm-h${m[1]}`);
        } else if ((m = /^SetextHeading([12])$/.exec(name))) {
          const l1 = doc.lineAt(node.from).number;
          const l2 = doc.lineAt(node.to).number;
          // A lone "-" under a line is just someone starting a bullet list; don't flash a heading.
          if (doc.line(l2).text.trim().length < 3) return;
          for (let n = l1; n <= l2; n++) lineDeco(doc.line(n).from, `cm-h cm-h${m[1]}`);
        } else if (name === 'HeaderMark' && node.node.parent?.name.startsWith('ATX')) {
          if (!isActive(node.from)) {
            const next = doc.sliceString(node.to, node.to + 1);
            addHide(node.from, next === ' ' ? node.to + 1 : node.to);
          }
        } else if (name === 'Blockquote') {
          const l1 = doc.lineAt(node.from).number;
          const l2 = doc.lineAt(node.to).number;
          for (let n = l1; n <= l2; n++) {
            const cls = ['cm-quote'];
            if (n === l1) cls.push('cm-quote-first');
            if (n === l2) cls.push('cm-quote-last');
            lineDeco(doc.line(n).from, cls.join(' '));
          }
        } else if (name === 'QuoteMark') {
          if (!isActive(node.from)) {
            const next = doc.sliceString(node.to, node.to + 1);
            addHide(node.from, next === ' ' ? node.to + 1 : node.to);
          }
        } else if (name === 'FencedCode' || name === 'CodeBlock') {
          const l1 = doc.lineAt(node.from).number;
          const l2 = doc.lineAt(node.to).number;
          for (let n = l1; n <= l2; n++) {
            const cls = ['cm-code'];
            if (n === l1) cls.push('cm-code-first');
            if (n === l2) cls.push('cm-code-last');
            if (name === 'FencedCode' && (n === l1 || (n === l2 && /^\s*(```|~~~)/.test(doc.line(n).text)))) {
              cls.push('cm-code-fence');
            }
            lineDeco(doc.line(n).from, cls.join(' '));
          }
        } else if (name === 'Paragraph') {
          // #tags (Bear-style) get a soft highlight.
          const text = doc.sliceString(node.from, node.to);
          for (const tm of text.matchAll(/(^|\s)(#[\p{L}_][\p{L}\p{N}_\-/]*)/gu)) {
            const s = node.from + tm.index + tm[1].length;
            out.push(Decoration.mark({ class: 'cm-tag' }).range(s, s + tm[2].length));
          }
        } else if (name === 'InlineCode') {
          out.push(Decoration.mark({ class: 'cm-inline-code' }).range(node.from, node.to));
        } else if (name === 'CodeMark' && node.node.parent?.name === 'InlineCode') {
          if (!isActive(node.from)) addHide(node.from, node.to);
        } else if (name === 'EmphasisMark' || name === 'StrikethroughMark') {
          if (!isActive(node.from)) addHide(node.from, node.to);
        } else if (name === 'Link') {
          const marks = [];
          let hasUrl = false;
          for (let c = node.node.firstChild; c; c = c.nextSibling) {
            if (c.name === 'LinkMark') marks.push(c);
            if (c.name === 'URL') hasUrl = true;
          }
          if (hasUrl && marks.length >= 2) {
            if (marks[1].from > marks[0].to) {
              out.push(Decoration.mark({ class: 'cm-link-text' }).range(marks[0].to, marks[1].from));
            }
            if (!isActive(node.from)) {
              addHide(marks[0].from, marks[0].to);
              addHide(marks[1].from, node.to);
            }
          }
        } else if (name === 'Image') {
          // Show the picture itself when the cursor is elsewhere.
          if (isActive(node.from) || doc.lineAt(node.from).number !== doc.lineAt(node.to).number) return;
          let url = '';
          for (let c = node.node.firstChild; c; c = c.nextSibling) if (c.name === 'URL') url = doc.sliceString(c.from, c.to);
          if (!url) return;
          const alt = doc.sliceString(node.from, node.to).match(/^!\[([^\]]*)\]/)?.[1] || '';
          addReplace(node.from, node.to, new ImageWidget(url, alt));
          return false;
        } else if (name === 'HorizontalRule') {
          const line = doc.lineAt(node.from);
          lineDeco(line.from, 'cm-hr-line');
          if (!isActive(node.from)) addReplace(node.from, node.to, new RuleWidget());
        } else if (name === 'Table') {
          const l1 = doc.lineAt(node.from).number;
          const l2 = doc.lineAt(node.to).number;
          for (let n = l1; n <= l2; n++) lineDeco(doc.line(n).from, 'cm-table-row');
        } else if (name === 'ListMark') {
          const line = doc.lineAt(node.from);
          // A lone "-" or "1." (no space yet) is not finished: keep it visible as typed, so it doesn't
          // look like a bullet before the space and invite typing text straight after it.
          if (doc.sliceString(node.to, node.to + 1) !== ' ') return;
          // Markers always render as bullets/numbers/checkboxes, even on the line you're typing on,
          // so continuing a list feels seamless. (Backspace at the start removes the marker.)
          // Depth = number of enclosing list items.
          let depth = 0;
          for (let p = node.node.parent; p; p = p.parent) if (p.name === 'ListItem') depth++;
          const quotePrefix = line.text.match(/^(?:\s{0,3}>\s?)*/)[0].length;
          const start = line.from + quotePrefix;
          const parent = node.node.parent;
          const ordered = parent?.parent?.name === 'OrderedList';
          const task = node.node.nextSibling?.name === 'Task';
          const width = (depth - 1) * 1.55 + (ordered ? 2.1 : 1.45);
          const style = `--li:${width}em`;
          if (task) {
            const tm = node.node.nextSibling.firstChild;
            if (tm && tm.name === 'TaskMarker') {
              const checked = /\[[xX]\]/.test(doc.sliceString(tm.from, tm.to));
              const after = doc.sliceString(tm.to, tm.to + 1) === ' ' ? tm.to + 1 : tm.to;
              lineDeco(line.from, 'cm-li-line' + (checked ? ' cm-task-done' : ''), style);
              addReplace(start, after, new CheckWidget(width, checked, tm.from + 1));
              return;
            }
          }
          const after = doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to;
          lineDeco(line.from, 'cm-li-line', style);
          const label = ordered ? doc.sliceString(node.from, node.to) : depth % 2 === 1 ? '•' : '◦';
          addReplace(start, after, new BulletWidget(width, label));
        }
      },
    });
  }

  return { all: Decoration.set(out, true), atomic: Decoration.set(atomic, true) };
}

const liveStyle = ViewPlugin.fromClass(
  class {
    constructor(view) {
      const b = buildDecorations(view);
      this.decorations = b.all;
      this.atomic = b.atomic;
    }
    update(u) {
      if (
        u.docChanged ||
        u.viewportChanged ||
        u.selectionSet ||
        u.focusChanged ||
        syntaxTree(u.startState) !== syntaxTree(u.state)
      ) {
        const b = buildDecorations(u.view);
        this.decorations = b.all;
        this.atomic = b.atomic;
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic || Decoration.none),
  }
);

// ---------- editor factory ----------

// When you start a list (type "- " or "1. ") directly under a short, standalone, heading-like line,
// that line becomes a Heading 2. Applied as its own undo step, so ⌘Z reverts just the heading.
function looksLikeHeadingText(state, prev) {
  const t = prev.text;
  if (!t.trim() || /^\s/.test(t) || t.length > 70) return false;
  if (/^(#{1,6}\s|>|[-*+]\s|\d+[.)]\s|```|~~~|\||!\[|<)/.test(t)) return false; // already something else
  if (/[.!?;,)\]]\s*$/.test(t)) return false; // reads like a sentence, not a title
  if (prev.number > 1 && state.doc.line(prev.number - 1).text.trim() !== '') return false; // part of a bigger paragraph
  for (let n = syntaxTree(state).resolveInner(prev.from, 1); n; n = n.parent) {
    if (/^(FencedCode|CodeBlock|Table|HTMLBlock|Blockquote|ListItem)$/.test(n.name)) return false;
  }
  return true;
}

function autoHeadingAboveList(enabled) {
  return ViewPlugin.fromClass(
    class {
      update(u) {
        if (!u.docChanged || !enabled()) return;
        if (!u.transactions.some((t) => t.isUserEvent('input.type'))) return; // typed, not pasted or auto-continued
        const { state, view } = u;
        const sel = state.selection.main;
        if (!sel.empty) return;
        const line = state.doc.lineAt(sel.head);
        if (line.number < 2 || sel.head !== line.to || !/^(?:[-*+]|1[.)]) $/.test(line.text)) return;
        const prev = state.doc.line(line.number - 1);
        if (!looksLikeHeadingText(state, prev)) return;
        const doc = state.doc;
        Promise.resolve().then(() => {
          if (view.state.doc !== doc) return; // user kept typing; leave it
          view.dispatch({ changes: { from: prev.from, insert: '## ' }, userEvent: 'input.autoheading' });
        });
      }
    }
  );
}

// Shift+Enter on a heading "steps down": H1 → H2 → H3 → body text.
//  • Heading with text: starts a new line at the next level down (text after the cursor moves with it).
//  • Empty heading line (e.g. just "## "): steps that line down in place, so tapping it repeatedly cycles to body text.
// Anywhere else it behaves like Enter (continuing lists and quotes).
function stepDownHeading(view) {
  const { state } = view;
  const sel = state.selection.main;
  const line = state.doc.lineAt(sel.head);
  const m = line.text.match(/^(#{1,6})(\s+)(.*)$/);
  if (!m) return insertNewlineContinueMarkup(view);
  const level = m[1].length;
  const next = level >= 3 ? 0 : level + 1;
  const prefix = next ? '#'.repeat(next) + ' ' : '';
  const markEnd = line.from + level + m[2].length;
  if (m[3].trim() === '') {
    view.dispatch({ changes: { from: line.from, to: line.to, insert: prefix }, selection: { anchor: line.from + prefix.length } });
  } else {
    const from = Math.max(sel.from, markEnd);
    const to = Math.max(sel.to, markEnd);
    view.dispatch({
      changes: { from, to, insert: '\n' + prefix },
      selection: { anchor: from + 1 + prefix.length },
      scrollIntoView: true,
    });
  }
  return true;
}

// Formatting shortcuts are handled here, inside the editor, so nothing in the editor's own keymap can
// swallow them (CodeMirror claims ⌘I for "expand selection", for example). The native menu shows the same
// keys as hints, and still handles them when the editor isn't focused.
const cmd = (fn) => (v) => { fn(v); return true; };
const FORMAT_KEYS = [
  ['Mod-b', cmd((v) => fmt.toggleInline(v, '**'))],
  ['Mod-i', cmd((v) => fmt.toggleInline(v, '_'))],
  ['Mod-Shift-x', cmd((v) => fmt.toggleInline(v, '~~'))],
  ['Mod-e', cmd((v) => fmt.toggleInline(v, '`'))],
  ['Mod-k', cmd(fmt.link)],
  ['Mod-1', cmd((v) => fmt.setHeading(v, 1))],
  ['Mod-2', cmd((v) => fmt.setHeading(v, 2))],
  ['Mod-3', cmd((v) => fmt.setHeading(v, 3))],
  ['Mod-Alt-0', cmd((v) => fmt.setHeading(v, 0))],
  ['Mod-Shift-.', cmd(fmt.toggleQuote)], // ⇧⌘. — the ">" key
  ['Mod->', cmd(fmt.toggleQuote)],
  ['Mod-Alt-c', cmd(fmt.codeBlock)],
  ['Mod-Shift-8', cmd((v) => fmt.setList(v, 'bullet'))],
  ['Mod-Shift-7', cmd((v) => fmt.setList(v, 'ordered'))],
  ['Mod-Shift-t', cmd((v) => fmt.setList(v, 'task'))],
  ['Mod-Shift-h', cmd(fmt.insertDivider)],
  ['Mod-Alt-t', cmd(fmt.insertTable)],
].map(([key, run]) => ({ key, run }));

// Insert one or more pasted/dropped/picked images as Markdown on their own lines.
export function insertImageMarkdown(view, rels, pos) {
  const at = pos ?? view.state.selection.main.head;
  const line = view.state.doc.lineAt(at);
  // A blank line before the image keeps it from being swallowed by a quote or list above it.
  const prev = line.number > 1 ? view.state.doc.line(line.number - 1) : null;
  const lead = line.text.trim() ? '\n\n' : prev && prev.text.trim() ? '\n' : '';
  const text = lead + rels.map((r) => `![](${r})`).join('\n\n') + '\n';
  view.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + text.length }, scrollIntoView: true });
  view.focus();
}

export function createEditor(parent, { onChange, onSelection, onFocusChange, onImageFiles, autoHeadingEnabled = () => true }) {
  const imageFiles = (list) => [...(list || [])].filter((f) => f.type.startsWith('image/'));
  const extensions = [
    Prec.highest(
      keymap.of([
        { key: 'Shift-Enter', run: stepDownHeading },
        ...FORMAT_KEYS,
      ])
    ),
    autoHeadingAboveList(autoHeadingEnabled),
    history(),
    drawSelection(),
    dropCursor(),
    indentOnInput(),
    EditorView.lineWrapping,
    markdown({ base: markdownLanguage, codeLanguages }),
    syntaxHighlighting(highlightStyle),
    liveStyle,
    search({ top: true }),
    highlightSelectionMatches(),
    placeholder('Start writing…'),
    EditorView.domEventHandlers({
      paste(e, v) {
        const files = imageFiles(e.clipboardData?.files);
        if (!files.length || !onImageFiles) return false;
        e.preventDefault();
        onImageFiles(files).then((rels) => rels.length && insertImageMarkdown(v, rels));
        return true;
      },
      drop(e, v) {
        const files = imageFiles(e.dataTransfer?.files);
        if (!files.length || !onImageFiles) return false;
        e.preventDefault();
        const pos = v.posAtCoords({ x: e.clientX, y: e.clientY }) ?? undefined;
        onImageFiles(files).then((rels) => rels.length && insertImageMarkdown(v, rels, pos));
        return true;
      },
    }),
    keymap.of([...searchKeymap, ...historyKeymap, indentWithTab, ...defaultKeymap]),
    EditorView.contentAttributes.of({ spellcheck: 'true', autocorrect: 'on', autocapitalize: 'sentences' }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) onChange?.(u);
      if (u.selectionSet || u.docChanged || u.geometryChanged || u.viewportChanged) onSelection?.(u.view);
      if (u.focusChanged) onFocusChange?.(u.view);
    }),
  ];

  const makeState = (doc) => EditorState.create({ doc, extensions });
  const view = new EditorView({ state: makeState(''), parent });
  view.makeState = makeState;
  return view;
}

// Swap in a whole new document (fresh undo history).
export function loadText(view, text) {
  view.setState(view.makeState(text));
}
