#!/usr/bin/env python3
"""End-to-end shortcut audit: launches Finch (dev) and presses REAL system keystrokes via System Events.

Needs macOS Accessibility permission for the terminal running this. Usage:  python3 scripts/shortcut-test.py
Each editor case sets a document + selection, presses the keys, and compares the resulting text.
Each app-level case (menu shortcuts) checks the native menu fired the expected action.
"""
import json, os, subprocess, sys, tempfile, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CMD, SHIFT, OPT = 'command down', 'shift down', 'option down'

def ks(ch, *mods):
    return f'keystroke "{ch}"' + (' using {' + ', '.join(mods) + '}' if mods else '')

def kc(code, *mods):
    return f'key code {code}' + (' using {' + ', '.join(mods) + '}' if mods else '')

# name, doc, sel_from, sel_to, applescript, expected text (str / ('has', substr)) or menu action ('menu', action)
CASES = [
    ('Bold ⌘B',            'hello world', 0, 11, ks('b', CMD), '**hello world**'),
    ('Italic ⌘I',          'hello world', 0, 11, ks('i', CMD), '_hello world_'),
    ('Strikethrough ⇧⌘X',  'hello world', 0, 11, ks('x', CMD, SHIFT), '~~hello world~~'),
    ('Inline code ⌘E',     'hello world', 0, 11, ks('e', CMD), '`hello world`'),
    ('Link ⌘K',            'hello world', 0, 11, ks('k', CMD), '[hello world](https://)'),
    ('Heading 1 ⌘1',       'Title', 0, 0, ks('1', CMD), '# Title'),
    ('Heading 2 ⌘2',       'Title', 0, 0, ks('2', CMD), '## Title'),
    ('Heading 3 ⌘3',       'Title', 0, 0, ks('3', CMD), '### Title'),
    ('Body text ⌥⌘0',      '## Title', 0, 0, ks('0', CMD, OPT), 'Title'),
    ('Block quote ⇧⌘.',    'quote me', 0, 0, kc(47, CMD, SHIFT), '> quote me'),
    ('Code block ⌥⌘C',     'code', 0, 0, ks('c', CMD, OPT), '```\ncode\n```'),
    ('Bulleted list ⇧⌘8',  'item', 0, 0, ks('8', CMD, SHIFT), '- item'),
    ('Numbered list ⇧⌘7',  'item', 0, 0, ks('7', CMD, SHIFT), '1. item'),
    ('Checklist ⇧⌘T',      'item', 0, 0, ks('t', CMD, SHIFT), '- [ ] item'),
    ('Divider ⇧⌘H',        'para', 4, 4, ks('h', CMD, SHIFT), ('has', '---')),
    ('Table ⌥⌘T',          'para', 4, 4, ks('t', CMD, OPT), ('has', '| Column 1')),
    ('Shift+Enter step-down', '# Title', 7, 7, kc(36, SHIFT), '# Title\n## '),
    ('New note ⌘N',        'x', 1, 1, ks('n', CMD), ('menu', 'new')),
    ('Pin note ⇧⌘D',       'x', 1, 1, ks('d', CMD, SHIFT), ('menu', 'pin')),
    ('Zoom in ⌘=',         'x', 1, 1, kc(24, CMD), ('menu', 'zoom-in')),
    ('Zoom out ⌘-',        'x', 1, 1, kc(27, CMD), ('menu', 'zoom-out')),
    ('Actual size ⌘0',     'x', 1, 1, ks('0', CMD), ('menu', 'zoom-reset')),
    ('Toggle sidebar ⌥⌘S', 'x', 1, 1, ks('s', CMD, OPT), ('menu', 'sidebar')),
    ('Preview ⇧⌘P',        'x', 1, 1, ks('p', CMD, SHIFT), ('menu', 'preview')),
    ('Export PDF ⇧⌘E',     'x', 1, 1, ks('e', CMD, SHIFT), ('menu', 'export')),
    ('Search notes ⇧⌘F',   'x', 1, 1, ks('f', CMD, SHIFT), ('menu', 'search-notes')),
    ('Settings ⌘,',        'x', 1, 1, kc(43, CMD), ('menu', 'settings')),
]

