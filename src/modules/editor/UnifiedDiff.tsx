import { resolveFontFamily } from "@/lib/fonts";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { getChunks, unifiedMergeView } from "@codemirror/merge";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { useEffect, useMemo, useRef } from "react";

import {
  brightenDiffSyntax,
  diffConfig,
  DIFF_GREEN_LINE,
  DIFF_GREEN_MARK,
  DIFF_GREEN_TEXT,
  DIFF_RED_LINE,
  DIFF_RED_MARK,
  DIFF_RED_TEXT,
} from "./lib/diffThemes";
import { buildSharedExtensions, languageCompartment } from "./lib/extensions";
import { resolveLanguage, resolveLanguageSync } from "./lib/languageResolver";

const SHARED_EXT: Extension[] = buildSharedExtensions();
const READONLY_EXT: Extension[] = [
  EditorState.readOnly.of(true),
  EditorView.editable.of(false),
];

// Single-pane (unified) diff: the original text is shown inline as deleted
// widgets above the modified text. Mirrors SideBySideDiff's props so the diff
// panes can switch between the two on the `diffSideBySide` pref. Unlike the
// two-editor MergeView, the unified view has no cm-merge-a/b sides, so changes
// are themed by their own classes here (red removed, green added).
// Saturated diff hues blended with the app background, matching SideBySideDiff
// (see diffThemes.ts): the theme's ANSI vars resolve to catppuccin pastels at
// runtime, so we use explicit saturated green/red to read deep like the terminal.
const UNIFIED_DIFF_THEME = EditorView.theme({
  ".cm-changedText": {
    background: `${DIFF_GREEN_TEXT} !important`,
    borderRadius: "3px",
    padding: "0 1px",
  },
  ".cm-changedLine": {
    backgroundColor: `${DIFF_GREEN_LINE} !important`,
  },
  ".cm-changedLineGutter": {
    background: `${DIFF_GREEN_MARK} !important`,
  },
  ".cm-deletedChunk": {
    backgroundColor: `${DIFF_RED_LINE} !important`,
  },
  ".cm-deletedChunk .cm-deletedText, .cm-deletedText": {
    background: `${DIFF_RED_TEXT} !important`,
    borderRadius: "3px",
    padding: "0 1px",
  },
  ".cm-deletedLineGutter": {
    background: `${DIFF_RED_MARK} !important`,
  },
  ".cm-changeGutter": {
    width: "2px !important",
    paddingLeft: "0 !important",
  },
  // Match SideBySideDiff: heavier strokes to close the canvas-vs-DOM gap.
  ".cm-content": { fontWeight: "600" },
  ".cm-collapsedLines": {
    backgroundColor: "transparent",
    color: "var(--muted-foreground, #9ca3af)",
    fontSize: "10.5px",
    padding: "2px 8px",
    opacity: 0.7,
  },
});

type Props = {
  originalContent: string;
  modifiedContent: string;
  path: string;
  themeExt: Extension;
  collapseUnchanged: boolean;
};

export function UnifiedDiff({
  originalContent,
  modifiedContent,
  path,
  themeExt,
  collapseUnchanged,
}: Props) {
  const cmRef = useRef<ReactCodeMirrorRef>(null);
  const scrolledPathRef = useRef<string | null>(null);
  const initialLang = useMemo(() => resolveLanguageSync(path), [path]);
  // Sync the diff font with the terminal (see SideBySideDiff).
  const fontFamily = resolveFontFamily(
    usePreferencesStore((s) => s.terminalFontFamily),
  );
  const terminalFontSize = usePreferencesStore((s) => s.terminalFontSize);

  const extensions = useMemo(
    () => [
      ...SHARED_EXT,
      languageCompartment.of(initialLang?.ext ?? []),
      ...READONLY_EXT,
      unifiedMergeView({
        original: originalContent,
        mergeControls: false,
        highlightChanges: true,
        gutter: true,
        syntaxHighlightDeletions: true,
        collapseUnchanged: collapseUnchanged
          ? { margin: 3, minSize: 6 }
          : undefined,
        diffConfig,
      }),
      UNIFIED_DIFF_THEME,
      EditorView.theme({
        ".cm-scroller": {
          fontFamily,
          fontSize: `calc(${terminalFontSize}px * var(--app-zoom, 1))`,
        },
      }),
      brightenDiffSyntax,
    ],
    [
      originalContent,
      initialLang,
      collapseUnchanged,
      fontFamily,
      terminalFontSize,
    ],
  );

  // Resolve syntax highlighting asynchronously when the language pack isn't
  // cached yet — reconfigure the live view once it exists.
  useEffect(() => {
    if (initialLang) return;
    let cancelled = false;
    resolveLanguage(path).then((res) => {
      if (cancelled) return;
      const view = cmRef.current?.view;
      if (!view) return;
      view.dispatch({
        effects: languageCompartment.reconfigure(res?.ext ?? []),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [path, initialLang]);

  // On opening a new file, scroll to the first change. unifiedMergeView computes
  // chunks asynchronously, so retry a few frames until they exist. Gated by path
  // so refreshes/toggles of the same file keep the user's scroll position.
  useEffect(() => {
    if (scrolledPathRef.current === path) return;
    let tries = 0;
    let raf = 0;
    const tryScroll = () => {
      const view = cmRef.current?.view;
      const first = view ? getChunks(view.state)?.chunks?.[0] : undefined;
      if (!view || !first) {
        if (tries++ < 12) raf = requestAnimationFrame(tryScroll);
        return;
      }
      scrolledPathRef.current = path;
      const pos = Math.min(first.fromB, view.state.doc.length);
      const top = view.lineBlockAt(pos).top;
      view.scrollDOM.scrollTop = Math.max(0, top - view.defaultLineHeight * 2);
    };
    raf = requestAnimationFrame(tryScroll);
    return () => cancelAnimationFrame(raf);
  }, [path, originalContent, modifiedContent]);

  return (
    // zoom-exempt: render at net zoom 1.0 so CodeMirror's mouse-coordinate
    // mapping stays correct (the app zooms via CSS `zoom`). The shared
    // extensions re-apply zoom via `.cm-scroller` font-size.
    <div className="zoom-exempt h-full min-h-0">
      <CodeMirror
        ref={cmRef}
        value={modifiedContent}
        theme={themeExt}
        extensions={extensions}
        editable={false}
        height="100%"
        className="h-full"
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          searchKeymap: true,
        }}
      />
    </div>
  );
}
