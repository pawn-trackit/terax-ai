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
  `resolve()` rejects empty `checkout_path`/`cwd` (a freshly created pane mid-relaunch can report
  `""`, which would emit root="" and blank the sidebar — the frontend `?? cwd` fallback can't catch
  an empty string).
- `src/modules/herdr/{index,client,useHerdrWorktree}.ts` — `listen()` for that event +
  `useHerdrWorktree()` hook returning the focused worktree root (or `null` when herdr is absent).
- `src/modules/herdr/herdrHostLeaves.ts` (+ `.test.ts`) — reactive per-leaf foreground-command store
  fed by the terminal's OSC 133 C/D handler. Per leaf: `running` (a command is executing),
  `identified` (its name rode OSC 133 C), `herdr` (it is herdr). `useLeafIsPlainShell(leafId)` =
  `!herdr && (!running || identified)` — a pane is plain (terminal cwd wins) when idle at a prompt
  **or** running an identified non-herdr command; it keeps herdr authority only while running herdr
  or an *unidentifiable* command (bash sends a bare `C`; macOS bash 3.2 none — fail-safe so a bash
  herdr pane is never misread as plain). Being plain *at the prompt* makes a freshly-focused tab
  follow its own cwd immediately (no need to run a command). herdr-host detection of a running
  command requires zsh/fish/pwsh.
- `herdr-focus-watch.mjs` — standalone PoC of the socket protocol (reference / smoke test).
- `src/modules/editor/SideBySideDiff.tsx` — MergeView two-column read-only diff; owns the
  MergeView lifecycle (mount/destroy, async language reconfigure on both sides). The diff
  panes swap their inline render for this. Takes a `collapseUnchanged` prop: when true,
  folds long unchanged stretches (`{margin:3,minSize:6}`); when false, passes `undefined`
  so the whole file shows. Wired to the `diffCollapseUnchanged` pref (default off).
  Renders the `DiffOverviewRuler` overlay on the right and bumps a `geomVersion` (from a
  b-side `updateListener` on height/geometry/doc changes) so the ruler recomputes marks.
  The outer wrapper carries `zoom-exempt` (like EditorPane/TerminalPane) — the app zooms
  via CSS `zoom`, which breaks CodeMirror's mouse-coordinate mapping (drag-select starts
  offset); the shared extensions re-apply zoom via `.cm-scroller` font-size, so net zoom
  is 1.0 and selection is pixel-exact.
  On opening a new file (tracked by `lastScrolledPathRef`), auto-scrolls `merge.dom` to the
  first chunk (minus 2 lines of context) so a diff lands on the first change, not line 1;
  gated by path so refreshes/theme-toggles of the same file keep the user's scroll.
- `src/modules/editor/UnifiedDiff.tsx` — single-pane (inline) diff via `unifiedMergeView`
  on `@uiw/react-codemirror`, restored from the pre-fork rendering (commit `8b80d31^`).
  Same prop shape as `SideBySideDiff` (minus `diffTheme`; it carries its own unified-class
  theme — no `cm-merge-a/b` sides) so the diff panes switch on the `diffSideBySide` pref.
  `zoom-exempt`; auto-scrolls to the first chunk on a new path (chunks compute async →
  retried over a few frames via `getChunks`).
- `src/modules/editor/DiffOverviewRuler.tsx` — right-edge overview scrollbar for the diff.
  Reads `MergeView.chunks` (covers off-screen changes; positions via the height map, not
  DOM) → colored ticks (red removed / green added / amber modified) + a draggable thumb
  reflecting the visible range. Hides the native `.cm-mergeView` scrollbar via a one-time
  injected `<style>` (no upstream surface). `SideBySideDiff` reserves the gutter with
  `[&_.cm-mergeView]:pr-3`.
- `src/modules/editor/lib/diffThemes.ts` — `sideBySideDiffTheme`, the side-qualified red/green diff
  colors (`cm-merge-a` before = red, `cm-merge-b` after = green) shared by the git + AI diff panes.
  Extracted so the two panes can't drift apart (they were byte-identical copies, and AiDiffPane had
  already lost the `.cm-collapsedLines` rule).

