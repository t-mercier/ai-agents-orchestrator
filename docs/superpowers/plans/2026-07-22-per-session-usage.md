# Per-session usage bar (context % + model) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the footer usage bar's context % + model reflect the **selected session** (5h/7d stay account-global), by keying the statusline cache per `session_id`.

**Architecture:** The bundled `ao-statusline.sh` writes a keyed cache `{ global, sessions: { <id>: … } }`; a pure Rust helper `usage_view(cache, session_id)` merges global rate-limits with the requested session's model+context (tolerating the legacy flat shape); `get_usage(session_id)` exposes it; the renderer resolves the selected session's `sessionId`, passes it to `getUsage`, and refreshes on selection change.

**Tech Stack:** Rust (Tauri v2, `cargo test`), bash + embedded python (the wrapper), vanilla-JS renderer.

## Global Constraints

- **Git author** must be perso `t-mercier <timothee@mercier.app>` (already the local config). Do not touch git config.
- **Run/verify from the MAIN checkout**, not a worktree (gitignored `renderer/xterm-bundle.js`). Subagents verify with `cargo test` / `node --check` / `npx jest`; GUI verification is deferred to the controller.
- **5h/7d rate limits are account-global** — stored once under `global`, shown for every session. Only **context % + model** are per-session.
- **Never break the bar.** `get_usage` returns `Null`/partial on any missing/unreadable/invalid input; the wrapper's cache write is best-effort (`2>/dev/null || true`).
- **Backward compat:** tolerate the legacy flat cache `{model, fiveHourPct, sevenDayPct, contextPct, updatedAt, fiveHourResetsAt, sevenDayResetsAt}` — read its rate-limits as `global`; surface its model/context only when NO `session_id` is requested.
- **Graceful degradation:** if the statusLine input lacks `session_id`, the wrapper still writes `global`.
- The wrapper keeps the **merge-preserve** behavior (a render missing a field must not blank the stored value) and still **delegates** to the user's real statusline command (`$1`).
- Baseline tests: 74 Rust + 89 jest. Must only grow / stay green.

---

### Task 1: Rust — `usage_view` helper + `get_usage(session_id)` + tests

**Files:**
- Modify: `src-tauri/src/lib.rs` (add `usage_view`, change `get_usage` signature; `parse_usage` stays)
- Test: `src-tauri/src/lib.rs` (inline `#[cfg(test)]`)

**Interfaces:**
- Produces: `fn usage_view(cache: &serde_json::Value, session_id: Option<&str>) -> serde_json::Value` — merges `global` rate-limits with `sessions[session_id]` model+context; tolerates legacy flat. Returns `Null` when `cache` is not an object.
- `get_usage(session_id: Option<String>) -> Value` (Tauri command).

- [ ] **Step 1: Write the failing test**

Add inside the existing `#[cfg(test)] mod tests { ... }` in `lib.rs` (near the other `parse_usage`/usage helpers; if none, add a test module):

