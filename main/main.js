const { app, BrowserWindow, Menu, ipcMain, dialog, shell, nativeTheme, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const fsp = fs.promises;

app.setName('Finch');

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
    if (/^[\w-]+\.md$/.test(f) || f === '.finch-pins.json' || f === 'attachments') {
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

function safeId(id) {
  if (typeof id !== 'string' || !/^[\w-]+\.md$/.test(id)) throw new Error('Invalid note id');
  return id;
}
const notePath = (id) => path.join(NOTES_DIR, safeId(id));

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
  const files = (await fsp.readdir(NOTES_DIR)).filter((f) => /^[\w-]+\.md$/.test(f));
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

function newId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.md`;
}

async function seedIfEmpty() {
  await ensureDir();
  const files = (await fsp.readdir(NOTES_DIR)).filter((f) => f.endsWith('.md'));
  if (files.length === 0) await fsp.writeFile(path.join(NOTES_DIR, newId()), WELCOME);
}

// ---------- IPC ----------

ipcMain.handle('notes:list', (_e, q) => listNotes(q));
ipcMain.handle('notes:read', (_e, id) => fsp.readFile(notePath(id), 'utf8'));
ipcMain.handle('notes:write', async (_e, id, text) => {
  await fsp.writeFile(notePath(id), text, 'utf8');
  return true;
});
ipcMain.on('notes:writeSync', (e, id, text) => {
  try { fs.writeFileSync(notePath(id), text, 'utf8'); } catch {}
  e.returnValue = true;
});
ipcMain.handle('notes:create', async (_e, text = '') => {
  await ensureDir();
  const id = newId();
  await fsp.writeFile(path.join(NOTES_DIR, id), text, 'utf8');
  return id;
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
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b1c1e' : '#fbfaf7',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
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
        item('Move Note to Trash…', 'CmdOrCtrl+Backspace', 'delete'),
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
        item('Insert Divider', 'CmdOrCtrl+Alt+H', 'format:hr'),
        item('Insert Table', 'CmdOrCtrl+Alt+T', 'format:table'),
        item('Insert Image…', 'CmdOrCtrl+Shift+M', 'format:image'),
      ],
    },
    {
      label: 'View',
      submenu: [
        item('Cycle Preview (Edit / Split / Preview)', 'CmdOrCtrl+Shift+P', 'preview'),
        item('Toggle Sidebar', 'CmdOrCtrl+\\', 'sidebar'),
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
  if (process.env.FINCH_THEME) nativeTheme.themeSource = process.env.FINCH_THEME; // dev/test only
  buildMenu();
  const devIcon = path.join(__dirname, '..', 'build', 'icon.png');
  if (app.dock && fs.existsSync(devIcon)) app.dock.setIcon(devIcon);
  createWindow();

  // Dev/test hook: FINCH_SNAPSHOT=/path.png captures the window after load, then quits.
  if (process.env.FINCH_SNAPSHOT) {
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
          if (process.env.FINCH_AFTER_JS) await mainWindow.webContents.executeJavaScript(process.env.FINCH_AFTER_JS);
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