only = sys.argv[1:]  # optional substrings to run a subset
cases = [c for c in CASES if not only or any(o.lower() in c[0].lower() for o in only)]

notes = tempfile.mkdtemp(prefix='finch-sc-')
log_path = os.path.join(notes, 'run.log')
setup_js = '''(()=>{
  const cases = %s; const v = window.__finchView; let i = -1;
  const step = () => {
    if (i >= 0) console.log('RESULT ' + i + ' ' + JSON.stringify(v.state.doc.toString()));
    i++;
    if (i >= cases.length) { console.log('DONE'); clearInterval(t); return; }
    const c = cases[i];
    v.focus();
    v.dispatch({changes: {from: 0, to: v.state.doc.length, insert: c.doc}});
    v.dispatch({selection: {anchor: c.a, head: c.b}});
    console.log('SETUP ' + i);
  };
  const t = setInterval(step, 3000); step();
})()''' % json.dumps([{'doc': c[1], 'a': c[2], 'b': c[3]} for c in cases])

env = dict(os.environ, FINCH_NOTES_DIR=notes, FINCH_SNAPSHOT=os.path.join(notes, 'x.png'),
           FINCH_SNAPSHOT_JS=setup_js, FINCH_HOLD=str(3000 * len(cases) + 15000))
with open(log_path, 'w') as logf:
    proc = subprocess.Popen([os.path.join(ROOT, 'node_modules/.bin/electron'), ROOT], env=env, stdout=logf, stderr=subprocess.STDOUT)

def log():
    return open(log_path).read()

def wait_for(text, timeout=40):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if text in log():
            return True
        time.sleep(0.15)
    return False

def frontmost():
    r = subprocess.run(['osascript', '-e', 'tell application "System Events" to return name of first process whose frontmost is true'],
                       capture_output=True, text=True)
    return r.stdout.strip()

class FocusLost(Exception):
    pass

def osa(stmt):
    # Safety: never send keystrokes unless the app under test is frontmost, so they can't land in another app.
    if 'frontmost of process' not in stmt and frontmost() != 'Electron':
        raise FocusLost(f'frontmost app is {frontmost()!r}, not Electron')
    subprocess.run(['osascript', '-e', f'tell application "System Events"\n{stmt}\nend tell'], capture_output=True)

try:
    if not wait_for('SETUP 0'):
        print('App did not start'); sys.exit(1)
    osa('set frontmost of process "Electron" to true')
    time.sleep(1.2)
    for i, c in enumerate(cases):
        if i and not wait_for(f'SETUP {i}', 8):
            print(f'  ?? case {i} never set up'); break
        time.sleep(0.9)
        osa(c[4])
        time.sleep(1.4)
    wait_for('DONE', 10)
except FocusLost as e:
    print(f'ABORTED: {e}. No further keystrokes were sent.')
finally:
    time.sleep(0.5)
    proc.terminate()

print('log:', log_path)
text = log()
lines = text.splitlines()
passed = 0
for i, c in enumerate(cases):
    name, exp = c[0], c[5]
    # lines between SETUP i and the RESULT i
    try:
        a = next(k for k, l in enumerate(lines) if l.endswith(f'SETUP {i}'))
        b = next(k for k, l in enumerate(lines) if f'RESULT {i} ' in l)
    except StopIteration:
        print(f'FAIL  {name:26} (no result)'); continue
    seg = lines[a:b + 1]
    got = json.loads(lines[b].split(f'RESULT {i} ', 1)[1])
    if isinstance(exp, tuple) and exp[0] == 'menu':
        ok = any(f'[menu fired] {exp[1]}' in l for l in seg)
        detail = 'menu fired' if ok else 'menu did NOT fire'
    elif isinstance(exp, tuple):
        ok = exp[1] in got; detail = repr(got)
    else:
        ok = got == exp; detail = repr(got) + ('' if ok else f'   (wanted {exp!r})')
    passed += ok
    print(f'{"PASS" if ok else "FAIL"}  {name:26} {detail}')
print(f'\n{passed}/{len(cases)} passed')
sys.exit(0 if passed == len(cases) else 1)
