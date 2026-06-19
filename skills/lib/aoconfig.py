#!/usr/bin/env python3
"""Config helper for the bundled session skills.

Reads the shared config the dashboard app writes:
  ~/.config/ai-agents-orchestrator/config.json
so the skills and the app agree on categories, note locations, and Obsidian vaults.

Subcommands:
  categories        → newline-separated list of category names
  scope    <CAT>    → 'work' | 'personal' (default 'work' if unknown)
  base     <CAT>    → absolute base dir for a category
                      (work → workRoot/<CAT>'s parent; personal → personalRoot)
  dir      <CAT> <SLUG> → absolute workspace dir = base/<SLUG>
  vault    <CAT>    → Obsidian vault path for the category's scope, or '' if
                      Obsidian is disabled / no vault set for that scope
  find     <SLUG>   → newline-separated notes.md paths matching <SLUG> across all
                      category bases (for /restart, /close, /archive lookups)
"""
import json
import os
import sys

HOME = os.path.expanduser('~')
CONFIG = os.path.join(HOME, '.config', 'ai-agents-orchestrator', 'config.json')
DEFAULT_CATEGORIES = ['FEAT', 'BUG', 'REVIEW', 'CHORE', 'TEST', 'PERSO']


def expand(p):
    if not isinstance(p, str):
        return p
    if p == '~':
        return HOME
    if p.startswith('~/'):
        return os.path.join(HOME, p[2:])
    return p


def load():
    try:
        with open(CONFIG) as f:
            return json.load(f)
    except Exception:
        return {}


def categories(cfg):
    return [c for c in cfg.get('categories', []) if isinstance(c, dict) and c.get('name')]


def category_names(cfg):
    return [c['name'] for c in categories(cfg)] or list(DEFAULT_CATEGORIES)


def scope_of(cfg, name):
    for c in categories(cfg):
        if c.get('name') == name:
            return c.get('scope', 'work')
    return 'work'


def base_for(cfg, name):
    # Matches the app's scanDirs: <root>/<CATEGORY>. Sessions live one level deeper.
    if scope_of(cfg, name) == 'personal':
        root = expand(cfg.get('personalRoot') or HOME)
    else:
        root = expand(cfg.get('workRoot') or os.path.join(HOME, 'work'))
    return os.path.join(root, name)


def vault_for(cfg, name):
    obs = cfg.get('obsidian') or {}
    if not obs.get('enabled'):
        return ''
    key = 'personalVaultPath' if scope_of(cfg, name) == 'personal' else 'workVaultPath'
    return expand(obs.get(key) or obs.get('vaultPath') or '')


def find_notes(cfg, slug):
    out, seen = [], set()
    for c in categories(cfg) or [{'name': n} for n in DEFAULT_CATEGORIES]:
        p = os.path.join(base_for(cfg, c['name']), slug, 'notes.md')
        if p not in seen and os.path.isfile(p):
            out.append(p)
            seen.add(p)
    return out


def main():
    args = sys.argv[1:]
    cfg = load()
    if not args:
        print("usage: aoconfig.py categories|scope|base|dir|vault|find [args]")
        return
    cmd = args[0]
    if cmd == 'categories':
        print('\n'.join(category_names(cfg)))
    elif cmd == 'find' and len(args) >= 2:
        print('\n'.join(find_notes(cfg, args[1])))
    elif cmd in ('scope', 'base', 'vault') and len(args) >= 2:
        cat = args[1]
        print({'scope': scope_of, 'base': base_for, 'vault': vault_for}[cmd](cfg, cat))
    elif cmd == 'dir' and len(args) >= 3:
        print(os.path.join(base_for(cfg, args[1]), args[2]))
    else:
        print(f"bad usage for '{cmd}'", file=sys.stderr)
        sys.exit(1)


main()
