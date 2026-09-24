#!/usr/bin/env python3
"""Keep only the pull requests that are the user's: opened by them, or reviewed by them.

A session's PR list used to take any PR whose branch named one of its tickets, or whose URL
came up in the conversation, so a colleague's backport showed up in the user's session
because it shared a ticket. "Mine" is any account `gh` is logged in with, since the user
may have a work and a personal account on the same machine.

    pr_mine.py keep [--keep-unknown] [--protect <url>]... <url>...

Prints the URLs to keep, one per line, in their given order. A --protect URL is kept
whoever wrote it: the PR link a REVIEW session was created with is the user's by choice.
A PR that no account can read is dropped, unless --keep-unknown: a new link is attached
only once proven, an existing one is removed only once proven.
"""

import json
import os
import re
import subprocess
import sys


def is_mine(pr, logins):
    author = ((pr.get("author") or {}).get("login") or "").lower()
    reviewers = {((r.get("author") or {}).get("login") or "").lower() for r in pr.get("reviews") or []}
    return author in logins or bool(reviewers & logins)


def logins_from_status(status):
    return {m.lower() for m in re.findall(r"Logged in to \S+ account (\S+)", status)}


def keep(urls, logins, fetch, protect=(), keep_unknown=False):
    kept = []
    for url in urls:
        if url in protect:
            kept.append(url)
            continue
        pr = fetch(url)
        if pr is None:
            if keep_unknown:
                kept.append(url)
        elif is_mine(pr, logins):
            kept.append(url)
    return kept


def _gh(args, token=None):
    env = dict(os.environ)
    if token:
        env["GH_TOKEN"] = token
    return subprocess.run(["gh", *args], capture_output=True, text=True, env=env, stdin=subprocess.DEVNULL)


def _accounts():
    out = _gh(["auth", "status"])
    return re.findall(r"Logged in to \S+ account (\S+)", out.stdout + out.stderr)


def _fetcher(accounts):
    tokens = [_gh(["auth", "token", "--user", a]).stdout.strip() for a in accounts] or [None]

    def fetch(url):
        # A private repo is readable by one account only, so try each in turn.
        for token in tokens:
            res = _gh(["pr", "view", url, "--json", "author,reviews"], token or None)
            if res.returncode == 0:
                return json.loads(res.stdout)
        return None

    return fetch


def main(argv):
    if not argv or argv[0] != "keep":
        print(__doc__, file=sys.stderr)
        return 2
    args, protect, keep_unknown, urls = argv[1:], set(), False, []
    while args:
        a = args.pop(0)
        if a == "--keep-unknown":
            keep_unknown = True
        elif a == "--protect" and args:
            protect.add(args.pop(0))
        else:
            urls.append(a)
    accounts = _accounts()
    logins = {a.lower() for a in accounts}
    for url in keep(urls, logins, _fetcher(accounts), protect, keep_unknown):
        print(url)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
