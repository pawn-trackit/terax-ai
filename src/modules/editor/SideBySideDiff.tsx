import { MergeView } from "@codemirror/merge";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef } from "react";

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
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mergeRef = useRef<MergeView | null>(null);

  useEffect(() => {
    const parent = containerRef.current;
    if (!parent) return;

    const initialLang = resolveLanguageSync(path);
    const sideExtensions = (): Extension[] => [
      ...SHARED_EXT,
      languageCompartment.of(initialLang ?? []),
      ...READONLY_EXT,
      themeExt,
      diffTheme,
    ];

    const merge = new MergeView({
      a: { doc: originalContent, extensions: sideExtensions() },
      b: { doc: modifiedContent, extensions: sideExtensions() },
      parent,
      collapseUnchanged: { margin: 3, minSize: 6 },
      gutter: true,
      highlightChanges: true,
    });
    mergeRef.current = merge;

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
      merge.destroy();
      mergeRef.current = null;
    };
  }, [originalContent, modifiedContent, path, themeExt, diffTheme]);

  return (
    <div
      ref={containerRef}
      className="h-full min-h-0 [&_.cm-mergeView]:h-full [&_.cm-mergeView]:max-h-full [&_.cm-mergeView]:overflow-auto"
    />
  );
}