## Upstream touch-points (the conflict surface)

| File | Change | Why it must edit upstream | Merge risk |
|------|--------|---------------------------|------------|
| `src-tauri/src/modules/mod.rs` | `+ pub mod herdr;` | module registration list | trivial (adjacent add) |
| `src-tauri/src/lib.rs` | import `herdr`; `herdr::spawn_focus_watcher(...)` in `.setup`; `herdr::herdr_resolve_worktree` in `invoke_handler!` | command + background task registration | low (3 adjacent adds) |
| `src-tauri/Cargo.toml` | tokio `features += net, io-util, time` | `UnixStream` + async read/write + backoff | trivial |
| `src/app/App.tsx` | derive `herdrAuthoritative` = `useLeafIsPlainShell(activeLeaf) ? null : useHerdrWorktree()` and use it at (1) `explorerRoot` (the `useWorkspaceCwd` destructure) and (2) `activeTerminalLeafCwd` in the `useSourceControlContext({...})` call | herdr is an always-on daemon, so an unconditional `herdrWorktree ?? cwd` override permanently froze the sidebar — terminal `cd`/tab-switch never moved it. Scoping authority to the active pane (herdr loses only when the active pane is a known plain shell) restores terminal navigation while keeping the herdr binding for the herdr pane + editor tabs | **the hot spot** — App.tsx is churned; keep edits to these 2 sites + the `herdrAuthoritative` derivation |
| `src/modules/terminal/lib/osc-handlers.ts` (+ `.test.ts`) | `registerPromptTracker`'s `onCommandState` passes the OSC 133 C command line (`data.slice(2)` after `C;`) as a 2nd arg | herdr-host detection needs to know *which* command is foreground; the command already rides OSC 133 C (`\e]133;C;<cmd>`) | low — one extra callback arg (back-compat optional); 2 test assertions updated + 1 added |
| `src/modules/terminal/lib/useTerminalSession.ts` | in the `registerPromptTracker` callback also call `noteLeafCommand(leafId, running, command)` (import from `@/modules/herdr`) | feeds the per-leaf foreground-command store that drives sidebar authority | low — one added call + one import in the existing callback |
| `src/modules/explorer/lib/useFileTree.ts` | on root change, after `setNodes({})` also set `nodesRef.current = {}` synchronously | `nodesRef` only updates after the next render; a fast (cached) `fetchChildren` then reads the stale pre-clear "loaded" node, hits the `sameDirListing` early-return, and skips re-populating — leaving a **valid root with an empty tree** on rapid root changes (exposed by sidebar authority flipping between cwd and herdr worktree; a latent upstream race) | low — one line; upstream-worthy bugfix (consider a PR) |
| `src/modules/editor/{GitDiffPane,AiDiffPane}.tsx` | (base: each pane already renders `<SideBySideDiff/>` — committed at `8b80d31`). Working-tree change: read `diffSideBySide` + `diffCollapseUnchanged` from prefs; render `<SideBySideDiff/>` when `diffSideBySide` (default) else `<UnifiedDiff/>`; pass `collapseUnchanged`; replace the per-pane `DIFF_THEME` with the shared `sideBySideDiffTheme` from `./lib/diffThemes` | these are the only diff renderers; both consume the prefs the same way they already read `editorTheme`; the shared theme makes before-side deletions red without the two panes drifting | low — additive branch + pref reads + theme-import swap. **Two separable PRs:** (1) the side-qualified red/green theme (a small correctness fix), (2) the unified↔side-by-side toggle |
| `src/modules/terminal/lib/rendererPool.ts` | add the `[herdr]` TUI scroll-amplifier (`attachScrollAmplifier`: re-dispatch synthetic wheel events so each physical notch forwards ~3 to the foreground app) | xterm forwards one wheel event per physical notch and doesn't scale by scroll amount, so full-screen TUIs (less/htop) crawl one line per notch | low — additive listener on the term host. **NB:** the earlier multi-word-font quoting fix was **dropped on rebase** — upstream shipped its own equivalent `resolveFontFamily()`, which `rendererPool` (font call), `ShellInput`, and `fonts.ts` now use, so those three no longer diverge |
| `src-tauri/src/modules/pty/shell_init.rs` | in `apply_common()`, strip every `HERDR_*` env var from the spawned PTY command | running `herdr` inside terax's own terminal aborts with "nested herdr is disabled by default" because the child inherits terax's `HERDR_*` session env — the one-window workflow (herdr inside the app's terminal) needs that env gone | low — one additive loop next to the existing appimage `env_remove` calls |
| `src/modules/settings/store.ts` | add the `diffCollapseUnchanged` (default `false`) + `diffSideBySide` (default `true`) boolean prefs (type, KEY, default, loader, setter, change-map entry each) | the diff-collapse & diff-layout toggles need persisted prefs. **NB:** `DEFAULT_THEME_ID` here is **not** just the default preference — `ThemeProvider` imports it as the "apply no theme / use base CSS" sentinel (`clearTheme()`), so it must stay `"terax-default"`. Changing it to `"catppuccin"` makes selecting catppuccin trigger `clearTheme()` → the app silently falls back to terax-default. | trivial (additive). **NB:** the `"catppuccin-mocha"` editor-theme registration was **dropped on rebase** — upstream now ships catppuccin-mocha + catppuccin-latte in `EDITOR_THEMES`/`cmThemes` |
| `src/settings/sections/GeneralSection.tsx` | add "Side-by-side diff" (default on) + "Collapse unchanged lines in diff" (default off) `Switch`es to the Editor group, wired to `setDiffSideBySide` / `setDiffCollapseUnchanged` | the diff-layout + diff-collapse prefs need UI controls; the Editor settings group is their natural home next to Vim mode / Auto save | low — additive `SettingRow`s + imports + store reads |
| `src/modules/source-control/SourceControlPanel.tsx` | add a bright per-status letter badge (`A/M/D/R/U`, colored + `title`) at each changed-file row's right edge via new `statusLetterClass`/`statusTitle` helpers; raise the left accent bar's idle opacity `55→90`; **make the whole row open the file** — move the open `onClick` from the inner filename `<button>` (now a plain `<div>`) to the row container (+`cursor-pointer`), and `stopPropagation` on the stage checkbox + discard wrappers so they don't also open | the 2px accent bar alone was too faint to tell added/modified/deleted apart; clicking the row's padding/empty area did nothing — only the filename text opened the file | low — additive helpers + badge `<span>` + row `onClick` + 2 `stopPropagation` guards in `RowRenderer` |
| `src/modules/theme/themes/catppuccin.ts` | set the dark palette to a lifted slate (`background`/`terminal.background` `#252e3d`, panels `#1f2733`) ≈ ghostty's catppuccin-over-blurred-wallpaper apparent tone; add `terminal.background`; point `editorTheme` at upstream's `{ dark: "catppuccin-mocha", light: "catppuccin-latte" }` | the opaque background should read like ghostty's glass (lifted), not pure `#1e1e2e` which looks near-black; the theme shipped with no terminal background (terminal fell back darker) and used the unrelated atomone editor theme — upstream now ships matching catppuccin editor themes to point at | low (built-in theme file; values + additive). Only the palette diverges now; the editor-theme files (`catppuccinMocha.ts`, `themes.ts` registration) were dropped on rebase in favor of upstream's |

## Decisions encoded here

- **Binding granularity:** workspace (= git worktree root), not per-pane cwd. Subscribes to
  `workspace.focused` only, so pane/tab switches within a workspace do not move the sidebar.
- **Source-control authority:** the herdr worktree overrides the active terminal's own cwd
  for source-control (App.tsx touch-point #2). To instead let the terminal's `cd` win for
  source-control, drop that one override and edit only the `explorerRoot` site.

## Deferred (not yet implemented)

- Open file in a right split panel: new add-only `WorkspaceSplit.tsx` wrapper around the
  existing `WorkspaceSurface`; aim for zero edits to `WorkspaceSurface.tsx` / `useTabs.ts`.
