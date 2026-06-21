// Tauri ⇄ renderer bridge: recreates the `window.api` the Electron preload used,
// backed by Tauri's invoke (window.__TAURI__ is global thanks to withGlobalTauri).
// Loaded FIRST so ui.js/app.js find window.api ready.
;(function () {
  const { invoke } = window.__TAURI__.core

  window.api = {
    // ── Implemented in Rust (src-tauri/src/{config,reader,lib}.rs) ──
    getConfig: () => invoke('get_config'),
    setConfig: (cfg) =>
      invoke('set_config', { cfg }).then(() => ({ ok: true })).catch((e) => ({ ok: false, error: String(e) })),
    // Native folder picker for Settings; resolves to the chosen path or null (cancelled).
    pickDirectory: () => invoke('pick_directory').catch(() => null),
    // Native multi-folder picker → array of absolute paths (empty if cancelled).
    pickDirectories: () => invoke('pick_directories').catch(() => []),
    exportSettings: (json) => invoke('export_settings', { json }).then((saved) => ({ ok: true, saved })).catch((e) => ({ ok: false, error: String(e) })),
    importSettings: () => invoke('import_settings').then((content) => ({ ok: true, content })).catch((e) => ({ ok: false, error: String(e) })),
    getSessions: () => invoke('get_sessions'),
    getHistoricalSessions: (status) => invoke('get_historical_sessions', { status }),
    // All three lifecycle buckets ({stale, closed, archived}) from ONE backend scan —
    // for callers that need every bucket at once (badge seed, board index).
    getHistoricalAll: () => invoke('get_historical_sessions_all'),
    // Unmanaged transcripts (no notes.md) for the "Import a session" picker.
    discoverSessions: () => invoke('discover_sessions'),
    openExternal: (url) => invoke('open_external', { url }),
    openPath: (p) => invoke('open_path', { path: p }),
    openInTerminal: (cwd, sessionId) => invoke('open_in_terminal', { cwd: cwd || '', sessionId }),
    // Reveal an already-open session window: canReveal gates whether we offer the button.
    canRevealTerminal: (pid) => invoke('can_reveal_terminal', { pid: pid || 0 }).catch(() => false),
    revealTerminal: (pid) =>
      invoke('reveal_terminal', { pid: pid || 0 }).then(() => ({ ok: true })).catch((e) => ({ ok: false, error: String(e) })),

    // ── Embedded terminal (src-tauri/src/pty.rs) ──
    ptySpawn: (sessionId, cwd, cols, rows, restartSlug) =>
      invoke('pty_spawn', { sessionId, cwd, cols: cols || 0, rows: rows || 0, restartSlug: restartSlug || '' }),
    ptyInput: (sessionId, data) => invoke('pty_input', { sessionId, data }),
    ptyResize: (sessionId, cols, rows) => invoke('pty_resize', { sessionId, cols, rows }),
    ptyKill: (sessionId) => invoke('pty_kill', { sessionId }),
    onPtyData: (cb) => window.__TAURI__.event.listen('pty-data', (e) => cb(e.payload.sessionId, e.payload.data)),
    onPtyExit: (cb) => window.__TAURI__.event.listen('pty-exit', (e) => cb(e.payload.sessionId)),

    // ── New-session launcher (src-tauri/src/lib.rs) ──
    startSession: ({ category, name, ticket, repo, branch, prLink } = {}) =>
      invoke('start_session', {
        category: category || '', name: name || '', ticket: ticket || '',
        repo: repo || '', branch: branch || '', prLink: prLink || '',
      })
        .then(() => ({ ok: true }))
        .catch((e) => ({ ok: false, error: String(e) })),

    // ── Set / update / clear a REVIEW session's reviewed-PR link (notes.md frontmatter) ──
    setPrLink: (notesPath, url) =>
      invoke('set_pr_link', { notesPath: notesPath || '', url: url || '' })
        .then(() => ({ ok: true }))
        .catch((e) => ({ ok: false, error: String(e) })),

    // ── Archive a closed session (stamps notes.md + drops it from active-sessions) ──
    archiveSession: (notesPath) =>
      invoke('archive_session', { notesPath: notesPath || '' })
        .then(() => ({ ok: true }))
        .catch((e) => ({ ok: false, error: String(e) })),

    // ── Delete an archived session: move its folder to the OS Trash (recoverable) ──
    deleteSession: (notesPath) =>
      invoke('delete_session', { notesPath: notesPath || '' })
        .then(() => ({ ok: true }))
        .catch((e) => ({ ok: false, error: String(e) })),

    // ── Reopen a closed/archived session via /restart (src-tauri/src/lib.rs) ──
    restoreSession: (slug, sessionId) =>
      invoke('restore_session', { slug: slug || '', sessionId: sessionId || '' })
        .then(() => ({ ok: true }))
        .catch((e) => ({ ok: false, error: String(e) })),

    // ── Detach into its own window + pin (src-tauri/src/lib.rs) ──
    detachSession: (key) => invoke('detach_session', { key }),
    setAlwaysOnTop: (flag) => invoke('set_always_on_top', { flag }).catch(() => false),
  }
})()
