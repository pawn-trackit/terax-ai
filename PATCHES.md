# PATCHES — herdr fork divergence log

This fork tracks upstream **terax** (`crynta/terax-ai`) and layers herdr awareness on top.
Goal: keep merging upstream updates. Every change that touches an **upstream-owned file**
is listed here — it is the conflict surface to review before each `git rebase main`.

Git model:
- `main` mirrors upstream untouched (`git fetch upstream && git merge --ff-only upstream/main`).
- All herdr work lives on the `herdr` branch; sync by `git rebase main` (keeps a clean replayable patch series).
- Add-only files (below) never conflict and are **not** listed as touch-points.

## Add-only modules (no upstream surface)

- `src-tauri/src/modules/herdr/{mod,client,protocol}.rs` — unix-socket client: a read-only
  `events.subscribe` task + one-shot `workspace.list`/`pane.list` resolves; emits `herdr:focus-changed`.
- `src/modules/herdr/{index,client,useHerdrWorktree}.ts` — `listen()` for that event +
  `useHerdrWorktree()` hook returning the focused worktree root (or `null` when herdr is absent).
- `herdr-focus-watch.mjs` — standalone PoC of the socket protocol (reference / smoke test).
- `src/modules/editor/SideBySideDiff.tsx` — MergeView two-column read-only diff; owns the
  MergeView lifecycle (mount/destroy, async language reconfigure on both sides). The diff
  panes swap their inline render for this.

## Upstream touch-points (the conflict surface)

| File | Change | Why it must edit upstream | Merge risk |
|------|--------|---------------------------|------------|
| `src-tauri/src/modules/mod.rs` | `+ pub mod herdr;` | module registration list | trivial (adjacent add) |
| `src-tauri/src/lib.rs` | import `herdr`; `herdr::spawn_focus_watcher(...)` in `.setup`; `herdr::herdr_resolve_worktree` in `invoke_handler!` | command + background task registration | low (3 adjacent adds) |
| `src-tauri/Cargo.toml` | tokio `features += net, io-util, time` | `UnixStream` + async read/write + backoff | trivial |
| `src/app/App.tsx` | (1) wrap `explorerRoot` with `useHerdrWorktree()` at the `useWorkspaceCwd` destructure; (2) override `activeTerminalLeafCwd` in the `useSourceControlContext({...})` call | single point where the workspace cwd is derived + the one spot where source-control prefers the terminal cwd | **the hot spot** — App.tsx is churned; keep edits to these 2 sites |
| `src/modules/editor/{GitDiffPane,AiDiffPane}.tsx` | swap the inline `unifiedMergeView` render for `<SideBySideDiff/>` (two-column); drop now-unused imports/hooks | MergeView is a class, not an extension, so the `<CodeMirror>` block is replaced; these are the only diff renderers | low — mechanical swap isolated to each render block (each pane keeps its own `DIFF_THEME`) |

## Decisions encoded here

- **Binding granularity:** workspace (= git worktree root), not per-pane cwd. Subscribes to
  `workspace.focused` only, so pane/tab switches within a workspace do not move the sidebar.
- **Source-control authority:** the herdr worktree overrides the active terminal's own cwd
  for source-control (App.tsx touch-point #2). To instead let the terminal's `cd` win for
  source-control, drop that one override and edit only the `explorerRoot` site.

## Deferred (not yet implemented)

- Open file in a right split panel: new add-only `WorkspaceSplit.tsx` wrapper around the
  existing `WorkspaceSurface`; aim for zero edits to `WorkspaceSurface.tsx` / `useTabs.ts`.
