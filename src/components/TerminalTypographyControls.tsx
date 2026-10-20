import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_TERMINAL_FONT_FAMILY,
  DEFAULT_TERMINAL_FONT_SIZE,
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  terminalFontFamilies,
} from "../lib/terminalOptions";
import { Dropdown } from "./Dropdown";

export function TerminalTypographyControls({
  fontFamily,
  fontSize,
  onFontFamilyChange,
  onFontSizeChange,
}: {
  fontFamily: string;
  fontSize: number;
  onFontFamilyChange: (fontFamily: string) => void;
  onFontSizeChange: (fontSize: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className="dk-type-controls" ref={rootRef}>
      <button
        className="dk-btn dk-btn--ghost dk-btn--sm"
        type="button"
        aria-label="Terminal typography settings"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true">Aa</span>
        <output>{fontSize}px</output>
      </button>
      {open ? (
        <div className="dk-popover dk-type-popover" role="dialog" aria-label="Terminal typography">
          <div className="dk-type-heading">
            <strong>Terminal type</strong>
            <button
              type="button"
              className="dk-link"
              onClick={() => {
                onFontFamilyChange(DEFAULT_TERMINAL_FONT_FAMILY);
                onFontSizeChange(DEFAULT_TERMINAL_FONT_SIZE);
              }}
            >
              Reset
            </button>
          </div>
          <div className="dk-field">
            <span className="dk-label">Font family</span>
            <Dropdown
              className="dk-type-font"
              value={fontFamily}
              options={terminalFontFamilies}
              onChange={onFontFamilyChange}
              ariaLabel="Terminal font family"
            />
          </div>
          <label className="dk-field">
            <span className="dk-label dk-type-size">
              Font size
              <output>{fontSize}px</output>
            </span>
            <input
              type="range"
              className="dk-type-range"
              min={MIN_TERMINAL_FONT_SIZE}
              max={MAX_TERMINAL_FONT_SIZE}
              step={1}
              value={fontSize}
              aria-label="Terminal font size"
              onChange={(event) => onFontSizeChange(Number(event.target.value))}
            />
            <span className="dk-hint dk-type-range-ends">
              <span>{MIN_TERMINAL_FONT_SIZE}px</span>
              <span>{MAX_TERMINAL_FONT_SIZE}px</span>
            </span>
          </label>
        </div>
      ) : null}
    </div>
  );
}
