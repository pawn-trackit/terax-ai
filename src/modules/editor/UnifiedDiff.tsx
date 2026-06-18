import { getChunks, unifiedMergeView } from "@codemirror/merge";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { useEffect, useMemo, useRef } from "react";

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
const UNIFIED_DIFF_THEME = EditorView.theme({
  ".cm-changedText": {
    background: "rgba(110, 200, 120, 0.20) !important",
    borderRadius: "3px",
    padding: "0 1px",
  },
  ".cm-changedLine": {
    backgroundColor: "rgba(110, 200, 120, 0.06) !important",
  },
  ".cm-changedLineGutter": {
    background: "rgba(110, 200, 120, 0.55) !important",
  },
  ".cm-deletedChunk": {
    backgroundColor: "rgba(220, 90, 90, 0.07) !important",
  },
  ".cm-deletedChunk .cm-deletedText, .cm-deletedText": {
    background: "rgba(220, 90, 90, 0.22) !important",
    borderRadius: "3px",
    padding: "0 1px",
  },
  ".cm-deletedLineGutter": {
    background: "rgba(220, 90, 90, 0.5) !important",
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

  const extensions = useMemo(
    () => [
      ...SHARED_EXT,
      languageCompartment.of(initialLang ?? []),
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
      }),
      UNIFIED_DIFF_THEME,
    ],
    [originalContent, initialLang, collapseUnchanged],
  );

  // Resolve syntax highlighting asynchronously when the language pack isn't
  // cached yet — reconfigure the live view once it exists.
  useEffect(() => {
    if (initialLang) return;
    let cancelled = false;
    resolveLanguage(path).then((ext) => {
      if (cancelled) return;
      const view = cmRef.current?.view;
      if (!view) return;
      view.dispatch({ effects: languageCompartment.reconfigure(ext ?? []) });
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
