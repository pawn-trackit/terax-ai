import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// The focused worktree the sidebar should follow. Emitted by the Rust herdr
// watcher and returned by the on-demand resolve command.
export type HerdrFocus = {
  root: string;
  label: string | null;
  workspaceId: string;
  kind: "worktree" | "cwd";
};

// Subscribe to herdr focus changes pushed from the Rust watcher.
export function onHerdrFocusChanged(
  cb: (focus: HerdrFocus) => void,
): Promise<UnlistenFn> {
  return listen<HerdrFocus>("herdr:focus-changed", (e) => cb(e.payload));
}

// Resolve the currently-focused worktree once (null when herdr is unavailable).
export function resolveHerdrWorktree(): Promise<HerdrFocus | null> {
  return invoke<HerdrFocus | null>("herdr_resolve_worktree");
}
