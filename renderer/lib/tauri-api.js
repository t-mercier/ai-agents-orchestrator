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
    // The poll's three reads propagate: app.js fetchAndRender wraps them in one try/catch
    // and keeps the last good list on screen rather than blanking it.
    getSessions: () => invoke('get_sessions'),
    getHistoricalSessions: (status) => invoke('get_historical_sessions', { status }),
    // All three lifecycle buckets ({stale, closed, archived}) from ONE backend scan —
    // for callers that need every bucket at once (badge seed, board index).
    getHistoricalAll: () => invoke('get_historical_sessions_all'),
    // One page of ALL untracked sessions + the full count → { sessions, total }.
    // Errors are returned, not swallowed: a missing command (an app built before this
    // existed) would otherwise make "Load more" do nothing at all, silently.
    discoverSessionsPage: (limit, offset) =>
      invoke('discover_sessions_page', { limit, offset })
        .then((r) => ({ ok: true, ...r }))
        .catch((e) => ({ ok: false, error: String(e), sessions: [], total: 0, scanned: 0, alreadyManaged: 0, automationRuns: 0 })),
    // Never let a rejected open (unsupported scheme) become an unhandled promise
    // rejection — that made a link click look like it did nothing at all.
    openExternal: (url) =>
      invoke('open_external', { url })
        .then(() => ({ ok: true }))
        .catch((e) => ({ ok: false, error: String(e) })),
    // Same reason as openExternal: callers fire-and-forget on a click, so a rejection was
    // an unhandled promise and the click on a folder looked like it did nothing.
    openPath: (p) => invoke('open_path', { path: p }).then(() => ({ ok: true })).catch((e) => ({ ok: false, error: String(e) })),
    // Propagates: ui.js wraps it in warnAlreadyRunning / its own error toast, which needs the
    // rejection to reach it.
    openInTerminal: (cwd, sessionId) => invoke('open_in_terminal', { cwd: cwd || '', sessionId }),
    // Reveal an already-open session window: canReveal gates whether we offer the button.
    canRevealTerminal: (pid) => invoke('can_reveal_terminal', { pid: pid || 0 }).catch(() => false),
    revealTerminal: (pid) =>
      invoke('reveal_terminal', { pid: pid || 0 }).then(() => ({ ok: true })).catch((e) => ({ ok: false, error: String(e) })),

    // ── Embedded terminal (src-tauri/src/pty.rs) ──
    // command (optional): a full shell command from start_session(embedded=true), run
    // verbatim to CREATE a new session in this pty; sessionId is then its notesPath.
    // pty commands propagate: terminal.js owns the pane and reports a failed spawn/input in
    // the terminal itself; a swallowed rejection here would leave a silent blank pane.
    ptySpawn: (sessionId, cwd, cols, rows, restartSlug, command) =>
      invoke('pty_spawn', { sessionId, cwd, cols: cols || 0, rows: rows || 0, restartSlug: restartSlug || '', command: command || '' }),
    ptyInput: (sessionId, data) => invoke('pty_input', { sessionId, data }),
    listSkills: () => invoke('list_skills'),
    runSkill: (skill, cwd, resume) => invoke('run_skill', { skill, cwd, resume }),
    ptyResize: (sessionId, cols, rows) => invoke('pty_resize', { sessionId, cols, rows }),
    ptyKill: (sessionId) => invoke('pty_kill', { sessionId }),
    onPtyData: (cb) => window.__TAURI__.event.listen('pty-data', (e) => cb(e.payload.sessionId, e.payload.data)),
    onPtyExit: (cb) => window.__TAURI__.event.listen('pty-exit', (e) => cb(e.payload.sessionId)),
    // Generic listener for the rare non-terminal event. app.js:1281 has subscribed to
    // `config_migrated_v2` through this since the v2 migration shipped — behind a guard that
    // silently skipped, because this method did not exist. The migration toast never showed.
    onEvent: (name, cb) => window.__TAURI__.event.listen(name, (e) => cb(e.payload)),

    // ── New-session launcher (src-tauri/src/lib.rs) ──
    // embedded=false (default): launches an external iTerm tab, returns { ok }.
    // embedded=true: launches NOTHING — returns { ok, command, notesPath } so the renderer
    // can run the command in an in-app pty keyed by notesPath.
    startSession: ({ category, name, ticket, startIn, branch, prLink, root, embedded } = {}) =>
      invoke('start_session', {
        category: category || '', name: name || '', ticket: ticket || '',
        startIn: startIn || '', branch: branch || '', prLink: prLink || '', root: root || '',
        embedded: !!embedded,
      })
        .then((res) => ({ ok: true, ...(res || {}) }))
        .catch((e) => ({ ok: false, error: String(e) })),

    // ── Set / update / clear a session's PR links (notes.md frontmatter) ──
    // A session can carry several PRs (one task split across two of them). The first
    // entry becomes the primary `pr_link:`, the rest a `pr_links:` list; [] clears both.
    setPrLinks: (notesPath, urls) =>
      invoke('set_pr_links', { notesPath: notesPath || '', urls: urls || [] })
        .then(() => ({ ok: true }))
        .catch((e) => ({ ok: false, error: String(e) })),

    // ── Same, for the tracker side: `ticket:` + `tickets:` ──
    setTickets: (notesPath, tickets) =>
      invoke('set_tickets', { notesPath: notesPath || '', tickets: tickets || [] })
        .then(() => ({ ok: true }))
        .catch((e) => ({ ok: false, error: String(e) })),

    // ── Archive a closed session (stamps notes.md + drops it from active-sessions) ──
    archiveSession: (notesPath) =>
      invoke('archive_session', { notesPath: notesPath || '' })
        .then(() => ({ ok: true }))
        .catch((e) => ({ ok: false, error: String(e) })),
    unarchiveSession: (notesPath) =>
      invoke('unarchive_session', { notesPath: notesPath || '' })
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

    // ── First-run setup ──
    // Import one session with no terminal to watch: the backend runs `claude --resume` +
    // /import-session headless and resolves only once the registry actually carries the
    // session, so the wizard's per-row tick means imported, not merely attempted.
    importSessionHeadless: (sessionId, category, name, root) =>
      invoke('import_session_headless', { sessionId: sessionId || '', category: category || '', name: name || '', root: root || '' })
        .then(() => ({ ok: true }))
        .catch((e) => ({ ok: false, error: String(e) })),
    // What one untracked session was about and where it got to. Read on demand, from the
    // two ends of its transcript only — see reader::preview_session.
    previewSession: (sessionId) =>
      invoke('preview_session', { sessionId }).catch(() => ({ found: false })),
    // Should the wizard open at all? False for every install that already has sessions.
    needsOnboarding: () => invoke('needs_onboarding').catch(() => false),
    // Finished OR skipped — either way it does not open by itself again.
    finishOnboarding: () => invoke('finish_onboarding').then(() => ({ ok: true })).catch((e) => ({ ok: false, error: String(e) })),
    // Which configured spaces point at a folder that is actually there.
    // All-false on error: step 1 then blocks with "space not found" issues. Wrong when the
    // spaces do exist, but the only alternative is letting the import write under paths we
    // could not verify — blocking is the recoverable mistake.
    pathsExist: (paths) => invoke('paths_exist', { paths: paths || [] }).catch(() => (paths || []).map(() => false)),

    // ── Has the session's notes.md been freshly /close-session'd since `since` (ms)? ──
    // Polled by the embedded "Close session" button after it injects /close-session, to
    // know when the AI wrap-up has been written (then it kills the pty).
    // false on error = "not yet": the caller (terminal.js endSession) polls this under a
    // TIMEOUT and falls back to a direct close marker, so an erroring command degrades to
    // the timeout path rather than to a lost session.
    notesClosedSince: (notesPath, since) =>
      invoke('notes_closed_since', { notesPath: notesPath || '', sinceMs: since || 0 }).catch(() => false),
    // Stamp a close marker directly into notes.md (guaranteed-close fallback when
    // /close-session produced no fresh wrap-up). Moves the session to Closed.
    closeSession: (notesPath) =>
      invoke('close_session', { notesPath: notesPath || '' }).then(() => ({ ok: true })).catch((e) => ({ ok: false, error: String(e) })),
    // Wrap up a session for real, without opening a terminal: resumes it headless and
    // lets /wrap-session write the summary. Slow by nature (it re-reads the whole
    // conversation) and always ends Closed — it falls back to the plain marker itself.
    wrapSession: (notesPath, sessionId, cwd) =>
      invoke('wrap_session', { notesPath: notesPath || '', sessionId: sessionId || '', cwd: cwd || '' })
        .then((summary) => ({ ok: true, summary: String(summary || '') }))
        .catch((e) => ({ ok: false, error: String(e) })),

    // ── Pull-request state (src-tauri/src/prstatus.rs) ──
    // Read the cache written by the last Sync: { url: { state, checkedAt } }.
    getPrStatus: () => invoke('get_pr_status').catch(() => ({})),
    // Ask GitHub about these PRs via `gh`. THE ONLY network call the app ever makes,
    // and only on an explicit click. Per-PR failures come back as state 'unknown';
    // a missing or logged-out gh rejects the whole call with something actionable.
    syncPrStatus: (urls) =>
      invoke('sync_pr_status', { urls: urls || [] })
        .then((status) => ({ ok: true, status: status || {} }))
        .catch((e) => ({ ok: false, error: String(e) })),

    // Realign a session's tickets and PRs by running /sync-refs headless. Slow (an
    // agent pass over a tracker and some repos) and the only reason Sync takes seconds
    // rather than an instant.
    // Returns { summary, prs } — the PR list read back from the file the agent rewrote,
    // so the caller never has to guess when its own reload has landed.
    syncRefs: (notesPath, cwd) =>
      invoke('sync_refs', { notesPath: notesPath || '', cwd: cwd || '' })
        .then((r) => ({ ok: true, summary: String((r && r.summary) || ''), prs: (r && r.prs) || [] }))
        .catch((e) => ({ ok: false, error: String(e) })),

    // ── Shipped Claude Code hooks (src-tauri/src/hooks.rs) ──
    // Copying a hook script is inert; WIRING it edits ~/.claude/settings.json, which is
    // never done without the user seeing the exact result first — hence preview + wire.
    // [] on error: step 4 then lists no hook and offers no write — the safe direction,
    // since the alternative is offering to edit settings.json on data we could not read.
    hooksStatus: () => invoke('hooks_status').catch(() => []),
    // '' on error = "leave the key alone". merge_settings treats blank as no-op, never as
    // clear, so a failed read can at worst leave advisorModel untouched.
    advisorModel: () => invoke('advisor_model').catch(() => ''),
    hooksWirePreview: (files, advisor) =>
      invoke('hooks_wire_preview', { files, advisor: advisor || null })
        .then((p) => ({ ok: true, ...p }))
        .catch((e) => ({ ok: false, error: String(e) })),
    wireHooks: (files, advisor) =>
      invoke('wire_hooks', { files, advisor: advisor || null })
        .then((r) => ({ ok: true, ...(r || {}) }))
        .catch((e) => ({ ok: false, error: String(e) })),

    // ── Session skills installer (src-tauri/src/skills.rs) ──
    // status: which bundled skills are already in ~/.claude/skills (drives the banner).
    // On error → null, and the banner's `if (!status) return` stands down. It used to fake
    // `installed: true`, which read a FAILED status call as "skills present": the install
    // offer then never appeared, and nothing said why. Unknown must not masquerade as fine.
    skillsStatus: () => invoke('skills_status').catch(() => null),
    // Keep the app-owned skills at this build's versions. manual=false (launch):
    // direction-guarded — stands down if the tree already matches a bundle at least as
    // recent, so an older binary never reverts a fresher install.sh run. manual=true
    // (Settings): this build's versions on demand. Either way, a skill edited outside
    // the installers is copied under .archive/ before being overwritten — reported in
    // `backed_up`, never silently destroyed.
    syncSkills: (manual) =>
      invoke('sync_skills', { manual: !!manual })
        .then((r) => ({ ok: true, ...(r || {}) }))
        .catch((e) => ({ ok: false, error: String(e) })),
    // After `git pull` in a clone: is the checkout install.sh recorded now ahead of what it
    // installed? → { repo, checkout_epoch, installed_epoch }, or null when there is nothing
    // to offer. On error → null too: this is a courtesy notice, and a failed check must
    // read as "nothing to say", never as a banner about an update that may not exist.
    checkoutUpdate: () => invoke('checkout_update').catch(() => null),
    // Runs that checkout's `install.sh --all` (the path is the manifest's, never ours).
    // { ok, report } — the script's own output, which names what it replaced and archived.
    updateFromCheckout: () =>
      invoke('update_from_checkout')
        .then((report) => ({ ok: true, report: String(report || '') }))
        .catch((e) => ({ ok: false, error: String(e) })),
    // ── Doctor (src-tauri/src/doctor.rs) ──
    // The scan is read-only; the repair applies only the finding ids handed to it. Kept
    // as two calls on purpose — nothing the scan reports is acted on without a round
    // trip through the user.
    // Propagates: doctor.js catches it and shows "Scan failed: …" — a fake empty scan would
    // read as "nothing wrong", the opposite of what happened.
    doctorScan: () => invoke('doctor_scan'),
    doctorRepair: (ids) =>
      invoke('doctor_repair', { ids })
        .then((r) => r || { fixed: [], failed: [] })
        .catch((e) => ({ fixed: [], failed: [{ id: 'doctor', error: String(e) }] })),

    // First-contact install only (the launch banner's button): writes missing skills,
    // never touches an existing one. The user opts in here; sync takes over afterwards.
    installSkills: (force) =>
      invoke('install_skills', { force: !!force })
        .then((r) => ({ ok: true, ...(r || {}) }))
        .catch((e) => ({ ok: false, error: String(e) })),

    // ── Detach into its own window + pin (src-tauri/src/lib.rs) ──
    // Propagates: a failed detach must surface, since app.js closes the drawer right after —
    // swallowing it would make the session vanish from view with nothing popped out.
    detachSession: (key) => invoke('detach_session', { key }),
    // Cosmetic: false on error just leaves the pin button unlit.
    setAlwaysOnTop: (flag) => invoke('set_always_on_top', { flag }).catch(() => false),
    // Match the native window background to the theme (avoids a white flash on resize).
    // Cosmetic: a missed background sync costs one white flash on resize, nothing else.
    setWindowBg: (dark) => invoke('set_window_bg', { dark: !!dark }).catch(() => {}),

    // ── Usage status bar (Claude Code statusline cache) ──
    // Fetches ~/.claude/statusline-cache.json; returns the parsed object or null (cache absent/unreadable).
    getUsage: (sessionId) => invoke('get_usage', { sessionId }).catch(() => null),
  }
})()
