//! Wire types for the herdr control socket (newline-delimited JSON-RPC).
//! Platform-independent: pure serde + socket-path resolution.

use std::path::PathBuf;

use serde::Deserialize;

/// Resolve the herdr control socket: `$HERDR_SOCKET_PATH`, else `~/.config/herdr/herdr.sock`.
pub fn socket_path() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("HERDR_SOCKET_PATH") {
        if !p.is_empty() {
            return Some(PathBuf::from(p));
        }
    }
    dirs::home_dir().map(|h| h.join(".config/herdr/herdr.sock"))
}

/// A response envelope: `{"id":..,"result":{..}}`. We only read `result`
/// (its nested `type` tag and any extra fields are ignored by serde).
#[derive(Deserialize)]
pub struct Response<T> {
    pub result: Option<T>,
}

#[derive(Deserialize)]
pub struct WorkspaceListResult {
    #[serde(default)]
    pub workspaces: Vec<WorkspaceInfo>,
}

#[derive(Deserialize)]
pub struct WorkspaceInfo {
    pub workspace_id: String,
    #[serde(default)]
    pub focused: bool,
    #[serde(default)]
    pub label: Option<String>,
    /// Present only for git-backed workspaces; absent for plain directories.
    #[serde(default)]
    pub worktree: Option<Worktree>,
}

#[derive(Deserialize)]
pub struct Worktree {
    #[serde(default)]
    pub checkout_path: Option<String>,
}

#[derive(Deserialize)]
pub struct PaneListResult {
    #[serde(default)]
    pub panes: Vec<PaneInfo>,
}

#[derive(Deserialize)]
pub struct PaneInfo {
    #[serde(default)]
    pub focused: bool,
    #[serde(default)]
    pub cwd: Option<String>,
}
