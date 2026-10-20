/**
 * Dialogs close when their backdrop is clicked. A press that starts inside the
 * dialog — selecting text in a field — and is released over the backdrop also
 * fires a click there, and used to throw the form away. Only a press that began
 * on the backdrop itself counts as a click outside.
 */
const BACKDROPS = ".dk-backdrop, .dk-sheet-scrim";

export function isStrayBackdropClick(pressedOn: EventTarget | null, clicked: EventTarget | null) {
  return clicked instanceof Element && clicked.matches(BACKDROPS) && pressedOn !== clicked;
}

export function guardBackdropClicks(target: Window = window) {
  let pressedOn: EventTarget | null = null;
  target.addEventListener("pointerdown", (event) => { pressedOn = event.target; }, true);
  target.addEventListener("click", (event) => {
    if (isStrayBackdropClick(pressedOn, event.target)) event.stopPropagation();
  }, true);
}
