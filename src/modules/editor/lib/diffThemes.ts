import { EditorView } from "@codemirror/view";

// Side-qualified diff colors shared by the git + AI side-by-side diff panes.
// Kept in one place so the two panes can't drift apart (they were byte-identical
// copies). MergeView tags the editors `cm-merge-a` (before) and `cm-merge-b`
// (after); the merge package's own theme already colors a=red/b=green, but a
// bare `.cm-changedText` rule would tint the before side green, so every rule
// here is side-qualified: before = red, after = green.
export const sideBySideDiffTheme = EditorView.theme({
  // before / left side (cm-merge-a): removed & changed code in red
  "&.cm-merge-a .cm-changedText, .cm-deletedChunk .cm-deletedText, &.cm-merge-b .cm-deletedText":
    {
      background: "rgba(220, 90, 90, 0.22) !important",
      borderRadius: "3px",
      padding: "0 1px",
    },
  "&.cm-merge-a .cm-changedLine, .cm-deletedChunk": {
    backgroundColor: "rgba(220, 90, 90, 0.07) !important",
  },
  "&.cm-merge-a .cm-changedLineGutter, .cm-deletedLineGutter": {
    background: "rgba(220, 90, 90, 0.5) !important",
  },
  // after / right side (cm-merge-b): added & changed code in green
  "&.cm-merge-b .cm-changedText": {
    background: "rgba(110, 200, 120, 0.20) !important",
    borderRadius: "3px",
    padding: "0 1px",
  },
  "&.cm-merge-b .cm-changedLine, .cm-inlineChangedLine": {
    backgroundColor: "rgba(110, 200, 120, 0.06) !important",
  },
  "&.cm-merge-b .cm-changedLineGutter": {
    background: "rgba(110, 200, 120, 0.55) !important",
  },
  ".cm-changeGutter": {
    width: "2px !important",
    paddingLeft: "0 !important",
  },
  ".cm-collapsedLines": {
    backgroundColor: "transparent",
    color: "var(--muted-foreground, #9ca3af)",
    fontSize: "10.5px",
    padding: "2px 8px",
    opacity: 0.7,
  },
});
