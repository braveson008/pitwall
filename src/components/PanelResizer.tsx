import { useRef, useState } from "react";

const MIN = 300;
const DEFAULT = 440;

/**
 * The left edge of a right-hand panel, dragged to resize it.
 *
 * Only a guide line moves while dragging. Resizing the panel live would refit
 * every terminal beside it on each move, and a CLI redraws its whole screen on
 * every refit — the drag would flicker. One resize, on release.
 */
export function PanelResizer({ width, onResize }: { width: number; onResize: (width: number) => void }) {
  const [guide, setGuide] = useState<number | null>(null);
  const frame = useRef(0);

  const clamp = (value: number) => Math.round(Math.min(Math.max(MIN, value), Math.max(MIN, window.innerWidth * 0.6)));

  return (
    <>
      <div
        className="dk-panel-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize files panel"
        aria-valuenow={width}
        tabIndex={0}
        title="Drag to resize · double-click to reset"
        onDoubleClick={() => onResize(DEFAULT)}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") onResize(clamp(width + 40));
          else if (event.key === "ArrowRight") onResize(clamp(width - 40));
          else return;
          event.preventDefault();
        }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          setGuide(window.innerWidth - width);
        }}
        onPointerMove={(event) => {
          if (guide === null) return;
          const x = window.innerWidth - clamp(window.innerWidth - event.clientX);
          cancelAnimationFrame(frame.current);
          frame.current = requestAnimationFrame(() => setGuide(x));
        }}
        onPointerUp={(event) => {
          if (guide === null) return;
          cancelAnimationFrame(frame.current);
          setGuide(null);
          onResize(clamp(window.innerWidth - event.clientX));
        }}
        onPointerCancel={() => setGuide(null)}
      />
      {guide !== null ? <div className="dk-panel-guide" style={{ transform: `translateX(${guide}px)` }} aria-hidden="true" /> : null}
    </>
  );
}
