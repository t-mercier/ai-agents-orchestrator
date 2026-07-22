# Recent · unmanaged section + Adopt — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a collapsible, lazy-loaded "Recent · unmanaged" section at the top of the Running tab that lists recently-active unmanaged Claude Code sessions with a per-row **Adopt** action (which reuses the existing Import modal).

**Architecture:** Reuse the existing `discover_sessions()` (Rust) and `import_session()` (Rust) — no new Tauri commands. A new UMD renderer module `renderer/unmanaged.js` holds the pure model + HTML builder (jest-testable); `app.js` wires the section into the DOM off the 5-second poll path (rendered only on expand / refresh / view-switch / adopt). Adopt calls `openImportModal()` pre-selected on the clicked session.

**Tech Stack:** Rust (Tauri v2 backend, `cargo test`), vanilla-JS renderer with UMD modules (`window.CSM*` / `module.exports`), jest.

## Global Constraints

- **Git author MUST be the perso identity** `t-mercier <timothee@mercier.app>` (already the local `user.name`/`user.email`). Never the work account.
- **Run/verify the app from the MAIN checkout**, not a worktree (the gitignored `renderer/xterm-bundle.js` isn't copied to worktrees → renderer breaks). Edits/builds in a worktree are fine; running is not.
- **Renderer modules use the UMD pattern** (see `renderer/lib/formatters.js:1-7`): `(function(root, factory){ const api = factory(); if (module?.exports) module.exports = api; else root.CSMX = api })(...)`.
- **Zero poll cost is a hard requirement**: the section must NOT run `discoverSessions()` on the 5-second poll. `renderAll()`/`renderPanelList()`/`renderCardsGrid()` must never touch the unmanaged section or trigger discovery.
- **Never edit the user's global `~/.claude/settings.json`.** Not relevant to this feature but a standing rule.
- **Baseline test count:** 73 Rust + 65 jest = 138. This plan adds tests; the total must only grow and stay green.
- **Label copy:** the section title is exactly `Recent · unmanaged`. The default adopt name is the basename of the session's `cwd`.

---

### Task 1: Rust — extract `select_unmanaged` helper + tests

Extract the exclude-managed + skip + sort-newest + cap-30 logic out of `discover_sessions()` into a pure, unit-testable helper.

**Files:**
- Modify: `src-tauri/src/reader.rs:391-439` (`discover_sessions`)
- Test: `src-tauri/src/reader.rs` (inline `#[cfg(test)]` module, alongside the existing reader tests around line 1361)

**Interfaces:**
- Produces: `fn select_unmanaged(rows: Vec<(u64, String, Option<String>, Option<String>, bool)>, managed: &std::collections::HashSet<String>) -> Vec<serde_json::Value>` — rows are `(mtime, sessionId, title, cwd, skip)`; returns JSON objects `{sessionId, title, cwd, mtime}`, managed/skip excluded, newest-first, capped to 30.

- [ ] **Step 1: Write the failing test**

Add this test inside the existing `#[cfg(test)] mod tests { ... }` block in `reader.rs` (near `discover_meta_lines_*`):

```rust
#[test]
fn select_unmanaged_excludes_managed_skips_and_caps_at_30() {
    use std::collections::HashSet;
    let mut managed = HashSet::new();
    managed.insert("managed-1".to_string());

    // 32 candidate rows with ascending mtime; two are special-cased.
    let mut rows: Vec<(u64, String, Option<String>, Option<String>, bool)> = Vec::new();
    for i in 0..32u64 {
        rows.push((i, format!("sid-{i}"), Some(format!("title {i}")), Some("/tmp/x".into()), false));
    }
    rows.push((999, "managed-1".to_string(), Some("m".into()), Some("/tmp".into()), false)); // managed → dropped
    rows.push((998, "skipme".to_string(), Some("s".into()), Some("/tmp".into()), true));      // skip=true → dropped

    let out = select_unmanaged(rows, &managed);

    // Managed + skipped are gone; result capped to 30.
    assert_eq!(out.len(), 30);
    let ids: Vec<&str> = out.iter().map(|v| v["sessionId"].as_str().unwrap()).collect();
    assert!(!ids.contains(&"managed-1"));
    assert!(!ids.contains(&"skipme"));
    // Newest first: the highest surviving mtime (sid-31) leads.
    assert_eq!(out[0]["sessionId"], "sid-31");
    assert_eq!(out[0]["title"], "title 31");
    assert_eq!(out[0]["mtime"], 31);
    // Cap drops the 2 oldest survivors (sid-0, sid-1).
    assert!(!ids.contains(&"sid-0"));
    assert!(!ids.contains(&"sid-1"));
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd src-tauri && cargo test select_unmanaged_excludes_managed_skips_and_caps_at_30`
Expected: FAIL to compile — `cannot find function 'select_unmanaged' in this scope`.

- [ ] **Step 3: Add the helper and delegate from `discover_sessions`**

Add the helper just above `discover_sessions` (before line 391), keeping the existing doc-comment on `discover_sessions`:

```rust
/// Pure core of `discover_sessions`: drop managed and skip=true rows, sort newest-first
/// by mtime, cap to the 30 newest. Rows are (mtime, sessionId, title, cwd, skip).
fn select_unmanaged(
    rows: Vec<(u64, String, Option<String>, Option<String>, bool)>,
    managed: &std::collections::HashSet<String>,
) -> Vec<Value> {
    let mut kept: Vec<(u64, Value)> = rows
        .into_iter()
        .filter(|(_, sid, _, _, skip)| !skip && !managed.contains(sid))
        .map(|(mtime, sid, title, cwd, _)| {
            (mtime, json!({ "sessionId": sid, "title": title, "cwd": cwd, "mtime": mtime }))
        })
        .collect();
    kept.sort_by_key(|(mtime, _)| std::cmp::Reverse(*mtime));
    kept.into_iter().take(30).map(|(_, v)| v).collect()
}
```

Then rewrite the body of `discover_sessions` to collect raw rows and delegate. Replace the current `rows` accumulation + tail (lines 395-438) so the loop pushes tuples and the function ends by calling the helper:

```rust
    let projects = home().join(".claude").join("projects");
    let managed = managed_session_ids();
    let mut rows: Vec<(u64, String, Option<String>, Option<String>, bool)> = Vec::new();
    let dirs = match fs::read_dir(&projects) {
        Ok(d) => d,
        Err(_) => return Vec::new(),
    };
    for d in dirs.flatten() {
        let pdir = d.path();
        if !pdir.is_dir() {
            continue;
        }
        let files = match fs::read_dir(&pdir) {
            Ok(f) => f,
            Err(_) => continue,
        };
        for f in files.flatten() {
            let path = f.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let sid = match path.file_stem().and_then(|s| s.to_str()) {
                Some(s) => s.to_string(),
                None => continue,
            };
            let mtime = fs::metadata(&path)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|m| m.duration_since(SystemTime::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let (title, cwd, skip) = discover_meta(&path);
            rows.push((mtime, sid, title, cwd, skip));
        }
    }
    select_unmanaged(rows, &managed)
```

Note: the managed/skip filtering now lives in the helper, so the inline `if managed.contains(&sid) { continue; }` and `if skip { continue; }` are removed (they moved into `select_unmanaged`). `discover_meta` is still called per file to compute title/cwd/skip.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd src-tauri && cargo test select_unmanaged_excludes_managed_skips_and_caps_at_30`
Expected: PASS.

- [ ] **Step 5: Run the full Rust suite (no regressions)**

Run: `cd src-tauri && cargo test`
Expected: all green, count = previous + 1.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/reader.rs
git commit -m "refactor(reader): extract testable select_unmanaged from discover_sessions"
```

---

### Task 2: `renderer/unmanaged.js` — pure model + HTML builder + jest tests

A new UMD module with two pure functions and a `basename` helper. No DOM, no state — all wiring lives in `app.js` (Task 3).

**Files:**
- Create: `renderer/unmanaged.js`
- Create: `__tests__/unmanaged.test.js`
- Modify: `renderer/index.html:506` (add `<script src="unmanaged.js"></script>` right after `ui.js`)

**Interfaces:**
- Produces (on `window.CSMUnmanaged` / `module.exports`):
  - `basename(p: string) -> string` — last path segment (trailing slash tolerated); `''` for empty.
  - `buildUnmanagedModel(sessions: Array<{sessionId,title,cwd,mtime}>, now?: number) -> { empty: boolean, rows: Array<{sessionId,title,cwd,when,defaultName}> }` — `when` is a relative time string; `defaultName` is `basename(cwd)`.
  - `unmanagedSectionHtml(state: {expanded:boolean, loading:boolean, error:string, model:object|null}) -> string` — full section HTML (header + body). Escapes all interpolated text.

- [ ] **Step 1: Write the failing test**

Create `__tests__/unmanaged.test.js`:

```javascript
const U = require('../renderer/unmanaged')

const NOW = new Date('2026-07-22T12:00:00Z').getTime()

describe('basename', () => {
  it('returns the last path segment', () => expect(U.basename('/Users/x/my-repo')).toBe('my-repo'))
  it('tolerates a trailing slash', () => expect(U.basename('/Users/x/my-repo/')).toBe('my-repo'))
  it('handles empty', () => expect(U.basename('')).toBe(''))
})

describe('buildUnmanagedModel', () => {
  it('maps rows with relative time + default name', () => {
    const mtime = Math.floor(new Date('2026-07-22T10:00:00Z').getTime() / 1000) // 2h before NOW
    const m = U.buildUnmanagedModel([{ sessionId: 'a', title: 'Fix bug', cwd: '/Users/x/my-repo', mtime }], NOW)
    expect(m.empty).toBe(false)
    expect(m.rows).toHaveLength(1)
    expect(m.rows[0]).toMatchObject({ sessionId: 'a', title: 'Fix bug', cwd: '/Users/x/my-repo', defaultName: 'my-repo' })
    expect(m.rows[0].when).toBe('2h ago')
  })
  it('falls back to "(untitled session)" and empty defaultName', () => {
    const m = U.buildUnmanagedModel([{ sessionId: 'b', title: '', cwd: '', mtime: 0 }], NOW)
    expect(m.rows[0].title).toBe('(untitled session)')
    expect(m.rows[0].defaultName).toBe('')
  })
  it('reports empty for no sessions', () => {
    expect(U.buildUnmanagedModel([], NOW)).toEqual({ empty: true, rows: [] })
  })
})

describe('unmanagedSectionHtml', () => {
  it('shows the loading state when expanded + loading', () => {
    const html = U.unmanagedSectionHtml({ expanded: true, loading: true, error: '', model: null })
    expect(html).toContain('Recent · unmanaged')
    expect(html).toContain('Loading')
  })
  it('shows the empty state', () => {
    const html = U.unmanagedSectionHtml({ expanded: true, loading: false, error: '', model: { empty: true, rows: [] } })
    expect(html).toContain('No unmanaged sessions')
  })
  it('renders a row with an Adopt button carrying sid + default name', () => {
    const model = { empty: false, rows: [{ sessionId: 'a', title: 'Fix bug', cwd: '/Users/x/my-repo', when: '2h ago', defaultName: 'my-repo' }] }
    const html = U.unmanagedSectionHtml({ expanded: true, loading: false, error: '', model })
    expect(html).toContain('data-adopt-sid="a"')
    expect(html).toContain('data-adopt-name="my-repo"')
    expect(html).toContain('Adopt')
  })
  it('escapes interpolated text', () => {
    const model = { empty: false, rows: [{ sessionId: 'a', title: '<img src=x>', cwd: '/x', when: '', defaultName: 'x' }] }
    const html = U.unmanagedSectionHtml({ expanded: true, loading: false, error: '', model })
    expect(html).not.toContain('<img src=x>')
    expect(html).toContain('&lt;img')
  })
  it('shows the error state with a retry control', () => {
    const html = U.unmanagedSectionHtml({ expanded: true, loading: false, error: 'boom', model: null })
    expect(html).toContain('boom')
    expect(html).toContain('data-unmanaged-refresh')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest unmanaged`
Expected: FAIL — `Cannot find module '../renderer/unmanaged'`.

- [ ] **Step 3: Create the module**

Create `renderer/unmanaged.js`:

```javascript
// "Recent · unmanaged" section — pure model + HTML builder. UMD: usable as a
// <script> in the renderer (window.CSMUnmanaged) and via require() in jest.
// No DOM, no state — app.js owns the wiring + discovery.
(function (root, factory) {
  const F = (typeof module !== 'undefined' && module.exports)
    ? require('./lib/formatters')
    : root.CSMFormatters
  const api = factory(F)
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.CSMUnmanaged = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (F) {
  const esc = F.escapeHtml

  function basename(p) {
    if (!p) return ''
    const parts = String(p).replace(/\/+$/, '').split('/')
    return parts[parts.length - 1] || ''
  }

  function buildUnmanagedModel(sessions, now) {
    const list = Array.isArray(sessions) ? sessions : []
    if (!list.length) return { empty: true, rows: [] }
    const rows = list.map(s => ({
      sessionId: s.sessionId,
      title: s.title || '(untitled session)',
      cwd: s.cwd || '',
      when: s.mtime ? F.formatTimestamp(new Date(s.mtime * 1000).toISOString(), now) : '',
      defaultName: basename(s.cwd || ''),
    }))
    return { empty: false, rows }
  }

  function rowHtml(r) {
    const tip = `${esc(r.title)}${r.cwd ? '\n' + esc(r.cwd) : ''}`
    return `<div class="unmanaged-row" title="${tip}">
      <div class="unmanaged-row-text">
        <span class="unmanaged-row-title">${esc(r.title)}</span>
        <span class="unmanaged-row-meta">${esc(r.cwd)}${r.when ? ' · ' + esc(r.when) : ''}</span>
      </div>
      <button type="button" class="unmanaged-adopt" data-adopt-sid="${esc(r.sessionId)}" data-adopt-name="${esc(r.defaultName)}">Adopt</button>
    </div>`
  }

  function bodyHtml(state) {
    if (state.loading) return `<div class="unmanaged-empty">Loading…</div>`
    if (state.error) return `<div class="unmanaged-error">${esc(state.error)} <button type="button" class="unmanaged-retry" data-unmanaged-refresh>↻ Retry</button></div>`
    const model = state.model
    if (!model || model.empty) return `<div class="unmanaged-empty">No unmanaged sessions.</div>`
    return model.rows.map(rowHtml).join('')
  }

  function unmanagedSectionHtml(state) {
    const collapsed = !state.expanded
    const body = state.expanded ? `<div class="unmanaged-body">${bodyHtml(state)}</div>` : ''
    return `<div class="unmanaged-group">
      <div class="unmanaged-header" data-unmanaged-toggle>
        <span class="category-chevron ${collapsed ? 'collapsed' : ''}">›</span>
        <span class="unmanaged-name">Recent · unmanaged</span>
        <button type="button" class="unmanaged-refresh" data-unmanaged-refresh title="Rescan" aria-label="Rescan">↻</button>
      </div>
      ${body}
    </div>`
  }

  return { basename, buildUnmanagedModel, unmanagedSectionHtml }
})
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest unmanaged`
Expected: PASS (all cases).

- [ ] **Step 5: Wire the script tag**

In `renderer/index.html`, add after the `ui.js` include (line 506):

```html
  <script src="ui.js"></script>
  <script src="unmanaged.js"></script>
```

(Placed after `formatters.js`/`ui.js` so `window.CSMFormatters` exists when the browser evaluates it; app.js at line 508 loads later and consumes `window.CSMUnmanaged`.)

- [ ] **Step 6: Run the full jest suite (no regressions)**

Run: `npx jest`
Expected: all green, count = previous + the new `unmanaged` tests.

- [ ] **Step 7: Commit**

```bash
git add renderer/unmanaged.js __tests__/unmanaged.test.js renderer/index.html
git commit -m "feat(unmanaged): pure model + HTML builder for the Recent·unmanaged section"
```

---

### Task 3: Wire the section into the DOM, off the poll path

Add the two containers, render the section on expand / refresh / view-switch / tab-switch (never on the poll), and run discovery lazily on first expand.

**Files:**
- Modify: `renderer/index.html` (add a container above `#panel-list` at line 440 and above `#cards-grid` at line 455)
- Modify: `renderer/app.js` (state + render fn + delegated toggle/refresh handlers + calls from `switchTab`/`setViewMode`/init)
- Modify: `renderer/style.css` (section styling)

**Interfaces:**
- Consumes: `window.CSMUnmanaged.{buildUnmanagedModel, unmanagedSectionHtml}` (Task 2); `window.api.discoverSessions()` (existing).
- Produces: `window.refreshUnmanaged()` — re-runs discovery + re-renders (used by Task 4 after adopt).

- [ ] **Step 1: Add the containers**

In `renderer/index.html`, above `<div class="panel-list" id="panel-list"></div>` (line 440):

```html
      <div class="unmanaged-section" hidden></div>
      <div class="panel-list" id="panel-list"></div>
```

And above `<div class="cards-grid" id="cards-grid"></div>` (line 455):

```html
          <div class="unmanaged-section" hidden></div>
          <div class="cards-grid" id="cards-grid"></div>
```

- [ ] **Step 2: Add state + render function in app.js**

Near the top of `app.js` (after `let activeTab = 'running'` at line 3), add:

```javascript
// "Recent · unmanaged" section state. Discovery is lazy (on first expand) and NEVER
// runs on the 5s poll — renderUnmanagedSection is called only from expand / refresh /
// tab-switch / view-switch, so hundreds of on-disk sessions never inflate the poll.
let unmanagedState = { expanded: false, loading: false, error: '', model: null, loaded: false }

function renderUnmanagedSection() {
  const show = activeTab === 'running'
  const html = window.CSMUnmanaged.unmanagedSectionHtml(unmanagedState)
  document.querySelectorAll('.unmanaged-section').forEach(el => {
    el.hidden = !show
    if (show) el.innerHTML = html
  })
}

async function loadUnmanaged() {
  unmanagedState.loading = true
  unmanagedState.error = ''
  renderUnmanagedSection()
  try {
    const sessions = await window.api.discoverSessions()
    unmanagedState.model = window.CSMUnmanaged.buildUnmanagedModel(sessions)
    unmanagedState.loaded = true
  } catch (_) {
    unmanagedState.error = 'Could not scan recent sessions.'
    unmanagedState.model = null
  }
  unmanagedState.loading = false
  renderUnmanagedSection()
}

// Re-run discovery + re-render. Exposed for Task 4 (refresh after an adopt).
window.refreshUnmanaged = function () {
  if (unmanagedState.expanded) loadUnmanaged()
  else { unmanagedState.loaded = false; unmanagedState.model = null }
}
```

- [ ] **Step 3: Add delegated toggle + refresh handlers**

The app installs one delegated click handler on `<body>` (see `ui.js:925`). Add these handlers in app.js's existing body-level click delegation (find where other `data-*` clicks are handled in app.js; if app.js has no body listener, add one). Add near the other delegated handlers:

```javascript
document.body.addEventListener('click', (e) => {
  // Toggle expand/collapse (ignore clicks on the refresh button inside the header).
  const toggle = e.target.closest('[data-unmanaged-toggle]')
  if (toggle && !e.target.closest('[data-unmanaged-refresh]')) {
    unmanagedState.expanded = !unmanagedState.expanded
    if (unmanagedState.expanded && !unmanagedState.loaded && !unmanagedState.loading) loadUnmanaged()
    else renderUnmanagedSection()
    return
  }
  // Refresh / retry (rescan).
  if (e.target.closest('[data-unmanaged-refresh]')) {
    e.stopPropagation()
    unmanagedState.expanded = true
    loadUnmanaged()
    return
  }
})
```

- [ ] **Step 4: Render the section on tab-switch, view-switch, and init**

In `switchTab` (app.js:410) add `renderUnmanagedSection()` as the last line of the function so switching to/from Running shows/hides it. In `setViewMode` (find the function that toggles `mode-cards`) add `renderUnmanagedSection()` at the end so the freshly-shown view's container gets the section. At the end of the app's init/boot (near where `refreshUsage()` is first called, app.js:1192) add one call:

```javascript
renderUnmanagedSection()   // initial: header present (collapsed), no discovery yet
```

- [ ] **Step 5: Add CSS**

Append to `renderer/style.css` (theme-aware — reuse the `--tint`/text vars like the rest of the app; do NOT hardcode rgb):

```css
/* Recent · unmanaged section */
.unmanaged-section { margin-bottom: 6px; }
.unmanaged-group { border-bottom: 1px solid rgba(var(--tint), 0.08); }
.unmanaged-header { display: flex; align-items: center; gap: 6px; padding: 6px 10px; cursor: pointer; user-select: none; }
.unmanaged-name { font-size: 12px; font-weight: 600; color: rgba(var(--tint), 0.62); flex: 1; }
.unmanaged-refresh { background: none; border: none; color: rgba(var(--tint), 0.48); cursor: pointer; font-size: 13px; line-height: 1; padding: 2px 4px; }
.unmanaged-refresh:hover { color: rgba(var(--tint), 0.92); }
.unmanaged-body { padding: 2px 0 6px; }
.unmanaged-row { display: flex; align-items: center; gap: 8px; padding: 5px 10px; }
.unmanaged-row-text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.unmanaged-row-title { font-size: 12px; color: rgba(var(--tint), 0.92); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.unmanaged-row-meta { font-size: 11px; color: rgba(var(--tint), 0.48); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.unmanaged-adopt { flex: none; font-size: 11px; padding: 3px 10px; border-radius: 6px; border: 1px solid rgba(var(--tint), 0.18); background: none; color: rgba(var(--tint), 0.92); cursor: pointer; }
.unmanaged-adopt:hover { background: rgba(var(--tint), 0.08); }
.unmanaged-empty, .unmanaged-error { font-size: 11px; color: rgba(var(--tint), 0.48); padding: 5px 10px; }
.unmanaged-retry { background: none; border: none; color: rgba(var(--tint), 0.62); cursor: pointer; text-decoration: underline; }
```

- [ ] **Step 6: Manual verification (run from MAIN checkout)**

Run: `cargo tauri dev` (or reuse the running app + refresh). Verify:
- Running tab shows a collapsed "Recent · unmanaged" header; Closed/Archived tabs do NOT show it.
- Expanding runs discovery once (header rows appear, or "No unmanaged sessions.").
- The ↻ button re-scans without toggling collapse.
- Switching to Cards view still shows the section above the grid.
- Watch it for ~15s expanded: it must NOT re-fetch on the 5s poll (no flicker; discovery only on expand/↻). Confirm via devtools Network/console if needed.

- [ ] **Step 7: Run both suites + commit**

Run: `cd src-tauri && cargo test` then `cd .. && npx jest` — both green.

```bash
git add renderer/index.html renderer/app.js renderer/style.css
git commit -m "feat(unmanaged): wire the Recent·unmanaged section into Running (lazy, off-poll)"
```

---

### Task 4: Adopt — preselect the Import modal + refresh after adopt

Make `openImportModal()` accept an optional pre-selected session, wire the per-row **Adopt** button to it, and refresh the section after a successful import so the adopted row disappears.

**Files:**
- Modify: `renderer/app.js:703-720` (`openImportModal`)
- Modify: `renderer/app.js` (the `import-go` success path around line 774; add a body-delegated Adopt handler)

**Interfaces:**
- Consumes: `openImportModal({preselectSessionId, defaultName})`; `window.refreshUnmanaged()` (Task 3).

- [ ] **Step 1: Make `openImportModal` accept a preselect option**

Change the signature and pre-selection logic. Replace `async function openImportModal() {` (line 703) with:

```javascript
async function openImportModal(opts) {
  const preselectSessionId = opts && opts.preselectSessionId
  const defaultName = (opts && opts.defaultName) || ''
  importSelectedSid = preselectSessionId || null
  importSessions = []
  document.getElementById('import-search').value = ''
  document.getElementById('import-uid').value = ''
  document.getElementById('import-name').value = defaultName
  hideImportError()
  populateImportCategories()
  const destEl = document.getElementById('import-dest')
  if (destEl && window.destinationToggle) destEl.innerHTML = window.destinationToggle()
  const goBtn = document.getElementById('import-go')
  goBtn.disabled = !importSelectedSid
  document.getElementById('import-list').innerHTML = '<div class="import-empty">Loading…</div>'
  importModal.showModal()
  try { importSessions = await window.api.discoverSessions() } catch (_) { importSessions = [] }
  renderImportList('')
  updateImportGo()
}
```

(`renderImportList` already marks the row whose `sessionId === importSelectedSid` as `.selected` — so the pre-selected session shows selected. `updateImportGo` re-confirms the Go button.)

The existing button wiring at line 721 passes a click event as the first arg; change it to ignore it:

```javascript
document.getElementById('import-session-btn').addEventListener('click', () => openImportModal())
```

- [ ] **Step 2: Add the Adopt-button delegated handler**

Add to the body click delegation (alongside the Task 3 handlers) in app.js:

```javascript
document.body.addEventListener('click', (e) => {
  const adopt = e.target.closest('[data-adopt-sid]')
  if (!adopt) return
  openImportModal({ preselectSessionId: adopt.dataset.adoptSid, defaultName: adopt.dataset.adoptName || '' })
})
```

- [ ] **Step 3: Refresh the section after a successful import**

In the `import-go` click handler, right after `importModal.close()` (line 774), add:

```javascript
  importModal.close()
  if (window.refreshUnmanaged) window.refreshUnmanaged()
```

This re-runs discovery (if the section is expanded) so the now-managed session drops off; if collapsed, it just invalidates the cache so the next expand re-scans.

- [ ] **Step 4: Manual verification (run from MAIN checkout)**

Verify:
- Clicking **Adopt** on a row opens the Import modal with that session pre-selected (row highlighted) and the name pre-filled with the cwd basename; category/space pickers + the embedded/terminal toggle work as before.
- Confirming adopts: the session opens (embedded or external per the toggle) and becomes managed; on the next section rescan the adopted row is gone.
- The top **＋ Import** button still opens the modal empty (no preselect).

- [ ] **Step 5: Run both suites + commit**

Run: `cd src-tauri && cargo test` then `cd .. && npx jest` — both green (138 + new tests).

```bash
git add renderer/app.js
git commit -m "feat(unmanaged): Adopt reuses the Import modal preselected; refresh after adopt"
```

---

## Self-Review

**Spec coverage:**
- Backend reuse (no new commands) → Task 1 keeps `discover_sessions`/`import_session`; only refactors internals. ✓
- New `renderer/unmanaged.js` (pure model + HTML) → Task 2. ✓
- Placement top of Running, list + cards, not Board; collapsed by default; header always present → Task 3 (containers above `#panel-list` and `#cards-grid`, gated by `activeTab==='running'`, collapsed initial state). ✓
- Lazy on expand + ↻ refresh, never on 5s poll → Task 3 (`loadUnmanaged` only from expand/refresh; poll functions untouched; Step 6 explicitly verifies no poll re-fetch). ✓
- Space-agnostic → the section is a sibling above the space/category groups, independent of the space filter. ✓
- Row content (title / cwd / relative mtime / Adopt) → Task 2 `rowHtml`. ✓
- Adopt-only, Adopt = open + register with terminal toggle, reuse modal preselected → Task 4. ✓
- Row leaves list after adopt → Task 4 Step 3 (`refreshUnmanaged`). ✓
- Error / empty / loading states → Task 2 `bodyHtml` + tests. ✓
- Testing (Rust exclude-managed + cap-30; jest model + Adopt wiring) → Task 1 + Task 2. ✓
- Out of scope (auto-refresh, count badge, dismiss, board, per-session context) → not implemented. ✓

**Placeholder scan:** No TBD/TODO; every code step has full code; commands have expected output. ✓

**Type consistency:** `select_unmanaged(rows, managed)` tuple `(u64,String,Option<String>,Option<String>,bool)` used identically in Task 1 test, helper, and `discover_sessions`. `buildUnmanagedModel`/`unmanagedSectionHtml`/`basename` names match across Task 2 module, its test, and Task 3 consumption. `window.refreshUnmanaged` defined in Task 3, consumed in Task 4. `data-adopt-sid`/`data-adopt-name` emitted in Task 2 `rowHtml`, read in Task 4 handler. ✓
