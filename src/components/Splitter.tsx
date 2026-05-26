interface Props {
  orientation?: "horizontal" | "vertical";
  /** Called with the pixel delta on each pointermove during a drag. */
  onDrag: (delta: number) => void;
}

/**
 * A thin draggable divider. Lives between two flex/grid siblings and
 * forwards each pointermove delta to the parent, which is responsible
 * for clamping and applying the new size to its layout state.
 */
export default function Splitter({ orientation = "horizontal", onDrag }: Props) {
  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const axis = orientation === "horizontal" ? "clientY" : "clientX";
    let last = e[axis];
    function move(ev: PointerEvent) {
      const v = ev[axis];
      const d = v - last;
      if (d !== 0) {
        last = v;
        onDrag(d);
      }
    }
    function up() {
      el.releasePointerCapture(e.pointerId);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      // Restore cursor on body — we set it to row/col-resize during drag.
      document.body.style.cursor = "";
    }
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    document.body.style.cursor =
      orientation === "horizontal" ? "row-resize" : "col-resize";
  }

  const cursor =
    orientation === "horizontal" ? "cursor-row-resize" : "cursor-col-resize";
  const sizeCls =
    orientation === "horizontal" ? "h-[5px] w-full" : "w-[5px] h-full";

  return (
    <div
      onPointerDown={handlePointerDown}
      className={`${sizeCls} ${cursor} bg-surface hover:bg-brand/40 active:bg-brand/60 transition shrink-0`}
    />
  );
}
