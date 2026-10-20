import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

/**
 * A secondary view that slides over the work instead of replacing it: what
 * was open stays where it was, terminals included, and closing returns to it.
 * The header above stays live, so this is not modal.
 */
export function Sheet({ title, actions, onClose, children }: {
  title: string;
  actions?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    sheetRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // A dialog opened from inside the sheet closes first.
      if (document.querySelector("[aria-modal='true']")) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="dk-sheet-scrim" onClick={onClose}>
      <div
        ref={sheetRef}
        className="dk-sheet"
        role="dialog"
        aria-label={title}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="dk-sheet-head">
          <h2>{title}</h2>
          <span className="dk-header-spacer" />
          {actions}
          <button type="button" className="dk-icon-button" onClick={onClose} aria-label="Close" title="Close  Esc">
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div className="dk-sheet-body">{children}</div>
      </div>
    </div>
  );
}
