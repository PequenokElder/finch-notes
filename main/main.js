const { app, BrowserWindow, Menu, ipcMain, dialog, shell, nativeTheme, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const fsp = fs.promises;

app.setName('Finch');

// Automated test runs (FINCH_SNAPSHOT) are isolated from the real app: their own settings profile, and unless
// they need real keystrokes, a hidden window with no Dock icon, so they never disturb or touch your Finch.
const TEST_MODE = !!process.env.FINCH_SNAPSHOT;
const TEST_VISIBLE = TEST_MODE && !!(process.env.FINCH_KEYS || process.env.FINCH_HOLD);
if (TEST_MODE) app.setPath('userData', path.join(os.tmpdir(), 'finch-test-profile'));

// Notes are plain .md files in ~/Documents/Finch — easy to back up, sync, or open anywhere.
// The notes folder is a setting (File → Choose Notes Folder…), stored in the app's config file.
const CONFIG_FILE = () => path.join(app.getPath('userData'), 'config.json');
function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE(), 'utf8')); } catch { return {}; }
}
function writeConfig(patch) {
  fs.mkdirSync(path.dirname(CONFIG_FILE()), { recursive: true });
  fs.writeFileSync(CONFIG_FILE(), JSON.stringify({ ...readConfig(), ...patch }, null, 2));
}
let NOTES_DIR =
  process.env.FINCH_NOTES_DIR || readConfig().notesDir || path.join(app.getPath('documents'), 'Finch');

// Copy notes, pins and images from one folder to another (never deletes the originals).
async function copyNotes(from, to) {
  await fsp.mkdir(to, { recursive: true });
  for (const f of await fsp.readdir(from)) {
    if (isNoteFile(f) || f === '.finch-pins.json' || f === '.finch-names.json' || f === 'attachments') {
      await fsp.cp(path.join(from, f), path.join(to, f), { recursive: true, force: false, errorOnExist: false });
    }
  }
}

async function chooseNotesFolder() {
  const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose Notes Folder',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: NOTES_DIR,
    buttonLabel: 'Use This Folder',
  });
  if (canceled || !filePaths[0] || filePaths[0] === NOTES_DIR) return;
  const target = filePaths[0];
  const old = NOTES_DIR;
  const hasNotes = async (d) => { try { return (await fsp.readdir(d)).some((f) => f.endsWith('.md')); } catch { return false; } };
  if ((await hasNotes(old)) && !(await hasNotes(target))) {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Copy My Notes', 'Start Empty', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: 'Copy your existing notes to the new folder?',
      detail: `Your current notes stay where they are as a backup.\n\nFrom: ${old}\nTo: ${target}`,
    });
    if (response === 2) return;
    if (response === 0) await copyNotes(old, target);
  }
  writeConfig({ notesDir: target });
  NOTES_DIR = target;
  await seedIfEmpty();
  tidyNames();
  mainWindow.webContents.reload(); // the UI re-reads the folder (and image paths) on load
}

// ---------- Notes storage ----------

const WELCOME = `# Welcome to Finch

Finch is a quiet place for notes written in Markdown. **Select any text** and a small toolbar appears so you never have to remember a shortcut.

#welcome

## What to try

- Select this sentence and make it **bold**, _italic_, or \`code\`
- Click into a line to see its raw Markdown; click away and it tidies up
- Press **⌘⇧P** to see a live preview, **⌘⇧E** to export a PDF

> A block quote looks like this. Select a few lines and hit the quote button to turn them into one.

### A checklist

- [x] Install Finch
- [ ] Write something wonderful
- [ ] Export it as a PDF

### Code

\`\`\`js
const greet = (name) => \`Hello, \${name}!\`;
console.log(greet("Finch"));
\`\`\`

### A table

| Feature | Where |
| --- | --- |
| Formatting toolbar | Select text |
| Live preview | ⌘⇧P |
| PDF export | ⌘⇧E |

---

Your notes live as plain files in \`~/Documents/Finch\`.
`;

async function ensureDir() {
  await fsp.mkdir(NOTES_DIR, { recursive: true });
}

// Notes are named after their title, e.g. "Trip planning.md". The file name is the note's id.
const isNoteFile = (f) =>
  typeof f === 'string' && f.toLowerCase().endsWith('.md') && !f.startsWith('.') && !/[\\/\0]/.test(f) && f.length <= 200;

