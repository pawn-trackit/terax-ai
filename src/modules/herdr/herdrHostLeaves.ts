import { useSyncExternalStore } from "react";

// Per-leaf foreground-command tracking, fed by the terminal session's OSC 133
// C/D handler, used by App to decide sidebar authority.
//
// herdr is a background daemon that always reports a focused worktree, so a
// static "herdr always wins" override permanently freezes the sidebar. Instead
// the terminal's own cwd wins from a pane we know is a plain (non-herdr) shell:
//
//   plain shell  ⇔  NOT running herdr  AND  (at a prompt  OR  running a command
//                   we could identify)
//
// "At a prompt" (OSC 133 A/D, no command running) makes a freshly-focused tab —
// and a pane where herdr just exited — follow its own cwd immediately, with no
// command needed. The only case that keeps herdr's authority for a non-herdr
// pane is a command we cannot identify (bash sends a bare OSC 133 C with no
// command line; macOS bash 3.2 none) — a fail-safe so a bash herdr pane is never
// misread as plain. herdr-host detection of a running command needs zsh/fish/pwsh.

type LeafState = {
  running: boolean; // a foreground command is executing (between C and D/A)
  identified: boolean; // that command's name was carried on OSC 133 C
  herdr: boolean; // that command is herdr
};

const leaves = new Map<number, LeafState>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const cb of listeners) cb();
}

// First program token's base name === "herdr", skipping env assignments,
// flags, and common wrappers (sudo/env/...). Bare `herdr` is the documented
// invocation (shell_init strips HERDR_* so it runs unwrapped); the skips are
// defensive for `sudo herdr` / `env X=1 herdr` / a pathed binary.
const WRAPPERS = new Set(["env", "sudo", "doas", "command", "nice", "exec"]);

function commandIsHerdr(command: string | undefined): boolean {
  if (!command) return false;
  for (const token of command.trim().split(/\s+/)) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue; // VAR=val
    if (token.startsWith("-")) continue; // flag
    const base = token.split(/[\\/]/).pop() ?? token;
    if (WRAPPERS.has(base)) continue; // sudo/env/... wrapper
    return base === "herdr";
  }
  return false;
}

function isPlainShell(leafId: number | null | undefined): boolean {
  if (leafId == null) return false; // non-terminal tab → herdr keeps authority
  const st = leaves.get(leafId);
  if (!st) return true; // no command seen yet → idle prompt → plain
  return !st.herdr && (!st.running || st.identified);
}

/**
 * Record a leaf's foreground-command transition. OSC 133 C (running=true)
 * carries the command line; D/A (running=false) returns to the prompt. Leaf
 * IDs are monotonic, so a closed leaf's stale entry is harmless (never re-read).
 */
export function noteLeafCommand(
  leafId: number,
  running: boolean,
  command?: string,
): void {
  const next: LeafState = running
    ? {
        running: true,
        identified: !!command,
        herdr: commandIsHerdr(command),
      }
    : { running: false, identified: false, herdr: false };
  const prev = leaves.get(leafId);
  if (
    prev &&
    prev.running === next.running &&
    prev.identified === next.identified &&
    prev.herdr === next.herdr
  ) {
    return;
  }
  leaves.set(leafId, next);
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Whether the given leaf is a plain shell that should drive the sidebar from
 * its own cwd (taking authority from herdr). False for herdr-hosting panes,
 * non-terminal tabs, and unidentifiable running commands (fail-safe). Reactive.
 */
export function useLeafIsPlainShell(leafId: number | null | undefined): boolean {
  return useSyncExternalStore(subscribe, () => isPlainShell(leafId));
}

// Test-only synchronous accessors (avoid React render plumbing in unit tests).
export const __test = { isPlainShell, reset: () => leaves.clear() };
