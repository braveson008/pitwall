import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export interface DropdownOption {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
  /**
   * Colours to show beside the option.
   *
   * For a list of twenty themes, the names are close to useless — "Nord" and
   * "Kanagawa" tell you nothing about what you are choosing between, and the
   * only way to find out is to pick each one and look. Three colours does what
   * the name cannot.
   */
  swatch?: string[];
}

/**
 * A custom select. Native <select> can't style its arrow or popup and clips
 * awkwardly, so this renders its own trigger + a fixed-positioned menu (survives
 * scrolling/overflow modals), with full keyboard support.
 */
/** Breathing room kept between the menu and the window edge. */
const EDGE = 8;

export function Dropdown({
  value,
  options,
  onChange,
  placeholder = "Select…",
  triggerLabel,
  className = "",
  ariaLabel,
}: {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  triggerLabel?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [coords, setCoords] = useState<{ left: number; top: number; width: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  /** When an outside press last closed the menu, so the click forwarded from a
      surrounding <label> cannot be mistaken for a request to open it again. */
  const closedAt = useRef(0);

  const selected = options.find((option) => option.value === value);

  const place = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setCoords({ left: rect.left, top: rect.bottom + 5, width: rect.width });
  };

  useLayoutEffect(() => {
    if (open) place();
  }, [open]);

  // Second pass, once the menu has been measured. Two ways a fixed-positioned
  // menu ends up somewhere unreachable rather than merely awkward:
  //
  // A trigger low in the window has no room beneath it, so the menu is flipped
  // above. And a menu wider than its trigger — which is now most of them, since
  // the width comes from the options rather than the button — runs off the right
  // edge when the trigger sits near it. The theme picker lives in the top-right
  // corner, so its menu overhung the window by ninety pixels the moment it was
  // allowed to be as wide as its own contents.
  useLayoutEffect(() => {
    if (!open || !coords || !menuRef.current) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const { offsetHeight: height, offsetWidth: width } = menuRef.current;
    const spaceBelow = window.innerHeight - rect.bottom;
    const flip = spaceBelow < height + 12 && rect.top > spaceBelow;
    const top = flip ? Math.max(8, rect.top - height - 5) : rect.bottom + 5;

    // Aligned to the trigger where there is room, pulled back inside the window
    // where there is not — which right-aligns it against the edge rather than
    // hiding half the options past it.
    const left = Math.max(EDGE, Math.min(rect.left, window.innerWidth - width - EDGE));

    if (Math.abs(top - coords.top) > 1 || Math.abs(left - coords.left) > 1) {
      setCoords({ ...coords, top, left });
    }
  }, [open, coords]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      // The menu check is belt and braces: it lives inside the root today, and
      // this keeps a selection from being swallowed if it ever moves out.
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      closedAt.current = event.timeStamp;
      setOpen(false);
    };
    // The menu is fixed-positioned, so it has to follow its trigger rather than
    // just closing: opening a dropdown low in a scrollable modal scrolls it into
    // view, and closing on that scroll made the menu flash open and vanish.
    const onScrollOrResize = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const offscreen = rect.bottom < 0 || rect.top > window.innerHeight;
      if (offscreen) setOpen(false);
      else place();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onScrollOrResize);
    // capture-phase so a scrolling ancestor (a modal body) is tracked too
    window.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open]);

  useEffect(() => {
    if (open) setActive(options.findIndex((option) => option.value === value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const commit = (option: DropdownOption) => {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const move = (dir: 1 | -1) => {
    setActive((current) => {
      let next = current;
      for (let i = 0; i < options.length; i += 1) {
        next = (next + dir + options.length) % options.length;
        if (!options[next].disabled) break;
      }
      return next;
    });
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      open ? move(1) : setOpen(true);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      open ? move(-1) : setOpen(true);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) setOpen(true);
      else if (options[active]) commit(options[active]);
    } else if (event.key === "Escape") {
      if (!open) return;
      // Closing the menu is all this Escape does; the dialog or sheet around it stays.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div className={`dk-dropdown ${className}`} ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className={`dk-dropdown-trigger${open ? " is-open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={(event) => {
          // A <label> wrapping this component forwards its own clicks onto the
          // trigger, because a button is a labelable control. Clicking the word
          // "Assign to" beside an open menu therefore closed it on the mousedown
          // and reopened it on the forwarded click, so it could not be dismissed
          // by clicking next to it. The markup no longer wraps it in a label,
          // and this keeps one added later from bringing the loop back.
          //
          // The forward arrives in the same tick as the press that closed the
          // menu, so a short window separates it from a click the user meant —
          // including one dispatched by assistive software, which is why this is
          // bounded by time rather than by whether a mousedown came first.
          if (closedAt.current && event.timeStamp - closedAt.current < 300) {
            closedAt.current = 0;
            return;
          }
          setOpen((current) => !current);
        }}
        onMouseDown={() => {
          // A real press on the trigger is the start of a click that belongs to
          // it, so nothing needs guarding against.
          closedAt.current = 0;
        }}
        onKeyDown={onKeyDown}
      >
        <span className={`dk-dropdown-value${selected || triggerLabel ? "" : " is-placeholder"}`}>
          {triggerLabel ?? (selected ? selected.label : placeholder)}
        </span>
        <ChevronDown size={15} className="dk-dropdown-caret" />
      </button>

      {/* Deliberately NOT portalled to the body. A menu rendered outside its
          trigger's subtree reads as an outside click to any popover containing
          the dropdown, which closes that popover on mousedown and swallows the
          selection before it commits. */}
      {open && coords && (
        <div
          className="dk-dropdown-menu"
          role="listbox"
          ref={menuRef}
          // The trigger sets a floor, not the width: a menu pinned to an 86px
          // button wrapped every hint onto three lines inside a 34px row, so the
          // text of one option was painted over the next. The options decide how
          // wide they need to be; CSS caps it.
          style={{ left: coords.left, top: coords.top, minWidth: coords.width }}
        >
          {options.map((option, index) => (
            <button
              type="button"
              key={option.value}
              role="option"
              // So a menu can style its own options by what they are — the
              // font picker sets each row in the face it names.
              data-value={option.value}
              aria-selected={option.value === value}
              disabled={option.disabled}
              className={`dk-dropdown-option${option.value === value ? " is-selected" : ""}${
                index === active ? " is-active" : ""
              }`}
              onMouseEnter={() => setActive(index)}
              onClick={() => commit(option)}
            >
              {option.swatch ? (
                <span className="dk-dropdown-swatch" aria-hidden="true">
                  {option.swatch.map((colour) => (
                    <i key={colour} style={{ background: colour }} />
                  ))}
                </span>
              ) : null}
              <span className="dk-dropdown-option-copy">
                <span>{option.label}</span>
                {option.hint && <small>{option.hint}</small>}
              </span>
              {option.value === value && <Check size={14} className="dk-dropdown-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
