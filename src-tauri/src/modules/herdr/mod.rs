//! herdr integration — mirrors herdr's focused workspace (= git worktree root,
//! or focused-pane cwd when not git-backed) into terax's sidebar/source-control.
//!
//! Add-only module. The few upstream touch-points it needs (modules/mod.rs,
//! lib.rs setup + invoke_handler, Cargo.toml tokio features) are logged in PATCHES.md.
//! herdr's socket is unix-only, so all socket code is `#[cfg(unix)]`; on other
//! platforms the public surface degrades to no-ops.

#[cfg(unix)]
mod client;
#[cfg(unix)]
mod protocol;

use serde::Serialize;
use tauri::AppHandle;

/// The path the sidebar/source-control should follow, plus how it was resolved.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FocusInfo {
    pub root: String,
    pub label: Option<String>,
    pub workspace_id: String,
    /// "worktree" (git worktree root) or "cwd" (focused-pane fallback).
    pub kind: String,
}

/// Spawn the background task that subscribes to herdr focus events and emits
/// `herdr:focus-changed` to the frontend. No-op on non-unix (herdr is unix-only).
#[cfg(unix)]
pub fn spawn_focus_watcher(app: AppHandle) {
    client::spawn_focus_watcher(app);
}

#[cfg(not(unix))]
pub fn spawn_focus_watcher(_app: AppHandle) {}

/// On-demand resolve of the currently-focused worktree (frontend `invoke`).
#[tauri::command]
pub async fn herdr_resolve_worktree() -> Result<Option<FocusInfo>, String> {
    #[cfg(unix)]
    {
        client::resolve_current().await
    }
    #[cfg(not(unix))]
    {
        Ok(None)
    }
}
