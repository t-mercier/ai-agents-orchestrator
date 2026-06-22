mod config;
mod pty;
mod reader;
mod git;
mod terminal;

use tauri::Manager;

/// Open an http(s) URL in the system browser. The scheme check already prevents a
/// leading `-`; `--` terminates `open`'s option parsing (defense-in-depth).
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("only http(s) URLs are allowed".into());
    }
    std::process::Command::new("open")
        .arg("--")
        .arg(&url)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Reveal a path (e.g. a session folder) in Finder. Reject leading-dash paths
/// (argv flag smuggling), canonicalize to an absolute path, and pass `--` so a
/// crafted path can never be parsed as an `open` flag.
#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    if path.starts_with('-') {
        return Err("invalid path".into());
    }
    let abs = std::path::PathBuf::from(&path)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    std::process::Command::new("open")
        .arg("--")
        .arg(&abs)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}


/// Can we reveal an existing terminal window for this session? (Used to decide
/// whether to OFFER the "Reveal window" button.) Check-only: no focus change, and
/// the `is running` guard means it won't launch a terminal.
#[tauri::command(async)]
fn can_reveal_terminal(pid: i64) -> bool {
    match terminal::session_tty(pid) {
        Some(tty) => terminal::scan_terminals(&tty, false),
        None => false,
    }
}

/// Bring the session's existing terminal window/tab to the front (instead of
/// opening a second instance). Errors if it can't be found.
#[tauri::command(async)]
fn reveal_terminal(pid: i64) -> Result<(), String> {
    let tty = terminal::session_tty(pid).ok_or("session has no terminal tty")?;
    if terminal::scan_terminals(&tty, true) {
        Ok(())
    } else {
        Err("couldn't find that terminal window".into())
    }
}

/// Strict category token — the real injection boundary, since the config JSON is
/// hand-editable and bypasses config.validate(). Mirrors the Electron SAFE_CATEGORY.
fn is_safe_category(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 20
        && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Resume a session's full conversation in the user's terminal. sessionId is regex-
/// restricted; the cwd is POSIX single-quoted, and `claude --model 'opus[1m]'`
/// must stay quoted (the `[1m]` would otherwise be glob-expanded by the shell).
#[tauri::command]
fn open_in_terminal(cwd: String, session_id: String) -> Result<(), String> {
    if session_id.is_empty()
        || !session_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err("invalid session id".into());
    }
    // Closed sessions may send an empty/relative cwd — only cd when it's absolute.
    let cmd = if std::path::Path::new(&cwd).is_absolute() {
        format!(
            "cd {} && claude --resume {} --model {}",
            pty::shell_quote(&cwd),
            session_id,
            pty::shell_quote(pty::CLAUDE_MODEL),
        )
    } else {
        format!(
            "claude --resume {} --model {}",
            session_id,
            pty::shell_quote(pty::CLAUDE_MODEL),
        )
    };
    terminal::launch_in_terminal(&cmd)
}

/// A git branch name safe to pass to `git checkout` and into a shell command.
/// Allowlist (no shell metachars survive shell_quote anyway, but this also blocks
/// git ref ambiguities): no leading dash (flag smuggling), no leading/trailing `/`,
/// no `..` or `@{` (revision/reflog syntax). Used with `git checkout <b> --` so a
/// branch can never be reinterpreted as a pathspec.
fn is_safe_branch(b: &str) -> bool {
    !b.is_empty()
        && b.len() <= 200
        && !b.starts_with('-')
        && !b.starts_with('/')
        && !b.ends_with('/')
        && !b.contains("..")
        && !b.contains("@{")
        && b.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'/' | b'-'))
}