```rust
#[test]
fn usage_view_keyed_merges_global_and_session() {
    let cache = serde_json::json!({
        "global": { "fiveHourPct": 21, "sevenDayPct": 76, "fiveHourResetsAt": 1i64, "sevenDayResetsAt": 2i64, "updatedAt": 9i64 },
        "sessions": { "sid-1": { "model": "Opus 4.8", "contextPct": 42 } }
    });
    let v = usage_view(&cache, Some("sid-1"));
    assert_eq!(v["fiveHourPct"], 21);
    assert_eq!(v["sevenDayPct"], 76);
    assert_eq!(v["model"], "Opus 4.8");
    assert_eq!(v["contextPct"], 42);
}

#[test]
fn usage_view_keyed_unknown_session_has_null_model_context() {
    let cache = serde_json::json!({
        "global": { "fiveHourPct": 21 },
        "sessions": { "sid-1": { "model": "Opus 4.8", "contextPct": 42 } }
    });
    let v = usage_view(&cache, Some("other"));
    assert_eq!(v["fiveHourPct"], 21);
    assert!(v["model"].is_null());
    assert!(v["contextPct"].is_null());
}

#[test]
fn usage_view_legacy_flat_surfaces_model_only_without_session_id() {
    let cache = serde_json::json!({ "model": "Opus 4.8", "fiveHourPct": 5, "contextPct": 30 });
    // no session id → best-effort surface the flat model/context
    let none = usage_view(&cache, None);
    assert_eq!(none["fiveHourPct"], 5);
    assert_eq!(none["model"], "Opus 4.8");
    assert_eq!(none["contextPct"], 30);
    // a session id was requested but legacy has no per-session map → model/context null
    let with = usage_view(&cache, Some("sid-1"));
    assert_eq!(with["fiveHourPct"], 5);
    assert!(with["model"].is_null());
    assert!(with["contextPct"].is_null());
}

#[test]
fn usage_view_non_object_is_null() {
    assert!(usage_view(&serde_json::Value::Null, None).is_null());
    assert!(usage_view(&serde_json::json!("x"), Some("s")).is_null());
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd src-tauri && cargo test usage_view`
Expected: FAIL — `cannot find function 'usage_view'`.

- [ ] **Step 3: Add `usage_view` + rewrite `get_usage`**

Add `usage_view` just above `get_usage` (after `parse_usage`, ~line 970):

```rust
/// Build the renderer's usage payload from the cache. New keyed shape is
/// `{ global: {rate limits}, sessions: { <session_id>: {model, contextPct} } }`;
/// the legacy flat shape (all fields at top level) is tolerated. Rate limits always
/// come from `global` (or the flat root); model + contextPct come from the requested
/// session (or, for a legacy flat cache with no session requested, the flat root).
/// Returns Null when `cache` is not an object.
fn usage_view(cache: &Value, session_id: Option<&str>) -> Value {
    let obj = match cache.as_object() {
        Some(o) => o,
        None => return Value::Null,
    };
    let has_new = obj.contains_key("global") || obj.contains_key("sessions");
    let g = if has_new {
        obj.get("global").and_then(Value::as_object).cloned().unwrap_or_default()
    } else {
        obj.clone()
    };
    let mut out = serde_json::Map::new();
    for k in ["fiveHourPct", "sevenDayPct", "fiveHourResetsAt", "sevenDayResetsAt", "updatedAt"] {
        if let Some(v) = g.get(k) { out.insert(k.to_string(), v.clone()); }
    }
    // model + contextPct: from the session entry (new shape) or the flat root (legacy, no id).
    let (model, ctx) = if has_new {
        let s = session_id
            .and_then(|id| obj.get("sessions").and_then(Value::as_object).and_then(|m| m.get(id)))
            .and_then(Value::as_object);
        (s.and_then(|s| s.get("model")).cloned(),
         s.and_then(|s| s.get("contextPct")).cloned())
    } else if session_id.is_none() {
        (obj.get("model").cloned(), obj.get("contextPct").cloned())
    } else {
        (None, None)
    };
    out.insert("model".to_string(), model.unwrap_or(Value::Null));
    out.insert("contextPct".to_string(), ctx.unwrap_or(Value::Null));
    Value::Object(out)
}
```

Replace `get_usage` (lines 975-985) with:

```rust
#[tauri::command]
fn get_usage(session_id: Option<String>) -> Value {
    let cache_path = config::home()
        .join(".claude")
        .join("statusline-cache.json");
    let cache = match std::fs::read_to_string(&cache_path) {
        Ok(content) => parse_usage(&content),
        Err(_) => return Value::Null,
    };
    usage_view(&cache, session_id.as_deref())
}
```

