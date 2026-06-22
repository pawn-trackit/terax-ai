import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

// Largest file we render with the interactive diff (MergeView / unifiedMergeView).
// GitDiffPane switches anything bigger to a plain patch view, so this is also the
// upper bound on the content CodeMirror's diff ever sees here. Keep GitDiffPane's
// threshold tied to this constant — the fix below depends on the two matching.
export const DIFF_INTERACTIVE_MAX_BYTES = 256 * 1024;

// CodeMirror's diff abandons precise matching and collapses the WHOLE file into a
// single change once a side exceeds (internal scanLimit)*64 characters — every
// line then renders as changed (solid green/red). Its default scanLimit (500,
// halved to 250 internally) trips this at ~16 KiB, deep inside the range we show
// interactively, leaving a dead zone between ~16 KiB and the 256 KiB patch-view
// fallback. We size scanLimit to that same 256 KiB ceiling so the precise-diff
// window always spans the entire range the interactive view can receive; the
// collapse can no longer occur here regardless of file size. A raised scanLimit
// alone would just relocate the cliff — anchoring it to DIFF_INTERACTIVE_MAX_BYTES
// is what stops the bug recurring for larger files.
//
// The precise window is (scanLimit >> 1) * 16 = scanLimit * 8 characters, so
// scanLimit = DIFF_INTERACTIVE_MAX_BYTES / 8 makes it exactly the ceiling.
// `timeout` is a graceful backstop: a pathological large-edit-distance diff
// degrades to a segmented (per-region) crude diff instead of hanging, and never
// to the all-lines-changed collapse (that needs a side > scanLimit*64 ≈ 2 MiB,
// unreachable below the 256 KiB fallback).
export const diffConfig = {
  scanLimit: DIFF_INTERACTIVE_MAX_BYTES / 8,
  timeout: 5000,
};

// Make the diff read exactly like the terminal. Two real differences caused the
// long-standing "diff is fainter than the terminal" gap:
//   1. PALETTE. The terminal's ANSI colors (globals.css --terminal-ansi-*) are
//      saturated tailwind tones (#60a5fa, #4ade80, #c084fc …). The diff editor's
//      catppuccin-mocha theme is low-chroma pastels (#89b4fa, #a6e3a1, #cba6f7).
//      Same hue family, far less saturation — so the diff always looked washed
//      out next to the terminal no matter how its backgrounds were tuned.
//   2. CONTRAST FLOOR. The terminal runs xterm with minimumContrastRatio 4.5
//      (rendererPool.ts), which dynamically lifts every glyph to stay legible
//      over the translucent background image. CodeMirror has no equivalent.
// This higher-precedence highlight style maps each token to the terminal's own
// ANSI palette (via the same CSS vars) so the diff is literally the terminal's
// colors; comments use a bright neutral gray (no ANSI comment slot exists) so
// they stay legible on the green/red change backgrounds.
export const brightenDiffSyntax = Prec.highest(
  syntaxHighlighting(
    HighlightStyle.define([
      {
        tag: [t.comment, t.lineComment, t.blockComment, t.docComment],
        color: "#c0c8de",
        fontStyle: "italic",
      },
      {
        tag: [
          t.keyword,
          t.modifier,
          t.controlKeyword,
          t.operatorKeyword,
          t.moduleKeyword,
          t.self,
        ],
        color: "var(--terminal-ansi-bright-magenta)",
      },
      {
        tag: [t.string, t.special(t.string), t.regexp, t.character],
        color: "var(--terminal-ansi-bright-green)",
      },
      {
        tag: [t.number, t.bool, t.null, t.atom, t.constant(t.name)],
        color: "var(--terminal-ansi-bright-yellow)",
      },
      {
        tag: [
          t.function(t.variableName),
          t.function(t.propertyName),
          t.labelName,
          t.macroName,
        ],
        color: "var(--terminal-ansi-bright-blue)",
      },
      {
        // Default identifiers: bright near-white to match the terminal's text
        // (measured rgb 227,235,235), not catppuccin's dim lavender foreground
        // (which rendered ~rgb 183,193,223 under the background-image overlay).
        tag: [
          t.definition(t.variableName),
          t.variableName,
          t.local(t.variableName),
        ],
        color: "#eef2f2",
      },
      {
        tag: [t.propertyName, t.special(t.propertyName)],
        color: "var(--terminal-ansi-bright-blue)",
      },
      {
        tag: [t.typeName, t.className, t.namespace, t.changed, t.annotation],
        color: "var(--terminal-ansi-bright-cyan)",
      },
      {
        tag: [
          t.operator,
          t.punctuation,
          t.separator,
          t.bracket,
          t.derefOperator,
        ],
        color: "#cdd6e4",
      },
      {
        tag: [t.tagName, t.angleBracket],
        color: "var(--terminal-ansi-bright-red)",
      },
      {
        tag: [t.attributeName],
        color: "var(--terminal-ansi-bright-yellow)",
      },
      {
        tag: [t.attributeValue],
        color: "var(--terminal-ansi-bright-green)",
      },
      {
        tag: [t.heading],
        color: "var(--terminal-ansi-bright-magenta)",
        fontWeight: "bold",
      },
      {
        tag: [t.link, t.url],
        color: "var(--terminal-ansi-bright-blue)",
        textDecoration: "underline",
      },
      { tag: [t.invalid], color: "var(--terminal-ansi-bright-red)" },
    ]),
  ),
);