/// Validate a repo path BEFORE spawning iTerm: absolute, no leading dash, exists,
/// is a directory, and is actually a git repo. Returns the canonical path. This is
/// the only feedback channel — once iTerm is spawned, a failed `cd`/`checkout` is
/// invisible to the form (the spawn already succeeded), so we pre-flight here.
fn validate_repo(repo: &str) -> Result<std::path::PathBuf, String> {
    if repo.starts_with('-') {
        return Err("invalid repo path".into());
    }
    let p = std::path::Path::new(repo);
    if !p.is_absolute() {
        return Err("repo must be an absolute path".into());
    }
    let abs = p.canonicalize().map_err(|_| "repo folder not found".to_string())?;
    if !abs.is_dir() {
        return Err("repo is not a directory".into());
    }
    let is_git = std::process::Command::new("git")
        .arg("-C")
        .arg(&abs)
        .args(["rev-parse", "--git-dir"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    if !is_git {
        return Err("that folder is not a git repository".into());
    }
    Ok(abs)
}

/// Launch a NEW session: open `claude` + the `/start-session` skill. Default (external)
/// opens a new iTerm tab; `embedded` instead returns the command + the notes.md path the
/// skill will create, so the dashboard can run it in an in-app pty (the renderer keys the
/// embedded terminal by that notesPath — see the embedded branch).
/// Launches from a chosen repo (cd + checkout the branch so the session starts on
/// it) when given, else the category's scope root. The app writes nothing itself —
/// /start-session creates the workspace (ADR-001/ADR-012). Category must pass the strict
/// token regex AND exist in config. Repo/branch are pre-flight-validated so errors
/// surface in the form, not as a dead iTerm tab.
#[tauri::command]
#[allow(clippy::too_many_arguments)] // tauri command: one param per form field
fn start_session(
    category: String,
    name: String,
    ticket: String,
    repo: String,
    branch: String,
    pr_link: String,
    root: String,
    embedded: bool,
) -> Result<serde_json::Value, String> {
    let cfg = config::load();
    // Optional space (root) override — disambiguates a category present in 2+ spaces,
    // and decides the launch dir + the `--root` the skill writes under. Must be a
    // declared root and a safe token (it rides the /start-session prompt).
    let want_root = root.trim();
    if !want_root.is_empty() {
        let known = cfg.get("roots").and_then(serde_json::Value::as_array).is_some_and(|rs| {
            rs.iter().any(|r| r.get("name").and_then(serde_json::Value::as_str) == Some(want_root))
        });
        let safe = want_root.len() <= 30
            && want_root.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
        if !known || !safe {
            return Err("invalid space".into());
        }
    }
    let cats = cfg.get("categories").and_then(serde_json::Value::as_array);
    // Match the category by (name, root) when a space is given, so the right entry
    // (and thus the right launch dir) wins for a name that exists under several spaces.
    let cat_def = cats.and_then(|arr| {
        arr.iter().find(|c| {
            c.get("name").and_then(serde_json::Value::as_str) == Some(&category)
                && (want_root.is_empty()
                    || c.get("root").and_then(serde_json::Value::as_str) == Some(want_root))
        })
    });
    let cat_def = match cat_def {
        Some(c) if is_safe_category(&category) => c,
        _ => return Err("invalid category".into()),
    };

    // Title (the session name): unicode letters/digits (French accents OK), spaces,
    // and a small punctuation set. Excludes backtick, $, ", \\ and newline — the
    // chars that break the downstream shell-quote / YAML frontmatter / iTerm title.
    // Whitespace is collapsed; capped at 120.
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_whitespace() { ' ' } else { c })
        .filter(|c| c.is_alphanumeric() || *c == ' ' || "-_.,'()".contains(*c))
        .collect();
    let safe_name: String = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let safe_name: String = safe_name.chars().take(120).collect::<String>().trim().to_string();
    if safe_name.is_empty() {
        return Err("title required".into());
    }

    // Ticket: accept a project-key form (ABC-123); uppercased, else dropped.
    let t = ticket.trim();
    let safe_ticket = if is_ticket(t) { t.to_uppercase() } else { String::new() };

    // Optional repo + branch: validate up front (see validate_repo). A branch with
    // no repo is meaningless (nothing to check it out in) — reject early.
    let repo = repo.trim();
    let branch = branch.trim();
    if !branch.is_empty() && repo.is_empty() {
        return Err("pick a repo to check the branch out in".into());
    }
    let repo_abs = if repo.is_empty() { None } else { Some(validate_repo(repo)?) };
    if !branch.is_empty() {
        if !is_safe_branch(branch) {
            return Err("invalid branch name".into());
        }
        // Confirm the branch resolves in this repo (local or remote-tracking ref).
        let abs = repo_abs.as_ref().unwrap();
        let exists = std::process::Command::new("git")
            .arg("-C")
            .arg(abs)
            .args(["rev-parse", "--verify", "--quiet"])
            .arg(branch)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if !exists {
            return Err(format!("branch '{branch}' not found in that repo"));
        }
    }

    // Optional reviewed-PR link (REVIEW sessions). Validated up front; appended as a
    // `--pr <url>` token the /start-session skill recognises and writes to the frontmatter.
    let pr = pr_link.trim();
    if !pr.is_empty() && !is_pr_url(pr) {
        return Err("not a GitHub PR URL (https://github.com/owner/repo/pull/N)".into());
    }

    // /start-session parses: <CATEGORY> [<TICKET>] <name> [--pr <url>] [--root <space>]
    let parts: Vec<&str> = [category.as_str(), safe_ticket.as_str(), safe_name.as_str()]
        .into_iter()
        .filter(|p| !p.is_empty())
        .collect();
    let mut prompt = format!("/start-session {}", parts.join(" "));
    if !pr.is_empty() {
        prompt.push_str(&format!(" --pr {pr}"));
    }
    // Tell the skill which space to write under (only when one was chosen) — resolves
    // a category that exists in several spaces. Validated as a safe token above.
    if !want_root.is_empty() {
        prompt.push_str(&format!(" --root {want_root}"));
    }
    let model = pty::CLAUDE_MODEL;
    // Start NEW sessions in auto mode. /start-session must WRITE notes.md + register the
    // session in active-sessions.json — plan mode BLOCKS that (the skill aborts at its
    // mode check), so a +New in plan mode silently does nothing. `--permission-mode auto`
    // forces a writable mode regardless of the user's persisted default. (Resume/Restart
    // keep the session's own mode — this is only for fresh sessions.) `auto` is a fixed
    // literal, no quoting needed.
    let claude = format!(
        "claude --model {} --permission-mode auto {}",
        pty::shell_quote(model),
        pty::shell_quote(&prompt),
    );

    // Launch dir: the repo (start ON the branch) when given, else the scope root.
    let cmd = if let Some(abs) = &repo_abs {
        let cd = pty::shell_quote(&abs.to_string_lossy());
        if branch.is_empty() {
            format!("cd {cd} && {claude}")
        } else {
            // `git checkout <branch> --` — the trailing `--` stops the branch from
            // being reinterpreted as a pathspec; `&&` so a failed checkout aborts
            // (visible in iTerm) rather than starting on the wrong branch.
            format!("cd {} && git checkout {} -- && {}", cd, pty::shell_quote(branch), claude)
        }
    } else {
        let launch_dir = category_root_dir(&cfg, cat_def);
        format!("cd {} && {}", pty::shell_quote(&launch_dir), claude)
    };
    if embedded {
        // Embedded: the dashboard runs `cmd` itself in an in-app pty (not iTerm), so
        // return the command verbatim + the notes.md path the /start-session skill WILL
        // create. The renderer keys the embedded terminal by that notesPath — which is
        // the session's eventual sessionKey — so the card links to its terminal with no
        // re-key, and pty_spawn's idempotency guard (keyed on it) blocks a double-client.
        // notesPath MUST match the skill's TARGET_DIR (aoconfig.py `dir`):
        // <category root>/<CATEGORY>/<folder>/notes.md, folder = ticket || slugify(name).
        // slugify is byte-faithful to the skill's slug(); keep both in sync.
        let folder = if safe_ticket.is_empty() { slugify(&safe_name) } else { safe_ticket.clone() };
        let base = category_root_dir(&cfg, cat_def);
        let notes_path = format!("{base}/{category}/{folder}/notes.md");
        return Ok(serde_json::json!({ "command": cmd, "notesPath": notes_path }));
    }
    terminal::launch_in_terminal(&cmd)?;
    Ok(serde_json::json!({}))
}

/// Slugify a session NAME into a folder slug, byte-faithful to the /start-session skill's
/// `slug()` = `tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g'`.
/// ASCII-ONLY on purpose (matches `sed` under the C locale): non-ASCII chars become a
/// dash, e.g. "Café" → "caf", "réseau" → "r-seau". Used by embedded start_session to
/// predict the skill's notes.md folder — must stay in lockstep with the skill's slug().
fn slugify(name: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for c in name.chars() {
        let lc = c.to_ascii_lowercase(); // lowercases ASCII A-Z only; leaves others as-is
        if lc.is_ascii_alphanumeric() {
            out.push(lc);
            prev_dash = false;
        } else if !prev_dash {
            out.push('-'); // collapse any run of non-[a-z0-9] to a single dash
            prev_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

/// Launch dir for a NEW session in this category: the path of the category's
/// configured `root` (v2 — `derive()` sets `root` on every category). Falls back to
/// the legacy `scope`→workRoot/personalRoot when the root can't be resolved (v1
/// configs), then to home. Keeps a moved-to-a-custom-root category launching from
/// the right place.
fn category_root_dir(cfg: &serde_json::Value, cat_def: &serde_json::Value) -> String {
    let home = cfg.get("home").and_then(serde_json::Value::as_str).unwrap_or("/");
    // v2: resolve the category's root name → its path in cfg.roots.
    if let Some(root_name) = cat_def.get("root").and_then(serde_json::Value::as_str) {
        if let Some(roots) = cfg.get("roots").and_then(serde_json::Value::as_array) {
            if let Some(path) = roots
                .iter()
                .find(|r| r.get("name").and_then(serde_json::Value::as_str) == Some(root_name))
                .and_then(|r| r.get("path").and_then(serde_json::Value::as_str))
            {
                return path.to_string();
            }
        }
    }
    // v1 fallback: scope → workRoot / personalRoot.
    let scope = cat_def.get("scope").and_then(serde_json::Value::as_str).unwrap_or("work");
    let root_key = if scope == "personal" { "personalRoot" } else { "workRoot" };
    cfg.get(root_key).and_then(serde_json::Value::as_str).unwrap_or(home).to_string()
}

/// Reopen a closed/archived session: launch `claude` + the `/restart-session` skill, which
/// reloads the session's notes into a fresh session and re-registers it as active
/// (un-archiving it). Launcher only — the app writes nothing (ADR-001/ADR-012).
/// Distinct from resume: `/restart-session` reloads the notes summary, not the raw transcript,
/// so it works for sessions with no recorded sessionId (e.g. "to fill").
#[tauri::command]
fn restore_session(slug: String, session_id: String) -> Result<(), String> {
    // Slug is a folder name (allows '.') — validate at the boundary before it
    // reaches the filesystem/prompt. sessionId, if present, must be a clean id.
    if slug.is_empty() || !slug.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_' || b == b'-') {
        return Err("invalid slug".into());
    }
    if !session_id.is_empty()
        && !session_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err("invalid sessionId".into());
    }
    // cd into the session's launch dir so /restart-session lands in the right place.
    // Prefer the transcript's launch cwd; for closed/archived sessions (no transcript)
    // fall back to the session's SPACE root resolved from its notes.md location — NOT
    // $HOME, so a Work session restarts in Work. $HOME only if even that can't be found.
    let dir = if session_id.is_empty() { None } else { reader::resolve_session_cwd(&session_id) }
        .or_else(|| reader::resolve_slug_cwd(&slug))
        .unwrap_or_else(|| config::home().to_string_lossy().into_owned());

    let prompt = format!("/restart-session {slug}");
    let cmd = format!(
        "cd {} && claude --model {} {}",
        pty::shell_quote(&dir),
        pty::shell_quote(pty::CLAUDE_MODEL),
        pty::shell_quote(&prompt),
    );
    terminal::launch_in_terminal(&cmd)
}

/// Import (adopt) an existing Claude Code session into management: `--resume` it and
/// run the `/import-session` skill so it gets a notes.md + registration. The app only launches;
/// the skill does the writing (ADR-012). cwd = the session's launch dir (where
/// `--resume` must run). Category must be one the user configured.
#[tauri::command(async)]
fn import_session(session_id: String, category: String, name: String, root: String) -> Result<(), String> {
    if session_id.is_empty()
        || !session_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err("invalid sessionId".into());
    }
    let category = category.trim().to_uppercase();
    if !is_safe_category(&category) {
        return Err("invalid category".into());
    }
    let cfg = config::load();
    let known = cfg.get("categories").and_then(serde_json::Value::as_array).is_some_and(|arr| {
        arr.iter().any(|c| c.get("name").and_then(serde_json::Value::as_str) == Some(&category))
    });
    if !known {
        return Err("unknown category — add it in Settings first".into());
    }
    // Optional space (root): which space the imported session's notes.md lands under,
    // for a category that exists in several. Must be a declared root + a safe token (it
    // rides the /import-session prompt). Mirrors start_session.
    let want_root = root.trim();
    if !want_root.is_empty() {
        let known_root = cfg.get("roots").and_then(serde_json::Value::as_array).is_some_and(|rs| {
            rs.iter().any(|r| r.get("name").and_then(serde_json::Value::as_str) == Some(want_root))
        });
        let safe = want_root.len() <= 30
            && want_root.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
        if !known_root || !safe {
            return Err("invalid space".into());
        }
    }
    // Same safe-name set as /start-session (no shell / YAML-breaking chars); may be empty.
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_whitespace() { ' ' } else { c })
        .filter(|c| c.is_alphanumeric() || *c == ' ' || "-_.,'()".contains(*c))
        .collect();
    let safe_name = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let safe_name: String = safe_name.chars().take(120).collect::<String>().trim().to_string();

    let dir = reader::resolve_session_cwd(&session_id)
        .unwrap_or_else(|| config::home().to_string_lossy().into_owned());
    let mut prompt = if safe_name.is_empty() {
        format!("/import-session {category}")
    } else {
        format!("/import-session {category} {safe_name}")
    };
    if !want_root.is_empty() {
        prompt.push_str(&format!(" --root {want_root}"));
    }
    let cmd = format!(
        "cd {} && claude --resume {} --model {} {}",
        pty::shell_quote(&dir),
        pty::shell_quote(&session_id),
        pty::shell_quote(pty::CLAUDE_MODEL),
        pty::shell_quote(&prompt),
    );
    terminal::launch_in_terminal(&cmd)
}