(`get_usage` stays registered at `lib.rs:1152`; the arg is optional so an argless call still works.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test usage_view` → PASS. Then `cd src-tauri && cargo test` → all green (74 + 4).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(usage): usage_view helper + per-session get_usage(session_id), legacy-flat tolerant"
```

---

### Task 2: Wrapper — write a per-session keyed cache

**Files:**
- Modify: `scripts/ao-statusline.sh` (the embedded python that writes the cache)

**Interfaces:**
- Produces on disk: `~/.claude/statusline-cache.json` = `{ "global": {fiveHourPct, sevenDayPct, fiveHourResetsAt, sevenDayResetsAt, updatedAt}, "sessions": { "<session_id>": {model, contextPct, updatedAt} } }`.

- [ ] **Step 1: Rewrite the python block**

In `scripts/ao-statusline.sh`, keep the top (`set -u`, `INPUT="$(cat)"`, `CACHE=…`, the `AO_INPUT=… python3 - "$CACHE" … <<'PY'` invocation) and the trailing delegation to `$1` unchanged. Replace the python program body (from `import json…` through the `os.replace(tmp, p)` write) with:

```python
import json, os, sys, time
try:
    d = json.loads(os.environ.get("AO_INPUT", "{}"))
except Exception:
    sys.exit(0)
def num(v):
    try: return round(float(v))
    except Exception: return None
def dig(o, path):
    for k in path.split('.'):
        o = o.get(k) if isinstance(o, dict) else None
    return o
def parse_reset_time(val):
    if val is None: return None
    if isinstance(val, (int, float)):
        if val < 1e6:   return int((time.time() + val) * 1000)
        elif val < 1e10: return int(val * 1000)
        else:            return int(val)
    if isinstance(val, str):
        try:
            from datetime import datetime
            return int(datetime.fromisoformat(val.replace('Z', '+00:00')).timestamp() * 1000)
        except Exception:
            return None
    return None
def reset_for(rl, *keys):
    for key in keys:
        r = rl.get(key) if isinstance(rl, dict) else None
        if isinstance(r, dict):
            for rk in ["resets_at", "resets_in_seconds", "reset_at", "reset_time"]:
                p = parse_reset_time(r.get(rk))
                if p is not None: return p
    return None

# Load previous cache; migrate a legacy flat object into the keyed shape.
prev = {}
try:
    with open(sys.argv[1]) as f: prev = json.load(f)
    if not isinstance(prev, dict): prev = {}
except Exception:
    prev = {}
if "global" not in prev and "sessions" not in prev and prev:
    prev = {"global": {k: prev[k] for k in
            ("fiveHourPct","sevenDayPct","fiveHourResetsAt","sevenDayResetsAt","updatedAt") if k in prev},
            "sessions": {}}
g_prev = prev.get("global") if isinstance(prev.get("global"), dict) else {}
sessions = prev.get("sessions") if isinstance(prev.get("sessions"), dict) else {}

now = int(time.time() * 1000)
rl = dig(d, "rate_limits")
def keepg(newv, key): return newv if newv is not None else g_prev.get(key)
g = {
    "fiveHourPct": keepg(num(dig(d, "rate_limits.five_hour.used_percentage")), "fiveHourPct"),
    "sevenDayPct": keepg(num(dig(d, "rate_limits.seven_day.used_percentage")), "sevenDayPct"),
    "updatedAt": now,
}
fh = reset_for(rl, "five_hour", "five-hour")
sd = reset_for(rl, "seven_day", "seven-day")
fh = fh if fh is not None else g_prev.get("fiveHourResetsAt")
sd = sd if sd is not None else g_prev.get("sevenDayResetsAt")
if fh is not None: g["fiveHourResetsAt"] = fh
if sd is not None: g["sevenDayResetsAt"] = sd

# Per-session model + context (merge-preserve), keyed by session_id when present.
sid = dig(d, "session_id")
if isinstance(sid, str) and sid:
    s_prev = sessions.get(sid) if isinstance(sessions.get(sid), dict) else {}
    model = dig(d, "model.display_name") or s_prev.get("model")
    ctx = num(dig(d, "context_window.used_percentage"))
    ctx = ctx if ctx is not None else s_prev.get("contextPct")
    sessions[sid] = {"model": model, "contextPct": ctx, "updatedAt": now}

out = {"global": g, "sessions": sessions}
p = sys.argv[1]
tmp = p + ".tmp"
with open(tmp, "w") as f:
    json.dump(out, f)
os.replace(tmp, p)
```

The wrapper's leading comment block still mentions `statusline-cache.json` (keep it) — the Rust install test asserts that string is present in the embedded script.

- [ ] **Step 2: Sanity-check the wrapper locally**

The wrapper writes to `$HOME/.claude/statusline-cache.json`, so point `HOME` at a temp dir and pipe a fake statusline JSON through it:
```bash
TMP=$(mktemp -d); mkdir -p "$TMP/.claude"
printf '%s' '{"session_id":"sid-A","model":{"display_name":"Opus 4.8"},"context_window":{"used_percentage":42},"rate_limits":{"five_hour":{"used_percentage":21},"seven_day":{"used_percentage":76}}}' \
  | HOME="$TMP" bash scripts/ao-statusline.sh
python3 -m json.tool "$TMP/.claude/statusline-cache.json"
```
Expected: `global` has `fiveHourPct: 21`, `sevenDayPct: 76`, an `updatedAt`; `sessions."sid-A"` has `model: "Opus 4.8"`, `contextPct: 42`.

Then confirm **merge-preserve** — a second render WITHOUT `rate_limits` must keep the prior `fiveHourPct`/`sevenDayPct`:
```bash
printf '%s' '{"session_id":"sid-A","model":{"display_name":"Opus 4.8"},"context_window":{"used_percentage":55}}' \
  | HOME="$TMP" bash scripts/ao-statusline.sh
python3 -m json.tool "$TMP/.claude/statusline-cache.json"
```
Expected: `global.fiveHourPct` is still `21` (not blanked), `sessions."sid-A".contextPct` is now `55`. Clean up: `rm -rf "$TMP"`.

- [ ] **Step 3: Commit**

```bash
git add scripts/ao-statusline.sh
git commit -m "feat(usage): ao-statusline.sh writes a per-session keyed cache (global + sessions)"
```

---

### Task 3: Renderer — pass the selected session's id + refresh on selection change

**Files:**
- Modify: `renderer/lib/tauri-api.js` (`getUsage` passes `sessionId`)
- Modify: `renderer/app.js` (`refreshUsage` resolves the selected session's `sessionId`)
- Modify: `renderer/ui.js` (`renderAll` publishes `window._lastSessions`; `selectSession` already re-renders — add a usage refresh)

**Interfaces:**
- Consumes: `get_usage(session_id)` (Task 1). `sessionKey(s)` = `s.notesPath || s.sessionId || s.name || ''`.

- [ ] **Step 1: Pass `sessionId` through the IPC binding**

In `renderer/lib/tauri-api.js`, change line 117:
```javascript
    getUsage: (sessionId) => invoke('get_usage', { sessionId }).catch(() => null),
```
(Tauri v2 maps the camelCase `sessionId` arg to the Rust `session_id` param — this matches how the other commands in this file pass args; verify against an existing multi-arg binding such as `importSession` and follow the same casing convention.)

- [ ] **Step 2: Resolve the selected session's id in `refreshUsage`**

In `renderer/app.js`, at the top of `refreshUsage` (line 1199), resolve the selected session's `sessionId` and pass it:
```javascript
async function refreshUsage() {
  if (!window.api || !window.api.getUsage) return

  // The bar's context % + model reflect the SELECTED session (5h/7d stay global).
  const key = selectedKey || window._lastSelectedKey
  let sid = null
  if (key) {
    const pool = window._lastSessions || []
    const s = pool.find(x => (x.notesPath || x.sessionId || x.name || '') === key)
    sid = s ? s.sessionId
        : (window._terminalSession && (window._terminalSession.notesPath || window._terminalSession.sessionId || window._terminalSession.name || '') === key
           ? window._terminalSession.sessionId : null)
  }
  const usage = await window.api.getUsage(sid)
  const bar = document.getElementById('usage-bar')
  ...
```
(Everything after `const bar = …` is unchanged — it already hides context/model when they're `null` because `makeBar` returns `null` for a non-number `pct`, and `modelEl.textContent = model || '(unknown model)'`.)

Note: when `model` is `null` the current code shows `(unknown model)`. To hide it instead when there's no per-session model, change the model line to:
```javascript
  if (modelEl) {
    modelEl.textContent = model || ''
    modelEl.hidden = !model
  }
```

- [ ] **Step 3: Publish `window._lastSessions` + refresh usage on selection**

In `renderer/ui.js` `renderAll` (line 884), ensure the freshly-rendered session list is published for `refreshUsage` to resolve against. Add near the top of `renderAll` (after the drag/edit guard):
```javascript
  window._lastSessions = sessions
```
(If a `window._lastSessions = …` assignment already exists in `renderAll`, leave it — do not duplicate.)

At the end of `selectSession` in `renderer/app.js` (after the `renderAll(...)` call on line 435), refresh the bar so switching sessions updates context % + model immediately:
```javascript
  renderAll(filterSessions(sessions, searchQuery), selectedKey, activeTab, false)
  if (window.refreshUsage) window.refreshUsage()
}
```
Also add `if (window.refreshUsage) window.refreshUsage()` at the end of the embedded-terminal `mousedown` selection handler (the one that sets `selectedKey` from `window._terminalSession` and calls `fetchAndRender(false)`), and in `window.openBoardDetail` (after it sets `selectedKey`). The existing boot + 5s-poll `refreshUsage()` calls stay as-is.

- [ ] **Step 4: Verify + commit**

Run: `node --check renderer/app.js`, `node --check renderer/ui.js`, `node --check renderer/lib/tauri-api.js` (all pass); `npx jest` (89 green, unchanged). GUI verification (two sessions on different models/context → selecting each switches the bar's model + context %, 5h/7d constant) is deferred to the controller.

```bash
git add renderer/lib/tauri-api.js renderer/app.js renderer/ui.js
git commit -m "feat(usage): usage bar shows the selected session's context % + model"
```

---

## Self-Review

**Spec coverage:**
- Keyed cache `{global, sessions}` → Task 2 (wrapper writes it) + Task 1 (`usage_view` reads it). ✓
- 5h/7d global, context+model per session → Task 1 `usage_view` (global fields vs session fields). ✓
- Selected session drives the bar; hide context+model when absent → Task 3 (resolve `sessionId`; `makeBar` hides null context; model hidden when null). ✓
- Refresh on selection change → Task 3 Step 3 (`selectSession`, terminal-click handler, `openBoardDetail`). ✓
- `session_id` from statusLine input; graceful when absent → Task 2 (`dig(d,"session_id")`; writes `global` regardless). ✓
- Legacy flat tolerated (rate-limits as global; model/context only without id) → Task 1 tests + `usage_view` else-branch; Task 2 migrates prev flat. ✓
- Never breaks → Task 1 (`Null` on non-object / read error), Task 2 (best-effort write). ✓
- Testing: Rust `usage_view` unit tests (Task 1); wrapper manual sanity (Task 2); GUI deferred. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code; commands have expected output.

**Type consistency:** `usage_view(&Value, Option<&str>) -> Value` and `get_usage(Option<String>)` consistent across Task 1 code + tests + Task 3's `getUsage(sessionId)`. Cache keys (`global`, `sessions`, `fiveHourPct`, `sevenDayPct`, `fiveHourResetsAt`, `sevenDayResetsAt`, `updatedAt`, `model`, `contextPct`) identical between the wrapper (Task 2 writer), `usage_view` (Task 1), and the renderer's destructure (unchanged). `sessionKey` derivation (`notesPath || sessionId || name`) matches ui.js:44.
