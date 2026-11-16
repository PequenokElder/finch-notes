# Finch

A calm, local Markdown notes app for macOS — in the spirit of Bear — with a clean sans-serif editor,
a select-text formatting toolbar, and presentable PDF export.

## Run it

```bash
npm install        # first time only
npm start          # builds and launches Finch
```

## Make a real Finch.app

```bash
npm run package    # creates release/Finch-darwin-<arch>/Finch.app
```

Drag `Finch.app` into `/Applications`. (It is unsigned, so the first launch needs right-click → Open.)

## Where notes live

Plain `.md` files in a folder you choose (default `~/Documents/Finch`). Change it any time in **Settings → Notes folder**
(or File → Choose Notes Folder…); Finch offers to copy your existing notes over. Point it at a Dropbox/iCloud folder to sync.
Nothing is uploaded anywhere. Images pasted into notes live in an `attachments/` folder beside them.
Set `FINCH_NOTES_DIR=/some/folder` to override the folder for a single run.

## Using it

- **Select text** → a floating toolbar appears (headings, bold, italic, strikethrough, code, link, quote, lists, checklist, code block).
- A fixed toolbar across the top does the same for the current line, plus dividers and tables.
- **Click into a line** to see its raw Markdown; click away and it tidies up.
- `#tags` anywhere in a note show up as filters in the sidebar. Tag-only lines are left out of PDFs.
- **⇧⌘P** cycles Edit → Split preview → Preview. **⇧⌘E** exports a PDF (Letter or A4, optional page numbers).
- New notes start as a **Heading 1**. **Shift+Enter** steps down: H1 → H2 → H3 → body text (on an empty heading it cycles in place).
- Lists keep their bullets/numbers as you type: Enter continues the list, Enter on an empty item ends it. **⇧⌘.** makes a block quote.
- Start a list under a short heading-like line and that line becomes a **Heading 2** automatically (⌘Z undoes it; toggle in Settings).
- Every command is also in the **Format** menu with its shortcut.
- **⌘, Settings** has eight themes (Goldfinch, Nightingale, Snowfinch, Blackbird, Bluebird, Meadowlark, Cardinal, Twilight Swallow) plus Auto.
- Zoom with ⌘+ / ⌘− / ⌘0, pinch, or the status bar. Pin notes with ⇧⌘D. Paste or drag images straight into a note.
- `npm run install-app` rebuilds Finch and replaces the copy in /Applications.

## Layout

- `main/` — Electron main process (notes on disk, menu, PDF generation)
- `src/` — renderer source: `editor.js` (CodeMirror live styling), `format.js` (toolbar commands),
  `render.js` + `doc.css` (Markdown → HTML, shared by the preview and the PDF), `app.js` (UI)
- `renderer/` — HTML/CSS shell; `renderer/dist/app.js` is the bundle produced by `npm run build`
