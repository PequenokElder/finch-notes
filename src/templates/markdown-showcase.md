# Markdown Showcase

Every kind of note layout Finch understands, with a live example of each. Click into any line to see its raw Markdown, then copy the pattern you need. Delete whatever you don't want and keep the rest as your own template.

## 1. Headings

The note's title is a Heading 1. Everything below uses Heading 2 and smaller.

### Heading 3 for sub-sections

#### Heading 4 for details

##### Heading 5 is rarely needed

###### Heading 6 is the smallest

## 2. Text styles

Plain text sits between the formatting. Make a phrase **bold**, _italic_, or ***bold and italic***. Cross something out with ~~strikethrough~~. Mark code or a file name with `inline code`. To show a special character literally, put a backslash before it: \*not italic\*.

A new paragraph starts after a blank line. This one is separate from the paragraph above it, with comfortable spacing in between.

## 3. Links and images

A [named link](https://www.dropbox.com) reads cleanly in the text. A bare address like https://www.dropbox.com also becomes a link. Hold ⌘ and click any link to open it.

To add a picture, paste or drag it into the note, or press ⇧⌘M. Finch stores it beside your notes and writes the Markdown for you: `![A description](attachments/photo.png)`.

## 4. Block quotes

> A block quote sets a passage apart. Select any text and press **⇧⌘.** to turn it into one.

> Quotes can hold several paragraphs.
>
> A blank quoted line keeps them in one block,
> and **bold**, _italic_, and `code` still work inside.
>
> — Attribution goes on its own line

> Quotes can nest.
>
> > An inner quote sits inside the first one.
> >
> > > And one level deeper.

> **Note:** a quote with a bold label makes a simple callout.
>
> - It can even hold a list
> - with several items

## 5. Lists

A bulleted list, with as many levels as you need:

- First item
- Second item with enough words that it wraps onto another line, so you can see the neat hanging indent keep the text aligned
  - A nested item
    - Nested a level deeper
    - And another
  - Back out one level
- Last item

A numbered list. Numbers renumber themselves as you add or move items:

1. First step
2. Second step
   1. A sub-step
   2. Another sub-step
3. Third step

Bullets can live inside numbered steps:

1. Prepare
   - Gather the materials
   - Clear the table
2. Build
   - Follow the plan
3. Review

A checklist. Click a box to tick it off:

- [x] Done
- [ ] Not yet
  - [ ] A nested task
  - [x] A finished sub-task
- [ ] Another to-do

## 6. Code

Short code like `npm start` sits inside a sentence. For longer code, use a fenced block and name the language for colors.

```js
// JavaScript
const greet = (name) => `Hello, ${name}!`;
console.log(greet("Finch"));
```

```python
# Python
def total(prices):
    return sum(p for p in prices if p > 0)
```

```bash
# Shell
cd ~/Dropbox && ls -la | grep "Finch"
```

```json
{
  "name": "Finch",
  "themes": 8,
  "favorite": true
}
```

```yaml
# YAML
title: Weekly plan
days: [mon, tue, wed]
```

```sql
-- SQL
SELECT name, COUNT(*) AS total FROM notes GROUP BY name;
```

```
A block with no language is plain monospace text.
```

## 7. Tables

Tables are live. Click any cell to edit it, use Tab and Enter to move around (Tab on the last cell adds a row), and use the bar above the table to add or delete rows and columns, set a column's alignment, or delete the table. Press ⌥⌘T to insert a new one.

| Left aligned | Centered | Right aligned |
| :--- | :---: | ---: |
| Apples | 12 | $3.50 |
| Oranges | 7 | $4.25 |
| Pears | 30 | $2.00 |

## 8. Dividers

A divider separates big ideas with a quiet horizontal line. Put a blank line before it.

---

The note carries on below.

## 9. Raw syntax cheat sheet

Everything above, written out. Copy any line.

````markdown
# Heading 1
## Heading 2
### Heading 3

**bold**   _italic_   ***both***   ~~strike~~   `code`
[link text](https://example.com)

> A block quote
> > A nested quote

- Bullet
  - Nested bullet
1. Numbered
- [ ] Task
- [x] Finished task

```js
code block with a language
```

| Column A | Column B |
| --- | --- |
| cell | cell |

---
````

## 10. Shortcuts

| Action | Shortcut |
| --- | --- |
| Bold / Italic | ⌘B / ⌘I |
| Strikethrough / Inline code | ⇧⌘X / ⌘E |
| Link | ⌘K |
| Heading 1 / 2 / 3 / Body | ⌘1 / ⌘2 / ⌘3 / ⌥⌘0 |
| Block quote | ⇧⌘. |
| Code block | ⌥⌘C |
| Bulleted / Numbered list | ⇧⌘8 / ⇧⌘7 |
| Checklist | ⇧⌘T |
| Divider / Table / Image | ⇧⌘H / ⌥⌘T / ⇧⌘M |
| Step a heading down | Shift + Enter |
| Preview / Export PDF | ⇧⌘P / ⇧⌘E |
| Settings | ⌘, |

Select any text for a floating toolbar, and hover a button to see its shortcut.