/// True for a project-key ticket like `ABC-123` (letter, alnum*, dash, digits).
fn is_ticket(t: &str) -> bool {
    let (key, num) = match t.split_once('-') {
        Some(kv) => kv,
        None => return false,
    };
    !key.is_empty()
        && key.bytes().next().is_some_and(|b| b.is_ascii_alphabetic())
        && key.bytes().all(|b| b.is_ascii_alphanumeric())
        && !num.is_empty()
        && num.bytes().all(|b| b.is_ascii_digit())
}

/// Percent-encode a string for safe use as a URL query value (unreserved chars
/// pass through; everything else becomes %XX). The detached window reads it back
/// via URLSearchParams, which decodes it.
fn percent_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Stable, always-valid window label for a session key (which may be a notesPath
/// full of `/` and `.` that Tauri rejects as a label). FNV-1a → hex.
fn label_for(key: &str) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in key.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("detail-{h:016x}")
}

/// Detach a session into its own window (port of the Electron detach-session). The
/// key (running notesPath/sessionId, or historical key) is passed as a query param;
/// detail.html's detail-window.js looks the session up across all tabs. Re-detaching
/// the same session focuses the existing window instead of opening a duplicate.
#[tauri::command]
fn detach_session(app: tauri::AppHandle, key: String) -> Result<(), String> {
    if key.is_empty() {
        return Err("invalid key".into());
    }
    let label = label_for(&key);
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.set_focus();
        return Ok(());
    }
    let url = format!("detail.html?key={}", percent_encode(&key));
    tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App(url.into()))
        .title("")
        .inner_size(560.0, 720.0)
        .min_inner_size(360.0, 420.0)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Toggle the calling window's always-on-top ("pin"). Acts only on the sender's
