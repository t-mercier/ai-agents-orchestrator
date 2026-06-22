#!/usr/bin/env python3
"""Rename a session category everywhere: the shared config, the category folder,
every session's notes.md frontmatter, and active-sessions.json.

Modes:
  rename.py                         → list current categories
  rename.py --plan  <OLD> <NEW>     → validate + print what would change (no writes)
  rename.py --apply <OLD> <NEW>     → perform the migration

The dashboard app is read-only on ~/.claude; this skill is the writer that
migrates references so a rename doesn't orphan sessions.
"""
import sys, os, json, re, glob, tempfile, shutil

HOME = os.path.expanduser('~')
CONFIG = os.path.join(HOME, '.config', 'ai-agents-orchestrator', 'config.json')
ACTIVE = os.path.join(HOME, '.claude', 'active-sessions.json')
SESSIONS = os.path.join(HOME, '.claude', 'sessions')
NAME_RE = re.compile(r'^[A-Za-z0-9_-]{1,20}$')


def expand(p):
    if not isinstance(p, str):
        return p
    if p == '~':
        return HOME
    if p.startswith('~/'):
        return os.path.join(HOME, p[2:])
    return p


def load_json(p, default):
    try:
        with open(p) as f:
            return json.load(f)
    except Exception:
        return default


def atomic_write(p, data):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(p))
    with os.fdopen(fd, 'w') as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, p)


def alive(pid):
    try:
        os.kill(int(pid), 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except Exception:
        return False


def category_base(cfg, scope):
    if scope == 'personal':
        return expand(cfg.get('personalRoot') or HOME)
    return expand(cfg.get('workRoot') or os.path.join(HOME, 'work'))


def find_category(cfg, name):
    for c in cfg.get('categories', []):
        if c.get('name') == name:
            return c
    return None


def main():
    args = sys.argv[1:]
    mode = None
    if args and args[0] in ('--plan', '--apply'):
        mode, args = args[0], args[1:]

    cfg = load_json(CONFIG, None)
    if cfg is None:
        print(f"ERROR: no config at {CONFIG}")
        sys.exit(1)

    if len(args) < 2:
        print("Current categories:")
        for c in cfg.get('categories', []):
            print(f"  {c.get('name')}  ({c.get('scope')}, {c.get('color')})")
        print("\nUsage: rename.py --plan|--apply <OLD> <NEW>")
        return

    OLD, NEW = args[0], args[1]
    if not NAME_RE.match(NEW):
        print(f"ERROR: invalid new name '{NEW}' (letters/digits/_/-, max 20)")
        sys.exit(1)
    matches = [c for c in cfg.get('categories', []) if c.get('name') == OLD]
    if not matches:
        print(f"ERROR: category '{OLD}' not found in config")
        sys.exit(1)
    # A name can live under several spaces (v2 roots). This skill resolves the folder by
    # scope, not by root, so it can't safely disambiguate — renaming would touch only the
    # first match and leave the config inconsistent. Refuse and point at the dashboard
    # (its Settings rename is per-space). Insurance against silent config corruption.
    if len(matches) > 1:
        spaces = ', '.join(sorted({
            c.get('root') or ('Perso' if c.get('scope') == 'personal' else 'Work')
            for c in matches
        }))
        print(f"ERROR: category '{OLD}' exists under multiple spaces ({spaces}). "
              f"This skill renames by name and can't tell them apart — remove the "
              f"duplicate first (the dashboard's Settings can drop a category; the "
              f"folder on disk is left untouched), then re-run.")
        sys.exit(1)
    cat = matches[0]
    if find_category(cfg, NEW):
        print(f"ERROR: category '{NEW}' already exists")
        sys.exit(1)

    scope = cat.get('scope', 'work')
    base = category_base(cfg, scope)
    src = os.path.join(base, OLD)
    dst = os.path.join(base, NEW)

    notes = glob.glob(os.path.join(src, '*', 'notes.md'))
    active = load_json(ACTIVE, {})
    alive_ids = {d['sessionId'] for f in glob.glob(os.path.join(SESSIONS, '*.json'))
                 for d in [load_json(f, {})] if d.get('sessionId') and alive(d.get('pid'))}
    entries = [sid for sid, e in active.items() if e.get('category') == OLD]
    running = [sid for sid in entries if sid in alive_ids]

    print(f"Rename category:  {OLD}  →  {NEW}   (scope: {scope})")
    print(f"  Folder:                 {src}  →  {dst}")
    print(f"  notes.md to re-tag:     {len(notes)}")
    print(f"  active-sessions update: {len(entries)}")
    print(f"  RUNNING in this cat:    {len(running)}" + (f"   ⚠️  {running}" if running else ""))
    if not os.path.isdir(src):
        print(f"  note: {src} does not exist — only the config entry will be renamed")
    if os.path.isdir(src) and os.path.exists(dst):
        print(f"  ⚠️  destination exists — --apply will ABORT to avoid clobbering")

    if mode != '--apply':
        print("\nPlan only — no changes made. Re-run with --apply to execute.")
        return

    # ---------------- APPLY ----------------
    if os.path.isdir(src):
        if os.path.exists(dst):
            print(f"ABORT: {dst} already exists")
            sys.exit(1)
        shutil.move(src, dst)
        print(f"✓ moved folder → {dst}")
        retagged = 0
        for nf in glob.glob(os.path.join(dst, '*', 'notes.md')):
            try:
                c = open(nf).read()
                m = re.match(r'^(---\n.*?\n---)', c, re.S)
                if not m:
                    continue
                fm = m.group(1)
                fm2 = re.sub(r'(?m)^category:[ \t]*.*$', f'category: {NEW}', fm, count=1)
                if fm2 != fm:
                    open(nf, 'w').write(fm2 + c[len(fm):])
                    retagged += 1
            except Exception as e:
                print(f"  ! could not re-tag {nf}: {e}")
        print(f"✓ re-tagged {retagged} notes.md frontmatter")

    changed = 0
    for sid, e in active.items():
        touched = False
        if e.get('category') == OLD:
            e['category'] = NEW
            touched = True
        np = e.get('notes_path')
        if np and np.startswith(src + os.sep):
            e['notes_path'] = dst + np[len(src):]
            touched = True
        changed += 1 if touched else 0
    if changed:
        atomic_write(ACTIVE, active)
    print(f"✓ updated {changed} active-sessions entry(ies)")

    cat['name'] = NEW
    atomic_write(CONFIG, cfg)
    print(f"✓ renamed in config")
    print(f"\nDone — '{OLD}' is now '{NEW}'. The dashboard picks it up on its next 5s poll.")


main()
