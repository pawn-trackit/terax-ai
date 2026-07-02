import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { EditorTab } from "@/modules/tabs";
import { useCallback } from "react";
import { EditorPane, type EditorPaneHandle } from "./EditorPane";

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

type Props = {
  tab: EditorTab;
  /** App's shared editor-handle registry — so gotoLine (via editorRefs) works. */
  registerHandle: (id: number, handle: EditorPaneHandle | null) => void;
  onDirtyChange: (id: number, dirty: boolean) => void;
  /** Close this side tab (routes through the same tab-close path as Cmd+W). */
  onClose: () => void;
};

// One right-side column for a terminal-opened file. The file is a REAL editor
// tab, so close (Cmd+W / X), dirty, gotoLine and zoom all come from the existing
// editor machinery — this component only adds the column chrome (a filename
// header + close) around a read-only EditorPane. No zoom-exempt wrapper here:
// EditorPane self-exempts internally, and doubling it shrinks the font.
export function SideEditorColumn({
  tab,
  registerHandle,
  onDirtyChange,
  onClose,
}: Props) {
  const setRef = useCallback(
    (h: EditorPaneHandle | null) => registerHandle(tab.id, h),
    [tab.id, registerHandle],
  );
  const setDirty = useCallback(
    (dirty: boolean) => onDirtyChange(tab.id, dirty),
    [tab.id, onDirtyChange],
  );

  return (
    <div
      data-side-editor-id={tab.id}
      className="flex h-full min-h-0 flex-col border-l border-border/60 bg-card"
    >
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border/60 px-2">
        <span
          className="truncate text-[11.5px] text-muted-foreground"
          title={tab.path}
        >
          {basename(tab.path)}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Close file panel"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={13} strokeWidth={2} />
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        <EditorPane
          ref={setRef}
          path={tab.path}
          readOnly
          onDirtyChange={setDirty}
          onClose={onClose}
        />
      </div>
    </div>
  );
}
