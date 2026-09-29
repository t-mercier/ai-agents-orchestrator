//! In-app updates without an Apple Developer ID.
//!
//! Tauri's updater verifies every download against the public key baked into
//! tauri.conf.json, signed in CI with our own key — Apple's notarisation plays no part. The
//! app downloads the archive itself, so macOS never tags it with the quarantine flag a
//! browser download gets, and the `xattr -cr` step is only needed for the first install.

use serde_json::{json, Value};
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

/// The update feed, from `AO_UPDATER_ENDPOINT` when set, which is how a local end-to-end
/// test points the app at a feed it serves itself. Only https, or plain http on the loopback
/// interface, is accepted: the signature check already rejects a forged archive, and this
/// keeps an update check from ever going to an arbitrary host in the clear. The plugin
/// itself still refuses plain http unless the build sets
/// `plugins.updater.dangerousInsecureTransportProtocol`, which no release build does.
pub(crate) fn endpoint_override(raw: Option<&str>) -> Option<url::Url> {
    let url = url::Url::parse(raw?.trim()).ok()?;
    let loopback = matches!(url.host_str(), Some("127.0.0.1") | Some("localhost") | Some("[::1]"));
    match url.scheme() {
        "https" => Some(url),
        "http" if loopback => Some(url),
        _ => None,
    }
}

/// The override applies only where a test needs it: a development build, or the
/// `updater-e2e` test build. A release build reads the feed in tauri.conf.json and nothing
/// else — the signature covers the archive, not the version a feed claims, so a
/// substituted feed could offer an older signed release as a newer one.
pub(crate) fn feed_override(raw: Option<&str>, allowed: bool) -> Option<url::Url> {
    if allowed { endpoint_override(raw) } else { None }
}

const OVERRIDE_ALLOWED: bool = cfg!(any(debug_assertions, feature = "updater-e2e"));

fn updater(app: &AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
    // A slow network must not hold the launch notices back indefinitely.
    let mut builder = app.updater_builder().timeout(std::time::Duration::from_secs(15));
    if let Some(url) = feed_override(std::env::var("AO_UPDATER_ENDPOINT").ok().as_deref(), OVERRIDE_ALLOWED) {
        builder = builder.endpoints(vec![url]).map_err(|e| e.to_string())?;
    }
    builder.build().map_err(|e| e.to_string())
}

/// A development build runs from a checkout, which `git pull` updates; offering it the
/// published release would replace the developer's own build. It checks only when a test
/// feed is set explicitly.
fn checks_updates() -> bool {
    !cfg!(debug_assertions) || std::env::var_os("AO_UPDATER_ENDPOINT").is_some()
}

/// The newer release, if there is one: `{ version, current, notes }`, or `null`.
#[tauri::command(async)]
pub async fn app_update_check(app: AppHandle) -> Result<Value, String> {
    if !checks_updates() {
        return Ok(Value::Null);
    }
    let update = updater(&app)?.check().await.map_err(|e| e.to_string())?;
    Ok(match update {
        Some(u) => json!({ "version": u.version, "current": u.current_version, "notes": u.body }),
        None => Value::Null,
    })
}

/// How long the download of a release may take: the archive is a few megabytes.
const DOWNLOAD_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10 * 60);

/// Download the newer release, verify its signature, install it, and restart into it.
#[tauri::command(async)]
pub async fn app_update_install(app: AppHandle) -> Result<(), String> {
    let mut update = updater(&app)?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no newer version is available".to_string())?;
    // The check's timeout does not carry over to the download: without one, a stalled
    // download left "Installing…" spinning for ever.
    update.timeout = Some(DOWNLOAD_TIMEOUT);
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    app.restart();
}

/// Installs the newer release as soon as the app starts, so an unattended run proves the
/// whole A → B cycle without anyone clicking the banner. Test builds only.
#[cfg(feature = "updater-e2e")]
pub(crate) fn install_on_launch(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Err(e) = app_update_install(app).await {
            eprintln!("[updater-e2e] install failed: {e}");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{endpoint_override, feed_override};

    #[test]
    fn a_test_feed_must_be_https_or_on_this_machine() {
        assert!(endpoint_override(Some("https://example.com/latest.json")).is_some());
        assert!(endpoint_override(Some("http://127.0.0.1:8123/latest.json")).is_some());
        assert!(endpoint_override(Some("http://localhost:8123/latest.json")).is_some());
        assert!(endpoint_override(Some("http://example.com/latest.json")).is_none(), "plain http off the machine");
        assert!(endpoint_override(Some("file:///tmp/latest.json")).is_none());
        assert!(endpoint_override(Some("not a url")).is_none());
        assert!(endpoint_override(None).is_none());
    }

    // A release build must only ever read the feed baked into tauri.conf.json: the
    // signature covers the archive, not the version a feed claims, so a substituted feed
    // could offer an older signed release as newer.
    #[test]
    fn a_release_build_ignores_the_feed_override() {
        assert!(feed_override(Some("https://example.com/latest.json"), false).is_none());
        assert!(feed_override(Some("https://example.com/latest.json"), true).is_some());
    }
}