// Side-qualified diff colors shared by the git + AI side-by-side diff panes.
// MergeView tags the editors `cm-merge-a` (before) and `cm-merge-b` (after); the
// merge package's own theme colors a=red/b=green, so every rule is side-qualified:
// before = red, after = green.
//
// Colors measured from the terminal's own diff (2026-06-22 pixel sample of the
// running terminal): added-line bg ≈ rgb(7,47,17), removed-line bg ≈ rgb(54,19,19)
// — dark, deep tints, NOT bright mid-greens. (Earlier attempts mismatched because
// the theme's --terminal-ansi-* vars resolve to catppuccin PASTELS at runtime,
// and we'd assumed the saturated globals.css defaults.) Match those dark tints for
// the full-line background; keep a brighter shade for inline changed words and the
// +/- gutter marker so word-level changes still read in the side-by-side view.
// Inline (changed-word) tone is kept nearly equal to the line tone so the whole
// change reads uniformly dark like the terminal (its diff has no brighter inline
// highlight); only the +/- gutter marker stays bright. Line tones run a touch
// below the terminal's measured values to absorb the background-image overlay,
// which lifts every diff pixel by roughly +(12,11,24) toward the (bluish) image.
export const DIFF_GREEN_LINE = "#002e08";
export const DIFF_GREEN_TEXT = "#033609";
export const DIFF_GREEN_MARK = "#2ea043";
export const DIFF_RED_LINE = "#2e0c08";
export const DIFF_RED_TEXT = "#38100c";
export const DIFF_RED_MARK = "#e5484d";
export const sideBySideDiffTheme = EditorView.theme({
  // before / left side (cm-merge-a): removed & changed code in red
  "&.cm-merge-a .cm-changedText, .cm-deletedChunk .cm-deletedText, &.cm-merge-b .cm-deletedText":
    {
      background: `${DIFF_RED_TEXT} !important`,
      borderRadius: "3px",
      padding: "0 1px",
    },
  "&.cm-merge-a .cm-changedLine, .cm-deletedChunk": {
    backgroundColor: `${DIFF_RED_LINE} !important`,
  },
  "&.cm-merge-a .cm-changedLineGutter, .cm-deletedLineGutter": {
    background: `${DIFF_RED_MARK} !important`,
  },
  // after / right side (cm-merge-b): added & changed code in green
  "&.cm-merge-b .cm-changedText": {
    background: `${DIFF_GREEN_TEXT} !important`,
    borderRadius: "3px",
    padding: "0 1px",
  },
  "&.cm-merge-b .cm-changedLine, .cm-inlineChangedLine": {
    backgroundColor: `${DIFF_GREEN_LINE} !important`,
  },
  "&.cm-merge-b .cm-changedLineGutter": {
    background: `${DIFF_GREEN_MARK} !important`,
  },
  ".cm-changeGutter": {
    width: "2px !important",
    paddingLeft: "0 !important",
  },
  // Heavier text to close the canvas-vs-DOM gap. VERIFIED (2026-06-22 pixel
  // sample): terminal glyphs are GPU-rendered solid (solid-pixel ratio ~0.51),
  // DOM antialiasing left the diff at ~0.26 — visibly thinner. Weight 600 fills
  // the strokes back in on this 1x display.
  ".cm-content": { fontWeight: "600" },
  ".cm-collapsedLines": {
    backgroundColor: "transparent",
    color: "var(--muted-foreground, #9ca3af)",
    fontSize: "10.5px",
    padding: "2px 8px",
    opacity: 0.7,
  },
});
