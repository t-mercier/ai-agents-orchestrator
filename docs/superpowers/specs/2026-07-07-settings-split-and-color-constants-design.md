# Settings split + shared color constants — design

**Date:** 2026-07-07
**Status:** approved

## Goal

Two related cleanups in the renderer:

1. Kill the duplicated hardcoded color hexes (`#7E93B8` ×6, `#8fd9ff` ×2, `#8a8f98`/`#8a8a8e`) behind one shared global constant object.
2. Split `renderer/settings.js` (712 lines, one IIFE, ~10 unrelated concerns) into focused per-tab files under `renderer/settings/`.

Pure move-and-wire refactor: **no behavior change**, with one flagged exception (gray unification, below).

## Part 1 — `window.CSM_COLORS`

Defined in `renderer/looks.js` (already the color home), frozen:

```js
window.CSM_COLORS = Object.freeze({
  accent:      window.CSM_LOOKS[0].accent,  // '#7E93B8' — Ardoise, the default look
  newCategory: '#8fd9ff',                   // color given to a freshly added category
  neutral:     '#8a8f98',                   // gray fallback for unknown/invalid colors
})
```

### Load order

Move `<script src="looks.js">` in `renderer/index.html` from after `board.js` to **before `ui.js`** (i.e. with the `lib/` scripts). Safe: looks.js is pure data with zero dependencies. Required: `app.js` applies the accent at parse time, so the constant must exist by then.

### Replacements

| Old | New | Sites |
|---|---|---|
| `'#7E93B8'` | `CSM_COLORS.accent` | `app.js:85`, `app.js:92`, settings (cat-seed custom default, board-seed custom default, live snapshot fallback, custom-look fallback) |
| `'#8fd9ff'` | `CSM_COLORS.newCategory` | settings (addCatRow fallback, ＋Category default) |
| `'#8a8f98'`, `'#8a8a8e'` | `CSM_COLORS.neutral` | `app.js:768`, settings column-color fallback |

**Flagged behavior change:** unifying `#8a8a8e` → `#8a8f98` shifts the column-color fallback pastille by an imperceptible amount. Accepted.

### Explicitly out of scope

- `style.css:16` `--accent: #7E93B8` stays — CSS can't read JS; its comment already cross-references looks.js.
- Rust default `#8fd9ff` in `src-tauri/src/config.rs` stays (different runtime); add a cross-reference comment pointing at `CSM_COLORS.newCategory`.
- `terminal.js` xterm theme palette stays as-is (it is its own self-contained theme table, not a duplicated constant).

## Part 2 — `renderer/settings/` split

`renderer/settings.js` is deleted. `index.html` loads `settings/core.js` first, then the tab files (one per settings tab). Code is **transplanted verbatim** into its new file — not rewritten.

### Files

| File | Contents (from current settings.js) | ~lines |
|---|---|---|
| `settings/core.js` | modal/form refs, `$`, `escAttr`, `NAME_RE`/`COLOR_RE`, `showError`/`clearError`, tab nav (`showSettingsTab`), open button (snapshot + populate + `showModal`), close/cancel + live-prefs snapshot/revert (`snapshotLivePrefs`/`restoreLivePrefs`), `refreshBoardIfOpen`, Browse… delegation, submit handler (save pipeline), **registry** | ~150 |
| `settings/general.js` | spaces editor (`addSpaceRow`/`renderSpaceRows`, ＋Space), backup export/import, install-skills button | ~140 |
| `settings/appearance.js` | theme toggle, looks grid (`renderLooks`/`highlightActiveLook`/`applyLookById`), accent picker, compact chrome, density | ~110 |
| `settings/shortcuts.js` | `renderKeys`, key capture, reset | ~40 |
| `settings/terminal.js` | terminal-app select (config field) + embedded terminal prefs (`populateTerminalPrefs`/`pushTerminalPrefs`) | ~30 |
| `settings/board.js` | board seed/scheme (`renderBoardSeed`/`applyBoardSeed`), columns editor (`renderColRows`, EYE icons, add/hide/move/remove/rename/color) | ~130 |
| `settings/categories.js` | `addCatRow`, ＋Category folder picker, cat seed/scheme (`renderCatSeed`/`regenerateCatColors`/`applyCatSeed`) | ~150 |
| `settings/integrations.js` | ticket URL + Obsidian fields (populate/collect only — plain form fields) | ~25 |

