//! Lightweight "check for updates" against the project's public GitHub releases.
//!
//! Runs in Rust (via reqwest) so the renderer's CSP can stay locked to `'self'`
//! (a direct fetch to api.github.com from the web layer would be blocked). It
//! reads only public release metadata — no auth header, no secrets.

use crate::error::{Error, Result};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseInfo {
    /// Version parsed from the release tag, leading "v" stripped (e.g. "0.2.0").
    pub version: String,
    /// The release tag as published (e.g. "v0.2.0").
    pub tag: String,
    /// The release page URL (where the installer is downloaded).
    pub url: String,
    /// Release notes (markdown), possibly empty.
    pub notes: String,
}

/// Fetch the latest published (non-draft, non-prerelease) GitHub release for
/// `repo` (in "owner/name" form). Returns `Ok(None)` when there is no published
/// release yet, so the UI can simply treat "no update" as the default.
#[tauri::command]
pub async fn check_latest_release(repo: String) -> Result<Option<ReleaseInfo>> {
    if repo.is_empty()
        || repo.len() > 200
        || repo.contains(char::is_whitespace)
        || !repo.contains('/')
    {
        return Err(Error::Invalid("invalid repository slug".into()));
    }

    let url = format!("https://api.github.com/repos/{repo}/releases/latest");
    let resp = reqwest::Client::new()
        .get(&url)
        // GitHub requires a User-Agent; the Accept header pins the API version.
        .header("User-Agent", "TurboFiles")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| Error::Connection(format!("could not reach GitHub: {e}")))?;

    // No release published yet (or repo not found) — not an error for the UI.
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !resp.status().is_success() {
        return Err(Error::Remote(format!(
            "update check failed ({})",
            resp.status()
        )));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| Error::Remote(format!("invalid release data: {e}")))?;

    let tag = json
        .get("tag_name")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    if tag.is_empty() {
        return Ok(None);
    }

    Ok(Some(ReleaseInfo {
        version: tag.trim_start_matches('v').to_string(),
        tag,
        url: json
            .get("html_url")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        notes: json
            .get("body")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
    }))
}
