import type { MergeView } from "@codemirror/merge";
import { useEffect, useRef, useState } from "react";

// Right-edge overview scrollbar for the side-by-side diff. Reads the merge
// view's chunk list (which covers off-screen changes too — CodeMirror only
// renders visible lines, so we map by document position via the height map,
// not by querying DOM) and paints a colored tick per change. Doubles as the
// scrollbar: a draggable thumb reflects the visible range, and clicking the
// track jumps there. The native scrollbar is hidden (see ensureStyle()).

type Kind = "add" | "del" | "mod";
type Mark = { topPct: number; heightPct: number; kind: Kind };

const COLORS: Record<Kind, string> = {
  add: "rgba(110, 200, 120, 0.9)", // added lines (right side)
  del: "rgba(220, 90, 90, 0.9)", // removed lines (left side)
  mod: "rgba(210, 165, 75, 0.9)", // both removed and added
};

const STYLE_ID = "diff-overview-ruler-style";

// Hide the merge view's native scrollbar once — the ruler replaces it.
function ensureStyle(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) {
    return;
  }
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = ".cm-mergeView::-webkit-scrollbar{width:0;height:0}";
  document.head.appendChild(el);
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

function computeMarks(mv: MergeView): Mark[] {
  const total = Math.max(mv.dom.scrollHeight, 1);
  const aLen = mv.a.state.doc.length;
  const bLen = mv.b.state.doc.length;
  const marks: Mark[] = [];
  for (const ch of mv.chunks) {
    const adds = ch.toB > ch.fromB;
    const dels = ch.toA > ch.fromA;
    // Vertical position: chunk starts are aligned across both editors, so use
    // the side that actually has lines (the right/result side when present).
    const useB = adds;
    const view = useB ? mv.b : mv.a;
    const len = useB ? bLen : aLen;
    const from = clamp(useB ? ch.fromB : ch.fromA, 0, len);
    const to = clamp(useB ? ch.toB : ch.toA, 0, len);
    const top = view.lineBlockAt(from).top;
    const bottom = view.lineBlockAt(Math.max(from, to - 1)).bottom;
    const kind: Kind = adds && dels ? "mod" : adds ? "add" : "del";
    marks.push({
      topPct: clamp(top / total, 0, 1),
      heightPct: clamp((bottom - top) / total, 0, 1),
      kind,
    });
  }
  return marks;
}

type Props = {
  mergeView: MergeView;
  // bumped by SideBySideDiff whenever the diff geometry/content changes
  version: number;
};

export function DiffOverviewRuler({ mergeView, version }: Props) {
  const [marks, setMarks] = useState<Mark[]>([]);
  const [thumb, setThumb] = useState<{ top: number; height: number } | null>(
    null,
  );
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ensureStyle();
    const scroller = mergeView.dom;
    const update = () => {
      setMarks(computeMarks(mergeView));
      const sh = scroller.scrollHeight;
      const ch = scroller.clientHeight;
      setThumb(
        sh > ch ? { top: scroller.scrollTop / sh, height: ch / sh } : null,
      );
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [mergeView, version]);

  const scrollToClientY = (clientY: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const ratio = clamp((clientY - rect.top) / rect.height, 0, 1);
    const scroller = mergeView.dom;
    scroller.scrollTop =
      ratio * scroller.scrollHeight - scroller.clientHeight / 2;
  };

  return (
    <div
      ref={trackRef}
      className="absolute top-0 right-0 z-10 h-full w-3 cursor-pointer select-none"
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        scrollToClientY(e.clientY);
      }}
      onPointerMove={(e) => {
        if (e.buttons === 1) scrollToClientY(e.clientY);
      }}
    >
      {thumb ? (
        <div
          className="absolute right-0.5 left-0.5 rounded-sm bg-foreground/15"
          style={{
            top: `${thumb.top * 100}%`,
            height: `${thumb.height * 100}%`,
          }}
        />
      ) : null}
      {marks.map((m, i) => (
        <div
          key={i}
          className="pointer-events-none absolute right-0 left-0"
          style={{
            top: `${m.topPct * 100}%`,
            height: `max(2px, ${m.heightPct * 100}%)`,
            background: COLORS[m.kind],
          }}
        />
      ))}
    </div>
  );
}
