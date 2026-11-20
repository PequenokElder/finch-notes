import { Marked } from 'marked';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import yaml from 'highlight.js/lib/languages/yaml';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import java from 'highlight.js/lib/languages/java';
import cpp from 'highlight.js/lib/languages/cpp';
import markdownLang from 'highlight.js/lib/languages/markdown';
import docCss from './doc.css';
import { resolveImageSrc } from './images.js';

const langs = { javascript, typescript, python, bash, json, css, xml, sql, swift, yaml, go, rust, java, cpp, markdown: markdownLang };
for (const [name, def] of Object.entries(langs)) hljs.registerLanguage(name, def);
hljs.registerAliases(['js', 'jsx', 'node'], { languageName: 'javascript' });
hljs.registerAliases(['ts', 'tsx'], { languageName: 'typescript' });
hljs.registerAliases(['py'], { languageName: 'python' });
hljs.registerAliases(['sh', 'shell', 'zsh'], { languageName: 'bash' });
hljs.registerAliases(['html', 'svg'], { languageName: 'xml' });
hljs.registerAliases(['yml'], { languageName: 'yaml' });
hljs.registerAliases(['c', 'h'], { languageName: 'cpp' });

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    code({ text, lang }) {
      const language = (lang || '').trim().split(/\s+/)[0].toLowerCase();
      let body;
      if (language && hljs.getLanguage(language)) {
        body = hljs.highlight(text, { language, ignoreIllegals: true }).value;
      } else {
        body = escapeHtml(text);
      }
      const label = language ? `<span class="code-lang">${escapeHtml(language)}</span>` : '';
      return `<pre>${label}<code class="hljs">${body}</code></pre>\n`;
    },
    image({ href, title, text }) {
      const t = title ? ` title="${escapeHtml(title)}"` : '';
      return `<img src="${escapeHtml(resolveImageSrc(href))}" alt="${escapeHtml(text || '')}"${t}>`;
    },
  },
});

// Lines that contain only #tags are organisational, not content: leave them out of the rendered note.
const TAG_LINE = /^\s*#[\p{L}_][\p{L}\p{N}_\-/]*(\s+#[\p{L}_][\p{L}\p{N}_\-/]*)*\s*$/u;

function stripTagLines(md) {
  let inFence = false;
  return md
    .split('\n')
    .filter((line) => {
      if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
      return inFence || !TAG_LINE.test(line);
    })
    .join('\n');
}

// Inline Markdown only (bold, italic, code, links…), used inside table cells.
export function renderInline(md) {
  try { return marked.parseInline(md, { async: false }); } catch { return escapeHtml(md); }
}

export function renderMarkdown(md) {
  return marked.parse(stripTagLines(md), { async: false });
}

export const DOC_CSS = docCss;

export function buildPdfHtml(md, { title = 'Note', pageSize = 'Letter' } = {}) {
  const body = renderMarkdown(md);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
@page { size: ${pageSize === 'A4' ? 'A4' : 'Letter'}; margin: 0.85in 0.9in; }
html, body { margin: 0; padding: 0; background: #fff; }
${docCss}
.doc { max-width: none; padding: 0; }
</style></head>
<body><article class="doc">${body}</article></body></html>`;
}
