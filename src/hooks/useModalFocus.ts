import { useEffect, useRef } from "react";

const FOCUSABLE = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** Close, contain, and restore keyboard focus for a native React dialog. */
export function useModalFocus<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const dialogRef = useRef<T>(null);
  const wasOpen = useRef(false);
  const previousFocus = useRef<HTMLElement | null>(null);
  const restoreFrame = useRef<number>();
  if (open && !wasOpen.current) previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  wasOpen.current = open;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    if (restoreFrame.current !== undefined) window.cancelAnimationFrame(restoreFrame.current);
    const previous = previousFocus.current;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const isTopDialog = () => Array.from(document.querySelectorAll<HTMLElement>("[aria-modal='true']"))
      .filter((element) => element.getClientRects().length > 0).at(-1) === dialog;
    const first = dialog.querySelector<HTMLElement>("[data-dialog-autofocus]") ?? Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
      .find((element) => element.getClientRects().length > 0 && !element.matches(":disabled") && getComputedStyle(element).visibility !== "hidden");
    if (isTopDialog()) first?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || !isTopDialog()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((element) => element.getClientRects().length > 0 && !element.matches(":disabled") && getComputedStyle(element).visibility !== "hidden");
      if (!controls.length) {
        event.preventDefault();
        dialog.tabIndex = -1;
        dialog.focus();
        return;
      }
      const firstControl = controls[0];
      const lastControl = controls.at(-1)!;
      if (event.shiftKey && (document.activeElement === firstControl || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        lastControl.focus();
      } else if (!event.shiftKey && (document.activeElement === lastControl || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        firstControl.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      restoreFrame.current = window.requestAnimationFrame(() => {
        const topDialog = Array.from(document.querySelectorAll<HTMLElement>("[aria-modal='true']"))
          .filter((element) => element.getClientRects().length > 0).at(-1);
        if (previous?.isConnected && (!topDialog || topDialog.contains(previous))) previous.focus();
      });
    };
  }, [open]);

  return dialogRef;
}
