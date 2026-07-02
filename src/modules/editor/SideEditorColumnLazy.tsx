import { lazy, Suspense } from "react";
import type { ComponentProps } from "react";
import type { SideEditorColumn as SideEditorColumnType } from "./SideEditorColumn";

// Keep EditorPane (and the CodeMirror bundle) out of the initial chunk, mirroring
// EditorStackLazy — a side column only mounts once a file is opened from a click.
const SideEditorColumnInner = lazy(() =>
  import("./SideEditorColumn").then((m) => ({ default: m.SideEditorColumn })),
);

type Props = ComponentProps<typeof SideEditorColumnType>;

export function SideEditorColumn(props: Props) {
  return (
    <Suspense fallback={null}>
      <SideEditorColumnInner {...props} />
    </Suspense>
  );
}
