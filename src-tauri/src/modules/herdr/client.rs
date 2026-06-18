//! herdr socket client (unix only).
//!
//! Two connection roles, matching herdr's protocol (verified against herdr 0.6.x):
//!   - a long-lived `events.subscribe` stream that is **read-only** — writing any
//!     further request onto it makes herdr close the connection;
//!   - short-lived one-shot connections for `workspace.list` / `pane.list` resolves.
//!
//! On each focus event we re-resolve over a fresh connection and emit
//! `herdr:focus-changed` to the frontend. Reconnection lives here, off the UI.

use std::path::Path;
use std::time::Duration;

use serde::de::DeserializeOwned;
use serde_json::json;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;

use super::protocol::{socket_path, PaneListResult, Response, WorkspaceListResult};
use super::FocusInfo;

/// Open a fresh connection, send one request, read exactly one response line.
async fn one_shot<T: DeserializeOwned>(path: &Path, method: &str) -> Result<T, String> {
    let stream = UnixStream::connect(path).await.map_err(|e| e.to_string())?;
    let (rd, mut wr) = stream.into_split();
    let req = json!({ "id": "q", "method": method, "params": {} });
    wr.write_all(format!("{}\n", req).as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(rd);
    let mut line = String::new();
    reader
        .read_line(&mut line)
        .await
        .map_err(|e| e.to_string())?;
    let resp: Response<T> = serde_json::from_str(line.trim()).map_err(|e| e.to_string())?;
    resp.result
        .ok_or_else(|| format!("herdr: no result for {method}"))
}

/// Resolve the focused workspace's worktree root, falling back to the focused
/// pane's cwd when that workspace is not git-backed (so the tree is never blank).
async fn resolve(path: &Path) -> Option<FocusInfo> {
    let wl: WorkspaceListResult = one_shot(path, "workspace.list").await.ok()?;
    let ws = wl.workspaces.into_iter().find(|w| w.focused)?;
    // Reject empty roots: an empty `checkout_path`/`cwd` (e.g. a freshly created
    // pane mid-startup when herdr is re-launched) would otherwise emit root="",
    // which the frontend's `?? cwd` fallback can't catch → the sidebar blanks.
    if let Some(root) = ws
        .worktree
        .and_then(|w| w.checkout_path)
        .filter(|p| !p.is_empty())
    {
        return Some(FocusInfo {
            root,
            label: ws.label,
            workspace_id: ws.workspace_id,
            kind: "worktree".to_string(),
        });
    }
    let pl: PaneListResult = one_shot(path, "pane.list").await.ok()?;
    let cwd = pl
        .panes
        .into_iter()
        .find(|p| p.focused)
        .and_then(|p| p.cwd)
        .filter(|c| !c.is_empty())?;
    Some(FocusInfo {
        root: cwd,
        label: ws.label,
        workspace_id: ws.workspace_id,
        kind: "cwd".to_string(),
    })
}

/// One watch session: emit the current state, subscribe to focus changes, then
/// re-resolve and emit on every focus event until the connection drops.
async fn watch_once(app: &AppHandle, path: &Path) -> Result<(), String> {
    if let Some(info) = resolve(path).await {
        let _ = app.emit("herdr:focus-changed", &info);
    }

    let stream = UnixStream::connect(path).await.map_err(|e| e.to_string())?;
    let (rd, mut wr) = stream.into_split();
    let sub = json!({
        "id": "sub",
        "method": "events.subscribe",
        "params": { "subscriptions": [{ "type": "workspace.focused" }] }
    });
    wr.write_all(format!("{}\n", sub).as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    // `wr` is intentionally kept alive for the stream's lifetime but never
    // written to again: this is the read-only events connection.

    let mut reader = BufReader::new(rd);
    let mut line = String::new();
    loop {
        line.clear();
        let n = reader
            .read_line(&mut line)
            .await
            .map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("herdr socket closed".into());
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) else {
            continue;
        };
        // The subscription ack carries `result`; focus events carry `event`/`data`.
        if v.get("result").is_some() {
            continue;
        }
        if v.get("event").is_some() || v.get("data").is_some() {
            if let Some(info) = resolve(path).await {
                let _ = app.emit("herdr:focus-changed", &info);
            }
        }
    }
}

/// Background task: keep a focus subscription alive, reconnecting with backoff
/// when herdr is not running yet or restarts.
pub fn spawn_focus_watcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            match socket_path() {
                Some(path) => {
                    if let Err(e) = watch_once(&app, &path).await {
                        log::debug!("herdr watch ended: {e}");
                    }
                }
                None => {}
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    });
}

/// On-demand resolve for the frontend `invoke`.
pub async fn resolve_current() -> Result<Option<FocusInfo>, String> {
    match socket_path() {
        Some(path) => Ok(resolve(&path).await),
        None => Ok(None),
    }
}