/// own window; returns the requested state (the renderer tracks it from there).
#[tauri::command]
fn set_always_on_top(window: tauri::WebviewWindow, flag: bool) -> bool {
    let _ = window.set_always_on_top(flag);
    flag
}

/// Match the native window background to the active theme, so a window RESIZE doesn't
/// briefly flash the OS default (white) at the growing edge before the dark webview
/// repaints. On macOS this sets the NSWindow layer (the webview layer is a no-op there) —
/// exactly the layer drawn during a live resize. Called from applyTheme() at boot + on
/// every theme toggle. Colours mirror `--bg` in style.css.
#[tauri::command]
fn set_window_bg(window: tauri::WebviewWindow, dark: bool) {
    let c = if dark {
        tauri::window::Color(28, 28, 30, 255)
    } else {
        tauri::window::Color(245, 245, 247, 255)
    };
    let _ = window.set_background_color(Some(c));
}

/// Write `body` to `path` atomically (tmp + rename), so a crash never leaves a
/// half-written session file.
fn atomic_write(path: &std::path::Path, body: &str) -> Result<(), String> {
    let tmp = path.with_extension("ao-tmp");
    std::fs::write(&tmp, body).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Resolve a notes.md path the app is allowed to WRITE: a real `notes.md` file
/// confined under a configured root. Shared by the two source-of-truth writes
/// (archive + pr_link) so the confinement rule lives once. Checks EVERY configured
/// root — the v2 `roots` list plus the legacy workRoot/personalRoot — so a session
/// under a custom root isn't wrongly rejected.
fn notes_md_under_root(notes_path: &str) -> Result<std::path::PathBuf, String> {
    if notes_path.starts_with('-') {
        return Err("invalid path".into());
    }
    let abs = std::path::Path::new(notes_path)
        .canonicalize()
        .map_err(|_| "notes.md not found".to_string())?;
    if !abs.is_file() || abs.file_name().and_then(|n| n.to_str()) != Some("notes.md") {
        return Err("not a notes.md file".into());
    }
    let cfg = config::load();
    // Candidate root paths: every entry in the v2 `roots` list + the legacy keys.
    let mut roots: Vec<String> = Vec::new();
    if let Some(arr) = cfg.get("roots").and_then(serde_json::Value::as_array) {
        for r in arr {
            if let Some(p) = r.get("path").and_then(serde_json::Value::as_str) {
                roots.push(p.to_string());
            }
        }
    }
    for k in ["workRoot", "personalRoot"] {
        if let Some(p) = cfg.get(k).and_then(serde_json::Value::as_str) {
            roots.push(p.to_string());
        }
    }
    let under_root = roots.iter().any(|r| {
        std::path::Path::new(r)
            .canonicalize()
            .ok()
            .map(|root| abs.starts_with(&root))
            .unwrap_or(false)
    });
    if !under_root {
        return Err("notes.md is outside the configured roots".into());
    }
    Ok(abs)
}

/// A GitHub pull-request URL: `https://github.com/<owner>/<repo>/pull/<number>`,
/// optionally followed by `/…`, `#…` or `?…`. No whitespace (also keeps it safe to
/// embed in the /start-session shell command, which we shell-quote anyway).
fn is_pr_url(url: &str) -> bool {
    if url.chars().any(|c| c.is_whitespace()) {
        return false;
    }
    let Some(rest) = url.strip_prefix("https://github.com/") else {
        return false;
    };
    let parts: Vec<&str> = rest.splitn(4, '/').collect();
    if parts.len() < 4 || parts[0].is_empty() || parts[1].is_empty() || parts[2] != "pull" {
        return false;
    }
    parts[3].chars().next().is_some_and(|c| c.is_ascii_digit())
}

/// Insert / replace / clear the `pr_link:` line in the leading `---` frontmatter.
/// Empty `url` removes the line (no stale link). Content with no frontmatter block
/// is returned unchanged (every session notes.md has frontmatter).
fn set_pr_link_in_frontmatter(content: &str, url: &str) -> String {
    let Some(rest) = content.strip_prefix("---\n") else {
        return content.to_string();
    };
    let Some(end) = rest.find("\n---") else {
        return content.to_string();
    };
    let (fm, tail) = (&rest[..end], &rest[end..]); // tail starts at "\n---…"
    let mut lines: Vec<String> = Vec::new();
    let mut found = false;
    for l in fm.lines() {
        if l.trim_start().starts_with("pr_link:") {
            found = true;
            if !url.is_empty() {
                lines.push(format!("pr_link: {url}"));
            }
        } else {
            lines.push(l.to_string());
        }
    }
    if !found && !url.is_empty() {
        lines.push(format!("pr_link: {url}"));
    }
    format!("---\n{}{}", lines.join("\n"), tail)
}

/// Append an ARCHIVED bullet at the end of the `## Session history` section
/// (creating the section if absent). Pure + unit-tested — mirrors what /archive-session
/// writes. The dashboard classifies a session as Archived from any history line
/// containing "ARCHIVED" (reader.rs::session_history_info).
fn stamp_archived(content: &str, line: &str) -> String {
    const MARKER: &str = "## Session history";
    match content.find(MARKER) {
        Some(hpos) => {
            // End of the header line, then the section runs to the next "## " / EOF.
            let after_header = content[hpos..].find('\n').map(|i| hpos + i + 1).unwrap_or(content.len());
            let sec_end = content[after_header..]
                .find("\n## ")
                .map(|i| after_header + i)
                .unwrap_or(content.len());
            let body = content[after_header..sec_end].trim_end();
            let new_body = if body.is_empty() { format!("{line}\n") } else { format!("{body}\n{line}\n") };
            format!("{}{}{}", &content[..after_header], new_body, &content[sec_end..])
        }
        None => format!("{}\n\n{MARKER}\n{line}\n", content.trim_end()),
    }
}

/// Drop any active-sessions.json entry pointing at this notes.md (atomic, rewritten
/// only when something changed). Matches the path both as sent and canonicalized — the
/// registry may store either form. Shared by archive_session and delete_session.
fn remove_from_active_sessions(notes_path: &str, abs: &std::path::Path) -> Result<(), String> {
    let active = config::home().join(".claude").join("active-sessions.json");
    if let Ok(s) = std::fs::read_to_string(&active) {
        if let Ok(serde_json::Value::Object(mut map)) = serde_json::from_str(&s) {
            let canon = abs.to_string_lossy();
            let before = map.len();
            map.retain(|_, v| {
                let np = v.get("notes_path").and_then(serde_json::Value::as_str);
                np != Some(notes_path) && np != Some(canon.as_ref())
            });
            if map.len() != before {
                let body = serde_json::to_string_pretty(&serde_json::Value::Object(map))
                    .map_err(|e| e.to_string())?;
                atomic_write(&active, &body)?;
            }
        }
    }
    Ok(())
}

/// Archive a session FROM THE DASHBOARD (ADR-013 — the app's one source-of-truth
/// write, a deliberate derogation from ADR-001): stamps ARCHIVED into notes.md and
/// drops the session from active-sessions.json. Mirrors the /archive-session skill. Writes
/// are atomic and confined to a real notes.md under a configured root.
#[tauri::command(async)]
fn archive_session(notes_path: String) -> Result<(), String> {
    let abs = notes_md_under_root(&notes_path)?;

    // 1) Stamp ARCHIVED into notes.md (atomic).
    let content = std::fs::read_to_string(&abs).map_err(|e| e.to_string())?;
    let date = std::process::Command::new("date")
        .arg("+%Y-%m-%d %H:%M")
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_default();
    let line = format!("- {date} | ARCHIVED | archived from the dashboard");
    atomic_write(&abs, &stamp_archived(&content, &line))?;

    // 2) Drop matching entries from active-sessions.json (atomic).
    remove_from_active_sessions(&notes_path, &abs)?;
    Ok(())
}

/// Permanently remove an ARCHIVED session by moving its session folder to the OS Trash
/// (recoverable from the Finder) — the disk-declutter action (ADR-014). Guards: the path
/// must resolve to a real notes.md confined under a configured root (notes_md_under_root),
/// AND the session must classify as archived — running/closed work is never deletable here.
#[tauri::command(async)]
fn delete_session(notes_path: String) -> Result<(), String> {
    let abs = notes_md_under_root(&notes_path)?;
    let content = std::fs::read_to_string(&abs).map_err(|e| e.to_string())?;
    if reader::session_history_info(&content).0 != "archived" {
        return Err("only archived sessions can be deleted".into());
    }
    // Session folder = the notes.md's parent; notes_md_under_root already proved it's
    // confined under a root, and the parent is the slug dir one level below that.
    let dir = abs.parent().filter(|p| p.is_dir()).ok_or("session folder not found")?;
    // Move to the OS Trash (recoverable) rather than an irreversible hard delete.
    trash::delete(dir).map_err(|e| e.to_string())?;

    // Defensive: drop any active-sessions.json entry pointing at this notes.md.
    remove_from_active_sessions(&notes_path, &abs)?;
    Ok(())
}

/// Set / update / clear the reviewed-PR link on a session (ADR-013 family — the app's
/// 2nd bounded source-of-truth write). Validates a GitHub PR URL (empty = clear),
/// then rewrites the `pr_link:` frontmatter line atomically, confined under a root.
#[tauri::command(async)]
fn set_pr_link(notes_path: String, url: String) -> Result<(), String> {
    let url = url.trim();
    if !url.is_empty() && !is_pr_url(url) {
        return Err("not a GitHub PR URL (https://github.com/owner/repo/pull/N)".into());
    }
    let abs = notes_md_under_root(&notes_path)?;
    let content = std::fs::read_to_string(&abs).map_err(|e| e.to_string())?;
    atomic_write(&abs, &set_pr_link_in_frontmatter(&content, url))
}

/// Open a native folder picker for Settings; returns the chosen absolute path, or
/// null if cancelled. MUST stay `async`: the native panel (rfd) runs on the main
/// thread and `blocking_pick_folder` blocks the caller on a channel — only safe
/// when invoked off the main thread, which `command(async)` guarantees. A sync
/// command here would deadlock the app the moment Browse is clicked.
#[tauri::command(async)]
fn pick_directory(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog()
        .file()
        .blocking_pick_folder()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned())
}

