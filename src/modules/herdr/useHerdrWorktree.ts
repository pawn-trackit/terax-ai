import { useEffect, useState } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";

import { onHerdrFocusChanged, resolveHerdrWorktree } from "./client";

/**
 * The worktree root of herdr's currently-focused workspace, or `null` when
 * herdr is unavailable (so callers fall back to terax's own cwd derivation).
 *
 * Resolves once on mount, then follows herdr focus changes via a push event —
 * no polling. The connection/reconnection lives in the Rust watcher.
 */
export function useHerdrWorktree(): string | null {
  const [root, setRoot] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | undefined;

    resolveHerdrWorktree()
      .then((focus) => {
        if (!cancelled && focus) setRoot(focus.root);
      })
      .catch(() => {});

    onHerdrFocusChanged((focus) => setRoot(focus.root))
      .then((un) => {
        if (cancelled) un();
        else unlisten = un;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return root;
}