// After a rename, a save that was already in flight may still use the old name: follow it to the new one.
const aliases = new Map();
function resolveId(id) {
  let hops = 0;
  while (typeof id === 'string' && aliases.has(id) && hops++ < 20 && !fs.existsSync(path.join(NOTES_DIR, id))) {
    id = aliases.get(id);
  }
  return id;
}
function safeId(id) {
  id = resolveId(id);
  if (!isNoteFile(id)) throw new Error('Invalid note id');
  return id;
}
const notePath = (id) => path.join(NOTES_DIR, safeId(id));

// ---- Title-based file names ----
const NAMES_FILE = () => path.join(NOTES_DIR, '.finch-names.json'); // names Finch chose (and so may keep up to date)
function readNames() {
  try { return new Set(JSON.parse(fs.readFileSync(NAMES_FILE(), 'utf8'))); } catch { return new Set(); }
}
function writeNames(set) {
  try { fs.writeFileSync(NAMES_FILE(), JSON.stringify([...set])); } catch {}
}
const LEGACY_ID = /^[a-z0-9]{12}\.md$/; // the random names early versions used

// The title a file should be named after: the H1, else the first heading, else a short phrase from the text.
function fileTitle(text) {
  let inFence = false;
  let h1 = null, h = null, first = null, m;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    if ((m = line.match(/^#\s+(\S.*?)\s*#*\s*$/))) { h1 = m[1]; break; }
    if (!h && (m = line.match(/^#{2,6}\s+(\S.*?)\s*#*\s*$/))) h = m[1];
    if (!first) {
      const t = cleanLine(line);
      if (t && !/^[-*_=]{3,}$/.test(t) && !/^#[\p{L}\p{N}_\-/]+(\s+#[\p{L}\p{N}_\-/]+)*$/u.test(t)) first = t;
    }
  }
  const strip = (t) => t.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`~]/g, '').replace(/\s+/g, ' ').trim().replace(/^title\s*:\s*/i, '');
  if (h1 || h) {
    const t = strip(h1 || h);
    return t.length > 70 ? t.slice(0, 70).replace(/\s+\S*$/, '') || t.slice(0, 70) : t || 'Untitled';
  }
  if (first) {
    // No heading: a short phrase for what the note is about (first sentence, at most 6 words).
    const sentence = strip(first).split(/[.!?:;]\s/)[0].replace(/[.!?:;,]+$/, '');
    // Don't end on a dangling word like "with" or "the".
    const short = sentence.split(' ').slice(0, 6).join(' ').replace(/(\s+(a|an|the|and|or|of|to|for|in|on|at|with|by|from|is|are|was))+$/i, '');
    return (short.length > 50 ? short.slice(0, 50).replace(/\s+\S*$/, '') : short) || 'Untitled';
  }
  return 'Untitled';
}

// Make a title safe as a file name on macOS, Windows and Dropbox.
function sanitizeFileName(title) {
  let n = title
    .replace(/[\\/|]/g, '-')
    .replace(/[:*?"<>\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '')
    .slice(0, 70)
    .replace(/[.\s]+$/, '');
  if (!n) n = 'Untitled';
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(n)) n += ' note';
  return n;
}

// "Title.md", or "Title 2.md", "Title 3.md" if that name is taken (case-insensitive, like macOS).
function uniqueName(base, selfId) {
  let taken;
  try { taken = new Set(fs.readdirSync(NOTES_DIR).map((f) => f.toLowerCase())); } catch { taken = new Set(); }
  if (selfId) taken.delete(selfId.toLowerCase());
  let name = `${base}.md`;
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base} ${i}.md`;
  return name;
}

function movePin(from, to) {
  try {
    const pins = new Set(JSON.parse(fs.readFileSync(path.join(NOTES_DIR, '.finch-pins.json'), 'utf8')));
    if (pins.delete(from)) {
      pins.add(to);
      fs.writeFileSync(path.join(NOTES_DIR, '.finch-pins.json'), JSON.stringify([...pins]));
    }
  } catch {}
}

// Rename a note to match its title, but only if Finch named it (never touch a file you renamed yourself).
function autoRename(id, text) {
  id = resolveId(id);
  if (!isNoteFile(id) || !fs.existsSync(path.join(NOTES_DIR, id))) return id;
  const names = readNames();
  if (!names.has(id) && !LEGACY_ID.test(id)) return id;
  const base = sanitizeFileName(fileTitle(text));
  const current = id.replace(/\.md$/i, '');
  // Already named for this title (allowing a " 2" style suffix added to avoid a clash).
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (current === base || new RegExp(`^${escaped} \\d+$`).test(current)) return id;
  const target = uniqueName(base, id);
  if (target === id) return id;
  fs.renameSync(path.join(NOTES_DIR, id), path.join(NOTES_DIR, target));
  names.delete(id);
  names.add(target);
  writeNames(names);
  movePin(id, target);
  aliases.set(id, target);
  return target;
}

// On launch: rename legacy random names, and fix any name that drifted from its title (e.g. quit mid-edit).
function tidyNames() {
  try {
    const names = readNames();
    for (const f of fs.readdirSync(NOTES_DIR)) {
      if (isNoteFile(f) && (LEGACY_ID.test(f) || names.has(f))) autoRename(f, fs.readFileSync(path.join(NOTES_DIR, f), 'utf8'));
    }
  } catch {}
}

const MD_STRIP = /^\s{0,3}(#{1,6}\s+|>\s*|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)*/;
function cleanLine(line) {
  return line.replace(MD_STRIP, '').replace(/[*_`~]|!?\[([^\]]*)\]\([^)]*\)/g, '$1').trim();
}

function deriveTitle(text) {
  for (const line of text.split('\n')) {
    const t = cleanLine(line);
    if (t && !/^#[\p{L}\p{N}_\-/]+(\s+#[\p{L}\p{N}_\-/]+)*$/u.test(t)) return t.slice(0, 120);
  }
  return 'Untitled';
}

function deriveSnippet(text, title) {
  const out = [];
  let skippedTitle = false;
  let inFence = false;
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const t = cleanLine(line);
    if (!t || /^[-*_]{3,}$/.test(t)) continue;
    if (/^#[\p{L}\p{N}_\-/]+(\s+#[\p{L}\p{N}_\-/]+)*$/u.test(t)) continue;
    if (!skippedTitle && t === title) { skippedTitle = true; continue; }
    out.push(t);
    if (out.join(' ').length > 140) break;
  }
  return out.join(' ').slice(0, 140);
}

function extractTags(text) {
  const tags = new Set();
  let inFence = false;
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const stripped = line.replace(/`[^`]*`/g, '');
    for (const m of stripped.matchAll(/(?:^|\s)#([\p{L}_][\p{L}\p{N}_\-/]*)/gu)) tags.add(m[1].toLowerCase());
  }
  return [...tags];
}

const PINS_FILE = () => path.join(NOTES_DIR, '.finch-pins.json');
async function readPins() {
  try { return new Set(JSON.parse(await fsp.readFile(PINS_FILE(), 'utf8'))); } catch { return new Set(); }
}

async function listNotes(query) {
  await ensureDir();
  const pins = await readPins();
  const files = (await fsp.readdir(NOTES_DIR)).filter(isNoteFile);
  const q = (query || '').trim().toLowerCase();
  const notes = await Promise.all(
    files.map(async (id) => {
      const p = path.join(NOTES_DIR, id);
      const [text, stat] = await Promise.all([fsp.readFile(p, 'utf8'), fsp.stat(p)]);
      if (q && !text.toLowerCase().includes(q)) return null;
      const title = deriveTitle(text);
      return { id, title, snippet: deriveSnippet(text, title), tags: extractTags(text), mtime: stat.mtimeMs, pinned: pins.has(id) };
    })
  );
  return notes.filter(Boolean).sort((a, b) => (b.pinned - a.pinned) || (b.mtime - a.mtime));
}

// Create a note file named after its title; Finch keeps the name in step with the title afterwards.
function createNoteFile(text) {
  const id = uniqueName(sanitizeFileName(fileTitle(text)));
  fs.writeFileSync(path.join(NOTES_DIR, id), text, 'utf8');
  const names = readNames();
  names.add(id);
  writeNames(names);
  aliases.delete(id);
  return id;
}

async function seedIfEmpty() {
  await ensureDir();
  const files = (await fsp.readdir(NOTES_DIR)).filter(isNoteFile);
  if (files.length === 0) createNoteFile(WELCOME);
}

// ---------- IPC ----------

ipcMain.handle('notes:list', (_e, q) => listNotes(q));
ipcMain.handle('notes:read', (_e, id) => fsp.readFile(notePath(id), 'utf8'));
ipcMain.handle('notes:write', async (_e, id, text) => {
  const rid = safeId(id);
  await fsp.writeFile(path.join(NOTES_DIR, rid), text, 'utf8');
  return rid; // may differ from `id` if the note was renamed since the renderer last heard
});
ipcMain.handle('notes:rename', (_e, id, text) => autoRename(id, text));
ipcMain.on('notes:renameSync', (e, id, text) => {
  try { e.returnValue = autoRename(id, text); } catch { e.returnValue = id; }
});
ipcMain.on('notes:writeSync', (e, id, text) => {
  try {
    fs.writeFileSync(notePath(id), text, 'utf8');
    autoRename(id, text); // quitting leaves the file named after its title
  } catch {}
  e.returnValue = true;
});
ipcMain.handle('notes:create', async (_e, text = '') => {
  await ensureDir();
  return createNoteFile(text);
});
// Remove a note only if it is still empty (used when abandoning a blank new note).
ipcMain.handle('notes:discardIfEmpty', async (_e, id) => {
  try {
    const p = notePath(id);
    // Blank, or just the empty "# " a new note starts with.
    if (/^\s*(#{1,6}\s*)?$/.test(await fsp.readFile(p, 'utf8'))) await fsp.unlink(p);
  } catch {}
  return true;
});
ipcMain.handle('notes:trash', async (e, id) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const p = notePath(id);
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Move to Trash', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    message: 'Move this note to the Trash?',
    detail: 'You can restore it from the Trash in Finder.',
  });
  if (response !== 0) return false;
  await shell.trashItem(p);
  return true;
});

ipcMain.handle('notes:pin', async (_e, id, pinned) => {
  safeId(id);
  const pins = await readPins();
  if (pinned) pins.add(id); else pins.delete(id);
  await fsp.writeFile(PINS_FILE(), JSON.stringify([...pins]));
  return true;
});

// ---- images: stored in <notes>/attachments and referenced with relative paths ----
const IMG_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
async function storeImage(buf, ext) {
  const e = IMG_EXT.includes(String(ext).toLowerCase()) ? String(ext).toLowerCase() : 'png';
  const dir = path.join(NOTES_DIR, 'attachments');
  await fsp.mkdir(dir, { recursive: true });
  const name = `img-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}.${e}`;
  await fsp.writeFile(path.join(dir, name), buf);
  return `attachments/${name}`;
}
ipcMain.handle('notes:saveImage', (_e, bytes, ext) => storeImage(Buffer.from(bytes), ext));
ipcMain.handle('notes:pickImage', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const { filePaths, canceled } = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: IMG_EXT }],
  });
  if (canceled) return [];
  const out = [];
  for (const f of filePaths) out.push(await storeImage(await fsp.readFile(f), path.extname(f).slice(1)));
  return out;
});

ipcMain.handle('settings:chooseFolder', () => chooseNotesFolder());
ipcMain.handle('shell:open', (_e, p) => shell.openPath(p));
ipcMain.handle('shell:reveal', (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('app:info', () => ({ notesDir: NOTES_DIR }));

ipcMain.handle('pdf:export', async (e, { html, name, pageNumbers }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const safeName = (name || 'Note').replace(/[\\/:*?"<>|]/g, '-').slice(0, 80) || 'Note';
  // FINCH_PDF_OUT lets automated tests skip the save dialog.
  const { filePath, canceled } = process.env.FINCH_PDF_OUT
    ? { filePath: process.env.FINCH_PDF_OUT, canceled: false }
    : await dialog.showSaveDialog(win, {
        defaultPath: path.join(app.getPath('documents'), `${safeName}.pdf`),
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
  if (canceled || !filePath) return null;

  const tmp = path.join(os.tmpdir(), `finch-${Date.now()}.html`);
  await fsp.writeFile(tmp, html, 'utf8');
  const pdfWin = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } });
  try {
    await pdfWin.loadFile(tmp);
    const data = await pdfWin.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: !!pageNumbers,
      headerTemplate: '<span></span>',
      footerTemplate:
        '<div style="width:100%;text-align:center;font-size:8px;color:#9a9a9a;font-family:-apple-system,Helvetica,sans-serif;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    });
    await fsp.writeFile(filePath, data);
    return filePath;
  } finally {
    pdfWin.destroy();
    fsp.unlink(tmp).catch(() => {});
  }
});

// ---------- Window & menu ----------

let mainWindow;

function send(action) {
  if (process.env.FINCH_SNAPSHOT) console.log('[menu fired]', action);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('menu', action);
}

const STATE_FILE = () => path.join(app.getPath('userData'), 'window-state.json');
function loadWindowState() {
  try {
    const st = JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8'));
    // Ignore saved positions that are no longer on any screen (e.g. unplugged monitor).
    const onScreen = screen.getAllDisplays().some((d) => {
      const b = d.workArea;
      return st.x < b.x + b.width - 50 && st.x + st.width > b.x + 50 && st.y < b.y + b.height - 50 && st.y + 100 > b.y;
    });
    return onScreen ? st : { width: st.width, height: st.height };
  } catch {
    return {};
  }
}

function createWindow() {
  const saved = loadWindowState();
  mainWindow = new BrowserWindow({
    width: saved.width || 1180,
    height: saved.height || 780,
    x: saved.x,
    y: saved.y,
    minWidth: 760,
    minHeight: 480,
    title: 'Finch',
    show: !(TEST_MODE && !TEST_VISIBLE),
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b1c1e' : '#fbfaf7',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: !TEST_MODE,
      spellcheck: true,
    },
  });
  if (saved.maximized) mainWindow.maximize();
  let stateTimer;
  const saveState = () => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isFullScreen()) return;
    const b = mainWindow.isMaximized() ? mainWindow.getNormalBounds() : mainWindow.getBounds();
    try { fs.writeFileSync(STATE_FILE(), JSON.stringify({ ...b, maximized: mainWindow.isMaximized() })); } catch {}
  };
  const saveSoon = () => { clearTimeout(stateTimer); stateTimer = setTimeout(saveState, 400); };
  mainWindow.on('resize', saveSoon);
  mainWindow.on('move', saveSoon);
  mainWindow.on('close', saveState);
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // Links in notes open in the default browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:')) {
      e.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });
}

function buildMenu() {
  const item = (label, accelerator, action) => ({ label, accelerator, click: () => send(action) });
  const template = [
    {
      label: 'Finch',
      submenu: [
        { role: 'about', label: 'About Finch' },
        { type: 'separator' },
        item('Settings…', 'CmdOrCtrl+,', 'settings'),
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        item('New Note', 'CmdOrCtrl+N', 'new'),
        item('Pin / Unpin Note', 'CmdOrCtrl+Shift+D', 'pin'),
        item('Export as PDF…', 'CmdOrCtrl+Shift+E', 'export'),
        { type: 'separator' },
        { label: 'Choose Notes Folder…', click: () => chooseNotesFolder() },
        {
          label: 'Show Notes Folder',
          click: () => shell.openPath(NOTES_DIR),
        },
        item('Move Note to Trash…', 'CmdOrCtrl+Shift+Backspace', 'delete'),
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        item('Undo', 'CmdOrCtrl+Z', 'undo'),
        item('Redo', 'CmdOrCtrl+Shift+Z', 'redo'),
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'selectAll' },
        { type: 'separator' },
        item('Find…', 'CmdOrCtrl+F', 'find'),
        item('Search Notes', 'CmdOrCtrl+Shift+F', 'search-notes'),
      ],
    },
    {
      label: 'Format',
      submenu: [
        item('Bold', 'CmdOrCtrl+B', 'format:bold'),
        item('Italic', 'CmdOrCtrl+I', 'format:italic'),
        item('Strikethrough', 'CmdOrCtrl+Shift+X', 'format:strike'),
        item('Inline Code', 'CmdOrCtrl+E', 'format:code'),
        item('Link…', 'CmdOrCtrl+K', 'format:link'),
        { type: 'separator' },
        item('Heading 1', 'CmdOrCtrl+1', 'format:h1'),
        item('Heading 2', 'CmdOrCtrl+2', 'format:h2'),
        item('Heading 3', 'CmdOrCtrl+3', 'format:h3'),
        item('Body Text', 'CmdOrCtrl+Alt+0', 'format:p'),
        { type: 'separator' },
        { ...item('Block Quote', 'CmdOrCtrl+Shift+.', 'format:quote'), registerAccelerator: false }, // key handled in the editor
        item('Code Block', 'CmdOrCtrl+Alt+C', 'format:codeblock'),
        item('Bulleted List', 'CmdOrCtrl+Shift+8', 'format:ul'),
        item('Numbered List', 'CmdOrCtrl+Shift+7', 'format:ol'),
        item('Checklist', 'CmdOrCtrl+Shift+T', 'format:task'),
        { type: 'separator' },
        item('Insert Divider', 'CmdOrCtrl+Shift+H', 'format:hr'),
        item('Insert Table', 'CmdOrCtrl+Alt+T', 'format:table'),
        item('Insert Image…', 'CmdOrCtrl+Shift+M', 'format:image'),
      ],
    },
    {
      label: 'View',
      submenu: [
        item('Cycle Preview (Edit / Split / Preview)', 'CmdOrCtrl+Shift+P', 'preview'),
        item('Toggle Sidebar', 'CmdOrCtrl+Alt+S', 'sidebar'),
        { type: 'separator' },
        item('Zoom In', 'CmdOrCtrl+=', 'zoom-in'),
        { ...item('Zoom In', 'CmdOrCtrl+Plus', 'zoom-in'), visible: false },
        item('Zoom Out', 'CmdOrCtrl+-', 'zoom-out'),
        item('Actual Size', 'CmdOrCtrl+0', 'zoom-reset'),
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  await seedIfEmpty();
  tidyNames();
  if (process.env.FINCH_THEME) nativeTheme.themeSource = process.env.FINCH_THEME; // dev/test only
  buildMenu();
  if (TEST_MODE && !TEST_VISIBLE) app.dock?.hide();
  const devIcon = path.join(__dirname, '..', 'build', 'icon.png');
  if (app.dock && fs.existsSync(devIcon)) app.dock.setIcon(devIcon);
  createWindow();

  // Dev/test hook: FINCH_SNAPSHOT=/path.png captures the window after load, then quits.
  if (process.env.FINCH_SNAPSHOT) {
    mainWindow.webContents.on('before-input-event', (_e, i) => {
      if (i.type === 'keyDown' && (i.meta || i.control)) console.log('[key reached page]', i.key, i.meta ? 'cmd' : '', i.shift ? 'shift' : '', i.alt ? 'alt' : '');
    });
    mainWindow.webContents.on('console-message', (_e, _lvl, msg) => console.log('[renderer]', msg));
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          if (process.env.FINCH_SNAPSHOT_JS) {
            app.focus({ steal: true });
            mainWindow.focus();
            await new Promise((r) => setTimeout(r, 300));
            await mainWindow.webContents.executeJavaScript(process.env.FINCH_SNAPSHOT_JS);
            await new Promise((r) => setTimeout(r, Number(process.env.FINCH_SNAPSHOT_WAIT || 700)));
          }
          // FINCH_KEYS: JSON array of strings (typed text) and {key, mods} (special keys), sent as real key events.
          if (process.env.FINCH_KEYS) {
            const wc = mainWindow.webContents;
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
            for (const step of JSON.parse(process.env.FINCH_KEYS)) {
              if (typeof step === 'string') {
                for (const ch of step) {
                  wc.sendInputEvent({ type: 'keyDown', keyCode: ch });
                  wc.sendInputEvent({ type: 'char', keyCode: ch });
                  wc.sendInputEvent({ type: 'keyUp', keyCode: ch });
                  await sleep(40);
                }
              } else {
                wc.sendInputEvent({ type: 'keyDown', keyCode: step.key, modifiers: step.mods || [] });
                if (step.key === 'Return') wc.sendInputEvent({ type: 'char', keyCode: '\r' });
                wc.sendInputEvent({ type: 'keyUp', keyCode: step.key, modifiers: step.mods || [] });
                await sleep(60);
              }
            }
            await sleep(300);
          }
          if (process.env.FINCH_HOLD) await new Promise((r) => setTimeout(r, Number(process.env.FINCH_HOLD))); // time for external (system) keystrokes
          if (process.env.FINCH_AFTER_JS) await mainWindow.webContents.executeJavaScript(process.env.FINCH_AFTER_JS);
          // FINCH_SHOTS: JSON [{js, wait, out}] — run JS then save a screenshot, several times in one launch.
          if (process.env.FINCH_SHOTS) {
            for (const shot of JSON.parse(process.env.FINCH_SHOTS)) {
              if (shot.js) await mainWindow.webContents.executeJavaScript(shot.js);
              await new Promise((r) => setTimeout(r, shot.wait || 500));
              fs.writeFileSync(shot.out, (await mainWindow.webContents.capturePage()).toPNG());
            }
          }
          const img = await mainWindow.webContents.capturePage();
          fs.writeFileSync(process.env.FINCH_SNAPSHOT, img.toPNG());
        } catch (err) {
          console.error('snapshot failed', err);
        }
        app.quit();
      }, 1500);
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