/// Multi-folder picker (Settings → add several categories at once). Same `async`
/// requirement as `pick_directory`. Returns the chosen absolute paths (empty if
/// cancelled).
#[tauri::command(async)]
fn pick_directories(app: tauri::AppHandle) -> Vec<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog()
        .file()
        .blocking_pick_folders()
        .map(|paths| {
            paths
                .into_iter()
                .filter_map(|p| p.into_path().ok())
                .map(|p| p.to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default()
}

/// Export all UI settings (a JSON object built by the renderer from its localStorage
/// `csm.*` keys) to a user-chosen file. The app never writes settings on its own —
/// this is the explicit, manual backup the user takes before a reinstall.
#[tauri::command(async)]
fn export_settings(app: tauri::AppHandle, json: String) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    // Refuse to write anything that isn't a JSON object (guards against junk on disk).
    if !serde_json::from_str::<serde_json::Value>(&json).map(|v| v.is_object()).unwrap_or(false) {
        return Err("settings payload is not a JSON object".into());
    }
    let path = app
        .dialog()
        .file()
        .set_file_name("ai-agents-orchestrator-settings.json")
        .add_filter("JSON", &["json"])
        .blocking_save_file()
        .and_then(|p| p.into_path().ok());
    match path {
        Some(p) => {
            std::fs::write(&p, json).map_err(|e| e.to_string())?;
            Ok(true)
        }
        None => Ok(false), // user cancelled
    }
}

/// Let the user pick a previously-exported settings file; return its contents for the
/// renderer to load back into localStorage. Validated to be a JSON object.
#[tauri::command(async)]
fn import_settings(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let path = app
        .dialog()
        .file()
        .add_filter("JSON", &["json"])
        .blocking_pick_file()
        .and_then(|p| p.into_path().ok());
    match path {
        Some(p) => {
            let content = std::fs::read_to_string(&p).map_err(|e| e.to_string())?;
            if !serde_json::from_str::<serde_json::Value>(&content).map(|v| v.is_object()).unwrap_or(false) {
                return Err("that file isn't a valid settings export".into());
            }
            Ok(Some(content))
        }
        None => Ok(None), // cancelled
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(pty::PtyManager::new())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // One-time startup diagnostic: a missing scan root means the app will
            // silently show no sessions there — the #1 confusing first-run state.
            // Surface it (don't fail) so a tester who skipped install.sh sees why.
            let cfg = config::load();
            for key in ["workRoot", "personalRoot"] {
                if let Some(root) = cfg.get(key).and_then(serde_json::Value::as_str) {
                    if !std::path::Path::new(root).exists() {
                        eprintln!(
                            "[ai-agents-orchestrator] configured {key} '{root}' does not exist — \
                             sessions there won't be found (run scripts/install.sh, or set it in Settings)"
                        );
                    }
                }
            }
            // Paint the window dark from the first frame (the default theme), so the
            // initial paint + any resize before the renderer's applyTheme() runs doesn't
            // flash the OS-default white. applyTheme() corrects it if the saved theme is light.
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_background_color(Some(tauri::window::Color(28, 28, 30, 255)));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            config::get_config,
            config::set_config,
            reader::get_sessions,
            reader::get_historical_sessions,
            reader::get_historical_sessions_all,
            reader::discover_sessions,
            open_external,
            open_path,
            open_in_terminal,
            start_session,
            restore_session,
            import_session,
            detach_session,
            set_always_on_top,
            set_window_bg,
            pick_directory,
            pick_directories,
            export_settings,
            import_settings,
            archive_session,
            delete_session,
            set_pr_link,
            can_reveal_terminal,
            reveal_terminal,
            pty::pty_spawn,
            pty::pty_input,
            pty::pty_resize,
            pty::pty_kill,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // On app exit, kill embedded ptys so their `claude` children don't orphan
            // (which would keep the session "running" with no terminal after reopen).
            if let tauri::RunEvent::ExitRequested { .. } = event {
                app_handle.state::<pty::PtyManager>().kill_all();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::{
        category_root_dir, is_pr_url, is_safe_branch, is_safe_category, is_ticket, percent_encode,
        set_pr_link_in_frontmatter, slugify, stamp_archived,
    };
    use serde_json::json;

    #[test]
    fn slugify_is_byte_faithful_to_the_skill() {
        // Mirrors the skill's slug(): tr lower + sed 's/[^a-z0-9]+/-/g; trim -'.
        assert_eq!(slugify("Hello World"), "hello-world");
        assert_eq!(slugify("  spaced  out  "), "spaced-out"); // runs collapse, ends trimmed
        assert_eq!(slugify("UPPER_case-123"), "upper-case-123");
        assert_eq!(slugify("Fix (bug) 2"), "fix-bug-2");
        // ASCII-only, like `sed` in the C locale: non-ASCII becomes a dash, NOT kept.
        // A Unicode-aware port (char::is_alphanumeric) would wrongly keep 'é' → "café".
        assert_eq!(slugify("My Café Session"), "my-caf-session");
        assert_eq!(slugify("réseau"), "r-seau");
        assert_eq!(slugify(""), "");
        assert_eq!(slugify("---"), "");
    }

    #[test]
    fn category_root_dir_resolves_v2_root_then_falls_back_to_scope() {
        let cfg = json!({
            "home": "/home/u",
            "workRoot": "/w", "personalRoot": "/p",
            "roots": [{"name":"Work","path":"/w"},{"name":"Perso","path":"/p"},{"name":"Clients","path":"/c"}],
        });
        // v2: launch dir = the category's named root path.
        assert_eq!(category_root_dir(&cfg, &json!({"name":"X","root":"Clients"})), "/c");
        assert_eq!(category_root_dir(&cfg, &json!({"name":"X","root":"Perso"})), "/p");
        // Unknown root name → v1 scope fallback (work).
        assert_eq!(category_root_dir(&cfg, &json!({"name":"X","root":"Ghost","scope":"work"})), "/w");
        // No root field at all (v1) → scope fallback.
        assert_eq!(category_root_dir(&cfg, &json!({"name":"X","scope":"personal"})), "/p");
        // No root, no scope → defaults to work root.
        assert_eq!(category_root_dir(&cfg, &json!({"name":"X"})), "/w");
    }

    #[test]
    fn percent_encode_handles_multibyte_and_reserved() {
        assert_eq!(percent_encode("café"), "caf%C3%A9"); // multibyte UTF-8
        assert_eq!(percent_encode("a b/c"), "a%20b%2Fc"); // space + slash
        assert_eq!(percent_encode("AZ09-_.~"), "AZ09-_.~"); // unreserved pass through
    }

    const LINE: &str = "- 2026-06-14 10:00 | ARCHIVED | archived from the dashboard";

    // ── Injection-boundary allowlists ──────────────────────────────────────────
    #[test]
    fn safe_category_accepts_tokens_rejects_metachars() {
        assert!(is_safe_category("FEAT"));
        assert!(is_safe_category("bug-fix_2"));
        assert!(!is_safe_category("")); // empty
        assert!(!is_safe_category(&"x".repeat(21))); // > 20 chars
        assert!(!is_safe_category("a b")); // space
        assert!(!is_safe_category("a;rm")); // shell metachar
        assert!(!is_safe_category("../x")); // path-traversal chars
        assert!(!is_safe_category("café")); // non-ASCII
    }

    #[test]
    fn ticket_accepts_project_keys_only() {
        assert!(is_ticket("ABC-123"));
        assert!(is_ticket("a1-9"));
        assert!(!is_ticket("ABC")); // no dash / number
        assert!(!is_ticket("-123")); // empty key
        assert!(!is_ticket("ABC-")); // empty number
        assert!(!is_ticket("1AB-2")); // key must start with a letter
        assert!(!is_ticket("AB C-2")); // space in key
        assert!(!is_ticket("ABC-12a")); // non-digit in number
    }

    #[test]
    fn safe_branch_blocks_flags_traversal_and_ref_syntax() {
        assert!(is_safe_branch("feat/checkout-redesign"));
        assert!(is_safe_branch("release/1.2.x"));
        assert!(!is_safe_branch("")); // empty
        assert!(!is_safe_branch("-delete")); // leading dash = flag smuggling
        assert!(!is_safe_branch("/abs")); // leading slash
        assert!(!is_safe_branch("trailing/")); // trailing slash
        assert!(!is_safe_branch("a..b")); // `..` revision range
        assert!(!is_safe_branch("HEAD@{1}")); // `@{` reflog syntax
        assert!(!is_safe_branch("a b")); // space
        assert!(!is_safe_branch("a;rm -rf")); // shell metachars
        assert!(!is_safe_branch(&"x".repeat(201))); // > 200 chars
    }

    #[test]
    fn pr_url_accepts_canonical_and_suffixed() {
        assert!(is_pr_url("https://github.com/owner/repo/pull/35"));
        assert!(is_pr_url("https://github.com/o/r/pull/1/files"));
        assert!(is_pr_url("https://github.com/o/r/pull/9#discussion_r1"));
        assert!(is_pr_url("https://github.com/o/r/pull/42?w=1"));
    }

    #[test]
    fn pr_url_rejects_non_pr_and_junk() {
        assert!(!is_pr_url("https://github.com/o/r/issues/3")); // not a PR
        assert!(!is_pr_url("https://github.com/o/r/pull/abc")); // no number
        assert!(!is_pr_url("https://github.com/o/r/pull/")); // missing number
        assert!(!is_pr_url("https://gitlab.com/o/r/pull/3")); // wrong host
        assert!(!is_pr_url("http://github.com/o/r/pull/3")); // not https
        assert!(!is_pr_url("https://github.com/o/r/pull/3 extra")); // whitespace
        assert!(!is_pr_url(""));
    }

    const FM: &str = "---\nname: x\ncategory: REVIEW\nbranch: feat/y\n---\n\n# x\nbody\n";

    #[test]
    fn pr_link_inserts_when_absent() {
        let out = set_pr_link_in_frontmatter(FM, "https://github.com/o/r/pull/5");
        assert!(out.contains("pr_link: https://github.com/o/r/pull/5"));
        // Other keys + body preserved, single frontmatter block.
        assert!(out.contains("category: REVIEW") && out.contains("# x\nbody"));
        assert_eq!(out.matches("\n---").count(), 1);
    }

    #[test]
    fn pr_link_replaces_existing() {
        let with = set_pr_link_in_frontmatter(FM, "https://github.com/o/r/pull/1");
        let out = set_pr_link_in_frontmatter(&with, "https://github.com/o/r/pull/2");
        assert!(out.contains("pull/2") && !out.contains("pull/1"));
        assert_eq!(out.matches("pr_link:").count(), 1);
    }

    #[test]
    fn pr_link_empty_clears_the_line() {
        let with = set_pr_link_in_frontmatter(FM, "https://github.com/o/r/pull/1");
        let out = set_pr_link_in_frontmatter(&with, "");
        assert!(!out.contains("pr_link:"));
        assert!(out.contains("category: REVIEW")); // rest intact
    }

    #[test]
    fn pr_link_noop_without_frontmatter() {
        let plain = "# no frontmatter\nbody\n";
        assert_eq!(set_pr_link_in_frontmatter(plain, "https://github.com/o/r/pull/1"), plain);
    }

    #[test]
    fn appends_after_existing_history_entries() {
        let notes = "# Title\n\n## Session history\n- 2026-05-04 12:31 | session=abc | did stuff\n";
        let out = stamp_archived(notes, LINE);
        assert!(out.contains("did stuff"));
        assert!(out.contains("ARCHIVED"));
        // ARCHIVED comes after the existing entry, inside the section.
        assert!(out.find("did stuff").unwrap() < out.find("ARCHIVED").unwrap());
    }

    #[test]
    fn inserts_inside_section_when_history_is_not_last() {
        let notes = "## Session history\n- a | session=x\n\n## Next steps\n1. do\n";
        let out = stamp_archived(notes, LINE);
        // ARCHIVED must land before the next section header, not after it.
        assert!(out.find("ARCHIVED").unwrap() < out.find("## Next steps").unwrap());
        assert!(out.contains("## Next steps")); // section preserved
    }

    #[test]
    fn creates_section_when_absent() {
        let notes = "# Title\n\n## Goal\nstuff";
        let out = stamp_archived(notes, LINE);
        assert!(out.contains("## Session history"));
        assert!(out.contains("ARCHIVED"));
    }

    #[test]
    fn handles_empty_history_section() {
        let notes = "## Session history\n";
        let out = stamp_archived(notes, LINE);
        assert!(out.contains("ARCHIVED"));
    }
}
