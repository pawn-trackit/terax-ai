import { MergeView } from "@codemirror/merge";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";

import { DiffOverviewRuler } from "./DiffOverviewRuler";
import { buildSharedExtensions, languageCompartment } from "./lib/extensions";
import { resolveLanguage, resolveLanguageSync } from "./lib/languageResolver";

const SHARED_EXT: Extension[] = buildSharedExtensions();
const READONLY_EXT: Extension[] = [
  EditorState.readOnly.of(true),
  EditorView.editable.of(false),
];

type Props = {
  // before (left column) vs after (right column)
  originalContent: string;
  modifiedContent: string;
  // file path → syntax highlighting
  path: string;
  // editor color theme + the pane's own diff-change theme
  themeExt: Extension;
  diffTheme: Extension;
  // when true, collapse long stretches of unchanged lines outside the diff
  collapseUnchanged: boolean;
};

// Side-by-side (two-column) read-only diff. Unlike unifiedMergeView (an
// extension that slots into a single <CodeMirror>), MergeView is a class that
// builds and owns two EditorViews, so it mounts into a ref'd div and is torn
// down on unmount. Language is reconfigured on both sides once resolved.
export function SideBySideDiff({
  originalContent,
  modifiedContent,
  path,
  themeExt,
  diffTheme,
  collapseUnchanged,
}: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const mergeRef = useRef<MergeView | null>(null);
  // The overview ruler reads the live MergeView; geomVersion forces it to
  // recompute mark positions when the diff's content or layout changes.
  const [mergeView, setMergeView] = useState<MergeView | null>(null);
  const [geomVersion, setGeomVersion] = useState(0);
  // Tracks the last path we auto-scrolled to its first change, so re-renders of
  // the same file (theme/collapse toggle, diff refresh) don't reset scroll.
  const lastScrolledPathRef = useRef<string | null>(null);

  useEffect(() => {
    const parent = mountRef.current;
    if (!parent) return;

    // Recompute the ruler on height/geometry/doc changes — deferred to a frame
    // so we never call setState from inside a CodeMirror update dispatch.
    let rafPending = false;
    let bumpRaf = 0;
    const scheduleBump = () => {
      if (rafPending) return;
      rafPending = true;
      bumpRaf = requestAnimationFrame(() => {
        rafPending = false;
        setGeomVersion((v) => v + 1);
      });
    };
    const geomListener = EditorView.updateListener.of((u) => {
      if (u.heightChanged || u.docChanged || u.geometryChanged) scheduleBump();
    });

    const initialLang = resolveLanguageSync(path);
    const sideExtensions = (forB: boolean): Extension[] => [
      ...SHARED_EXT,
      languageCompartment.of(initialLang ?? []),
      ...READONLY_EXT,
      themeExt,
      diffTheme,
      ...(forB ? [geomListener] : []),
    ];

    const merge = new MergeView({
      a: { doc: originalContent, extensions: sideExtensions(false) },
      b: { doc: modifiedContent, extensions: sideExtensions(true) },
      parent,
      collapseUnchanged: collapseUnchanged
        ? { margin: 3, minSize: 6 }
        : undefined,
      gutter: true,
      highlightChanges: true,
    });
    mergeRef.current = merge;
    setMergeView(merge);
    scheduleBump();

    // On opening a new file, land on the first change instead of line 1 — but
    // only once per path, so refreshes/toggles don't yank the user back up.
    if (lastScrolledPathRef.current !== path) {
      lastScrolledPathRef.current = path;
      requestAnimationFrame(() => {
        if (mergeRef.current !== merge) return;
        const first = merge.chunks[0];
        if (!first) return;
        const useB = first.toB > first.fromB;
        const view = useB ? merge.b : merge.a;
        const pos = Math.min(
          useB ? first.fromB : first.fromA,
          view.state.doc.length,
        );
        const top = view.lineBlockAt(pos).top;
        merge.dom.scrollTop = Math.max(0, top - view.defaultLineHeight * 2);
      });
    }

    // Apply async syntax highlighting once the language pack resolves —
    // reconfigure both sides (the shared compartment maps independently per view).
    let cancelled = false;
    if (!initialLang) {
      resolveLanguage(path).then((ext) => {
        if (cancelled) return;
        const m = mergeRef.current;
        if (!m) return;
        m.a.dispatch({ effects: languageCompartment.reconfigure(ext ?? []) });
        m.b.dispatch({ effects: languageCompartment.reconfigure(ext ?? []) });
      });
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(bumpRaf);
      merge.destroy();
      mergeRef.current = null;
      setMergeView(null);
    };
  }, [originalContent, modifiedContent, path, themeExt, diffTheme, collapseUnchanged]);

  return (
    // zoom-exempt: render the merge subtree at net zoom 1.0 (the app zooms via
    // CSS `zoom`, which breaks CodeMirror's mouse-coordinate mapping). The
    // shared extensions re-apply the zoom via `.cm-scroller` font-size, matching
    // EditorPane/TerminalPane. Without this, drag-selection starts at an offset.
    <div className="zoom-exempt relative h-full min-h-0">
      <div
        ref={mountRef}
        className="h-full min-h-0 [&_.cm-mergeView]:h-full [&_.cm-mergeView]:max-h-full [&_.cm-mergeView]:overflow-auto [&_.cm-mergeView]:pr-3"
      />
      {mergeView ? (
        <DiffOverviewRuler mergeView={mergeView} version={geomVersion} />
      ) : null}
    </div>
  );
}