### Registry contract

`core.js` defines `window.CSMSettings` with a `register(mod)` accepting hooks; all hooks optional:

```js
CSMSettings.register({
  populate(cfg)      // called on modal open, in registration order
  collect(out, ctx)  // on Save: mutate `out` (the user-config object) with this tab's fields
  validate(cfg)      // on Save, after all collects: return error string, or null
})
```

- **Open:** core takes the live-prefs snapshot, runs every `populate(window.CSM_CONFIG)`, clears the error, shows the `general` tab, opens the modal.
- **Save:** core seeds `out = { version: 1 }` and `ctx = {}`, runs collects in registration order, then validates in order (first error string wins → inline banner, modal stays open), then `window.api.setConfig(out)`; on success sets `settingsSaved`, closes, `reloadConfig()`.
- **Cancel/close without save:** core restores the live-prefs snapshot (unchanged logic).

**The one cross-tab coupling, made explicit via `ctx`:** a space rename must retag category roots. `general.js`'s collect writes `ctx.renameMap` (old→new space names) and `out.roots`/legacy `workRoot`/`personalRoot`; `categories.js`'s collect reads `ctx.renameMap` when building `out.categories`. Registration order therefore matters: **general before categories** (enforced by script order in index.html).

Live-only concerns (appearance, shortcuts, board, embedded-terminal prefs) register only `populate` — their edits keep applying immediately via the existing `window.*` globals / `CSMBoard`, and revert via core's snapshot, exactly as today.

### index.html script order

```html
<script src="lib/tauri-api.js"></script>
<script src="xterm-bundle.js"></script>
<script src="lib/formatters.js"></script>
<script src="lib/markdown.js"></script>
<script src="lib/categories.js"></script>
<script src="lib/board-model.js"></script>
<script src="looks.js"></script>          <!-- moved up: pure data, needed by app.js -->
<script src="ui.js"></script>
<script src="terminal.js"></script>
<script src="app.js"></script>
<script src="board.js"></script>
<script src="settings/core.js"></script>
<script src="settings/general.js"></script>
<script src="settings/appearance.js"></script>
<script src="settings/shortcuts.js"></script>
<script src="settings/terminal.js"></script>
<script src="settings/board.js"></script>
<script src="settings/categories.js"></script>
<script src="settings/integrations.js"></script>
```

### Packaging note

Check the Tauri bundling / `scripts/install.sh` / docs for references to `renderer/settings.js` and the flat renderer file list; the new `settings/` directory must ship with the app.

## Error handling

Unchanged: validation errors render in the inline banner and keep the modal open; Rust re-validates on `setConfig` and remains the real guard.

## Testing / verification

Manual walk of the app (no renderer unit tests exist for this code):

1. Open Settings → each of the 7 tabs renders its controls.
2. Appearance: pick a look → applies live; **Cancel/Esc reverts**; change accent → Save → restart → persists (the exact check already done pre-refactor).
3. Board: reorder/hide/recolor columns → live on board; Cancel reverts.
4. Categories: seed spreads colors; ＋Category via folder picker still validates/dedups.
5. General: rename a space → Save → categories under it follow (the `ctx.renameMap` path).
6. Backup export/import and Install skills buttons still work.
7. Grep: no `#7E93B8`/`#8fd9ff`/`#8a8f98`/`#8a8a8e` literals left in renderer JS outside `looks.js` (and the xterm/terminal theme table).

## Out of scope

- ES-module migration of the renderer.
- Any restructuring of `app.js`/`ui.js` beyond the constant replacements.
- Behavior/UX changes to the settings modal.
