import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XtermTerminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { TERMINAL_MINIMUM_CONTRAST, currentTerminalTheme } from "../terminal/terminalTheme";

/**
 * The install, as a terminal you can answer.
 *
 * The first version streamed the output into a `<pre>` and accepted no
 * input, which held together until Homebrew asked "Do you want to proceed
 * with the installation? [y/n]" — and then the question sat on screen with
 * nowhere to type the answer, and the install waited for one forever.
 *
 * It also rendered the escape codes as literal text: `[34m` and `[0m`
 * through the middle of every line, because a `<pre>` shows what a terminal
 * interprets. Both problems have the same answer, which is to use a
 * terminal.
 */
export function InstallTerminal({
  providerId,
  onData,
}: {
  providerId: string;
  /** Subscribes to output; returns its own unsubscribe. */
  onData: (handler: (chunk: string) => void) => (() => void) | undefined;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XtermTerminal | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new XtermTerminal({
      convertEol: true,
      cursorBlink: true,
      fontSize: 11,
      // A literal stack. xterm reads this into a canvas measurement, where a
      // CSS variable does not resolve — it fell back to a default whose
      // metrics did not match the glyphs, which is why the letters came out
      // spaced like a ransom note.
      fontFamily: 'ui-monospace, Menlo, "Cascadia Mono", Consolas, monospace',
      // The app's own colours; the contrast floor keeps an installer's dark-ground
      // colours (Homebrew's blue ==>) legible on a light one.
      minimumContrastRatio: TERMINAL_MINIMUM_CONTRAST,
      theme: currentTerminalTheme(),
      scrollback: 2000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    termRef.current = term;

    // Every keystroke goes to the process, which is the whole point: this is
    // where you type `y`.
    const typed = term.onData((data) => {
      void window.braveli?.sendAgentInstallInput?.({ providerId, data });
    });

    const stop = onData((chunk) => term.write(chunk));

    const resize = () => {
      fit.fit();
      void window.braveli?.resizeAgentInstall?.({ providerId, cols: term.cols, rows: term.rows });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    return () => {
      observer.disconnect();
      typed.dispose();
      stop?.();
      term.dispose();
      termRef.current = null;
    };
  }, [providerId, onData]);

  return <div className="dk-install-terminal" ref={hostRef} />;
}
