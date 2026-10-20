import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal as XtermTerminal } from "@xterm/xterm";
import { ImagePlus } from "lucide-react";
import { formatTerminalImagePaths, isImageFile } from "../lib/terminalImages";
import { needsResync, terminalWritePlan } from "../lib/terminalStream";
import {
  DEFAULT_TERMINAL_FONT_FAMILY,
  DEFAULT_TERMINAL_FONT_SIZE,
} from "../lib/terminalOptions";
import "@xterm/xterm/css/xterm.css";
import { TERMINAL_MINIMUM_CONTRAST, currentTerminalTheme } from "../terminal/terminalTheme";
import { isMacPlatform } from "../lib/shortcutLabel";

/**
 * A single embedded agent terminal. Owns one xterm instance keyed by
 * `sessionId`, streams `chunks` into it, and reports input/resize back up.
 * Deliberately stateless beyond its own refs so it can be mounted anywhere
 * (single terminal pane or the council grid) without reaching into app state.
 */
/** What another pane can ask of a mounted terminal. */
export type AgentTerminalHandle = {
  focus: () => void;
  /** The text currently on screen, one line per row. */
  readScreen: () => string;
};


/**
 * How many panes may hold a GPU context at once.
 *
 * Browsers cap live WebGL contexts — around sixteen — and quietly discard the
 * oldest when that is passed, which would blank a terminal somebody is reading.
 * A context is held only while a pane is on screen (and briefly after, so
 * flipping back is free), so many mounted panes share a few contexts rather
 * than each keeping one. Past the cap a pane draws the slow way rather than
 * taking a context from a pane that already has one.
 */
const MAX_WEBGL_CONTEXTS = 12;
let webglContexts = 0;
/** How long a hidden pane keeps its GPU context, so flipping back is instant. */
const WEBGL_RELEASE_MS = 30_000;

export const AgentTerminalView = forwardRef<AgentTerminalHandle, {
  sessionId: string;
  active: boolean;
  chunks: string[];
  fontFamily?: string;
  fontSize?: number;
  onInput: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  /**
   * Columns the session's PTY is currently running at.
   *
   * The pane cannot work this out alone: another pane showing the same session
   * may have resized it while this one was hidden.
   */
  ptySize?: { cols: number; rows: number };
  /** Chunks dropped off the front of this session's bounded transcript. */
  dropped?: number;
  /** The terminal modes the session's program switched on, for a replay that starts mid-stream. */
  replayPreamble?: (sessionId: string) => string;
}>(function AgentTerminalView({
  sessionId,
  active,
  chunks,
  fontFamily = DEFAULT_TERMINAL_FONT_FAMILY,
  fontSize = DEFAULT_TERMINAL_FONT_SIZE,
  onInput,
  onResize,
  ptySize,
  dropped = 0,
  replayPreamble,
}, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XtermTerminal | null>(null);
  // A theme picked while the session is open repaints its terminal too.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      if (terminalRef.current) terminalRef.current.options.theme = currentTerminalTheme();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-color-theme"] });
    return () => observer.disconnect();
  }, []);
  const fitRef = useRef<FitAddon | null>(null);
  const onInputRef = useRef(onInput);
  const onResizeRef = useRef(onResize);
  const writtenIndexRef = useRef(0);
  /** The grid has the PTY's size, or has been fitted: what was drawn can be written. */
  const [geometryReady, setGeometryReady] = useState(false);
  const lastWrittenRef = useRef<string | null>(null);
  const dragDepthRef = useRef(0);
  const attachmentStatusTimerRef = useRef<number | null>(null);
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [attachmentStatus, setAttachmentStatus] = useState<{
    message: string;
    tone: "working" | "success" | "error";
  } | null>(null);

  const insertImagePaths = (paths: string[]) => {
    const terminalText = formatTerminalImagePaths(paths);
    if (!terminalText) return;
    onInputRef.current(terminalText);
    terminalRef.current?.focus();
  };

  const showAttachmentStatus = (
    message: string,
    tone: "working" | "success" | "error",
    dismiss = tone !== "working",
  ) => {
    if (attachmentStatusTimerRef.current !== null) {
      window.clearTimeout(attachmentStatusTimerRef.current);
      attachmentStatusTimerRef.current = null;
    }
    setAttachmentStatus({ message, tone });
    if (dismiss) {
      attachmentStatusTimerRef.current = window.setTimeout(() => {
        setAttachmentStatus(null);
        attachmentStatusTimerRef.current = null;
      }, 3200);
    }
  };

  const useStagedImages = (results: TerminalAttachmentResult[]) => {
    const paths = results.flatMap((result) => result.paths || []);
    const errors = results.map((result) => result.error).filter(Boolean);
    if (paths.length > 0) {
      insertImagePaths(paths);
      showAttachmentStatus(
        errors.length > 0
          ? `${paths.length} image${paths.length === 1 ? "" : "s"} ready; some files were skipped`
          : `${paths.length} image${paths.length === 1 ? "" : "s"} ready`,
        errors.length > 0 ? "error" : "success",
      );
      return;
    }
    if (errors.length > 0) showAttachmentStatus(errors[0] || "The image could not be attached.", "error");
    else setAttachmentStatus(null);
  };

  const attachFiles = async (files: File[]) => {
    const images = files.filter(isImageFile);
    if (images.length === 0) return;

    const api = window.pitwall;
    if (!api?.stageTerminalImages || !api.stageTerminalImageData || !api.getPathForFile) {
      showAttachmentStatus("Image attachments are unavailable.", "error");
      return;
    }

    showAttachmentStatus("Preparing images...", "working", false);
    try {
      const filePaths: string[] = [];
      const clipboardFiles: File[] = [];
      for (const file of images) {
        const filePath = api.getPathForFile(file);
        if (filePath) filePaths.push(filePath);
        else clipboardFiles.push(file);
      }

      const requests: Array<Promise<TerminalAttachmentResult>> = [];
      if (filePaths.length > 0) {
        requests.push(api.stageTerminalImages({ sessionId, paths: filePaths }));
      }
      if (clipboardFiles.length > 0) {
        const clipboardImages = await Promise.all(clipboardFiles.map(async (file, index) => ({
          name: file.name || `clipboard-image-${index + 1}`,
          type: file.type,
          data: new Uint8Array(await file.arrayBuffer()),
        })));
        requests.push(api.stageTerminalImageData({ sessionId, images: clipboardImages }));
      }
      useStagedImages(await Promise.all(requests));
    } catch (error) {
      showAttachmentStatus(error instanceof Error ? error.message : "The image could not be attached.", "error");
    }
  };

  const chooseImages = async () => {
    const api = window.pitwall;
    if (!api?.chooseTerminalImages) return;
    showAttachmentStatus("Preparing images...", "working", false);
    try {
      useStagedImages([await api.chooseTerminalImages({ sessionId })]);
    } catch (error) {
      showAttachmentStatus(error instanceof Error ? error.message : "The image could not be attached.", "error");
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingImage(false);
    void attachFiles(Array.from(event.dataTransfer.files));
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const images = Array.from(event.clipboardData.files).filter(isImageFile);
    if (images.length === 0) return;
    event.preventDefault();
    void attachFiles(images);
  };

  useImperativeHandle(ref, () => ({
    focus: () => terminalRef.current?.focus(),
    /**
     * The rendered screen rather than the stream that produced it.
     *
     * A TUI repaints continuously, so the byte stream is a history of every
     * frame and reading it means guessing which parts are still true. The
     * buffer is the frame itself — what the user is actually looking at — which
     * is the only honest source for "is something waiting on screen right now".
     */
    readScreen: () => {
      const terminal = terminalRef.current;
      if (!terminal) return "";
      const buffer = terminal.buffer.active;
      const lines: string[] = [];
      for (let row = 0; row < terminal.rows; row += 1) {
        // baseY, not viewportY: the active screen area, wherever the reader
        // happens to have scrolled to. A menu is open on the live screen even
        // when someone is reading back through the scrollback.
        const line = buffer.getLine(buffer.baseY + row);
        lines.push(line ? line.translateToString(true) : "");
      }
      return lines.join("\n");
    },
  }), []);

  useEffect(() => {
    onInputRef.current = onInput;
  }, [onInput]);

  useEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);

  /**
   * Any pane that has a size may report it; a pane that has none cannot.
   *
   * There was a gate here that let only the pane with `active` speak, on the
   * theory that the Terminal tab's row and the Council grid's cell were
   * fighting over the one PTY they share. They are not: the tab you are not
   * looking at is `display: none`, so its terminals measure nothing, and
   * `fitTerminal` and the observer both give up on a pane with no size. The
   * exclusion already exists in the layout.
   *
   * What the gate did instead was silence the Terminal tab's other rows, which
   * are only `visibility: hidden` and so are laid out at full width. That is
   * where a session created while you were looking at a different one got its
   * size from — without it the CLI started at the 132-column fallback and drew
   * its tables for a width the pane never had.
   */

  useEffect(() => () => {
    if (attachmentStatusTimerRef.current !== null) {
      window.clearTimeout(attachmentStatusTimerRef.current);
    }
  }, []);

  /*
   * Draw on the GPU where we can.
   *
   * xterm's fallback renderer builds a DOM node per cell and re-renders every
   * row whenever the selection changes — and scrolling output changes the
   * selection constantly, so a pane producing text re-rendered its whole
   * screen continuously. With a four-member council that measured 2.4 frames
   * per second, 87% of the process inside character measurement.
   *
   * Held only while the pane is shown. The two failures it can have — a
   * context that cannot be created, and one lost afterwards — drop the pane
   * back to the renderer it used before, which is slow but correct.
   */
  const webglRef = useRef<WebglAddon | null>(null);
  const webglReleaseTimer = useRef<number | undefined>(undefined);
  const activeRef = useRef(active);
  activeRef.current = active;

  function releaseWebgl() {
    const addon = webglRef.current;
    if (!addon) return;
    webglRef.current = null;
    try { addon.dispose(); } catch { /* disposed with the terminal */ }
    webglContexts = Math.max(0, webglContexts - 1);
  }

  function acquireWebgl() {
    const terminal = terminalRef.current;
    // Not before the terminal is open: a renderer needs somewhere to draw.
    if (!terminal?.element || webglRef.current || webglContexts >= MAX_WEBGL_CONTEXTS) return;
    let addon: WebglAddon | null = null;
    try {
      addon = new WebglAddon();
      webglContexts += 1;
      const held = addon;
      // A lost context renders nothing at all, so the addon has to go for the
      // fallback to take over.
      held.onContextLoss(() => { if (webglRef.current === held) releaseWebgl(); });
      terminal.loadAddon(held);
      webglRef.current = held;
    } catch {
      // No GPU, a blocked context, or a driver that refused: the pane still
      // works, it just draws the slow way.
      if (addon) {
        try { addon.dispose(); } catch { /* never attached */ }
        webglContexts = Math.max(0, webglContexts - 1);
      }
    }
  }

  useEffect(() => {
    window.clearTimeout(webglReleaseTimer.current);
    if (active) acquireWebgl();
    else if (webglRef.current) webglReleaseTimer.current = window.setTimeout(releaseWebgl, WEBGL_RELEASE_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    if (!containerRef.current) return;
    let resizeFrame = 0;

    const terminal = new XtermTerminal({
      // No convertEol: the PTY line-ends its own output, and a CLI that emits a
      // bare line feed means "down one row", not "back to column one".
      cursorBlink: true,
      // ConPTY repaints wrapped lines itself; xterm must not reflow them too.
      ...(isMacPlatform() || window.pitwall?.platform !== "win32" ? {} : { windowsPty: { backend: "conpty" as const } }),
      fontFamily,
      fontSize,
      fontWeight: 400,
      fontWeightBold: 600,
      lineHeight: 1.25,
      scrollback: 5000,
      // CLIs choose colours for a dark ground; this keeps them legible on the app's own.
      minimumContrastRatio: TERMINAL_MINIMUM_CONTRAST,
      theme: currentTerminalTheme(),
    });
    const fit = new FitAddon();

    // URLs an agent or a dev server prints become clickable. This is where a
    // local server's address actually appears, so it is where opening it
    // belongs.
    //
    // The handler is explicit rather than the addon's default: terminal output
    // is untrusted text — an agent can print anything — and the default would
    // hand whatever it matched straight to the OS. Everything goes through the
    // same bridge the rest of the app uses, which refuses any scheme that is
    // not HTTP(S). Nothing opens on its own; this is a click.
    terminal.loadAddon(
      new WebLinksAddon((event, uri) => {
        event.preventDefault();
        void window.pitwall?.openExternalUrl?.(uri);
      }),
    );

    terminal.loadAddon(fit);

    // Opened only once the pane has a size. A terminal opened inside a hidden
    // pane — a session started from another tab — measures its letters as
    // nothing, and draws them that size for the rest of its life. Output that
    // arrives first is written to the buffer and drawn when it opens.
    let opened = false;
    const openWhenSized = () => {
      const container = containerRef.current;
      if (opened || !container || container.clientWidth === 0 || container.clientHeight === 0) return;
      opened = true;
      terminal.open(container);
      if (activeRef.current) {
        terminal.focus();
        acquireWebgl();
      }
    };

    /**
     * The size this pane was last fitted to.
     *
     * Fitting is not free and it is not idempotent from the observer's point of
     * view: `fit()` measures the character cell — which forces a synchronous
     * layout — and then resizes the terminal's own DOM, which trips the
     * ResizeObserver that called it.
     *
     * With one pane that settles after a round or two. A council mounts every
     * member at once, so each pane's resize reflows the grid and trips every
     * other pane's observer, which resizes and reflows again. Four members were
     * enough to keep it going indefinitely: measured at 2.4 frames per second
     * with 87% of the process inside xterm's character measurement.
     *
     * So a fit that would change nothing does not happen. The observer still
     * fires — that cannot be prevented — but it stops there, and the loop has
     * nothing to feed on.
     *
     * "Would change nothing" has to be asked of the terminal, not of this
     * view's own box. One session is rendered in two places — its council pane
     * and the terminal tab — and they share a terminal. The council pane is
     * the smaller of the two, so it would fit the shared grid down to its
     * size; the terminal tab's box had not changed, so it skipped its own fit
     * and showed a terminal still wearing the council's dimensions. Clicking
     * the session resized something and shook it loose, which is exactly the
     * shape of a cache that is remembering the wrong thing.
     */
    let lastSeen = { width: 0, height: 0 };

    const fitTerminal = () => {
      const container = containerRef.current;
      if (!container) return;
      const { clientWidth: width, clientHeight: height } = container;
      if (width === 0 || height === 0) return;
      const proposed = fit.proposeDimensions();
      if (!proposed || !proposed.cols || !proposed.rows) return;
      if (proposed.cols === terminal.cols && proposed.rows === terminal.rows) return;
      fit.fit();
      onResizeRef.current(terminal.cols, terminal.rows);
    };

    openWhenSized();
    resizeFrame = window.requestAnimationFrame(fitTerminal);

    const inputDisposable = terminal.onData((data) => onInputRef.current(data));
    // Where the view is in the scrollback, for anything that needs to check it.
    const scrollDisposable = terminal.onScroll((line) => {
      if (containerRef.current) containerRef.current.dataset.viewportLine = String(line);
    });
    // Before any backlog is written, the grid takes the size the PTY already
    // has. Written into xterm's 80x24 default, what a full-screen agent drew
    // wider wraps and clamps; the fit afterwards cannot undo that, because the
    // PTY is already the pane's size and the agent is never told to repaint.
    let fitted = false;
    let adopting = false;
    let disposed = false;
    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      if (adopting) return;
      fitted = true;
      onResizeRef.current(cols, rows);
    });
    setGeometryReady(false);
    void Promise.resolve(window.pitwall?.getTerminalSize?.(sessionId)).catch(() => null).then((size) => {
      if (disposed) return;
      if (!fitted && size?.ok && size.cols && size.rows && (size.cols !== terminal.cols || size.rows !== terminal.rows)) {
        adopting = true;
        terminal.resize(size.cols, size.rows);
        adopting = false;
      }
      setGeometryReady(true);
    });
    const resizeObserver = new ResizeObserver((entries) => {
      // Read the size the observer already measured rather than touching the
      // element, which would force another layout to answer.
      // The cheap guard stays here, where it costs nothing: an observer that
      // fires with the same box it last saw has nothing to say. Whether a fit
      // would change anything is decided in fitTerminal, against the terminal.
      openWhenSized();
      const box = entries[0]?.contentRect;
      if (box && Math.round(box.width) === lastSeen.width && Math.round(box.height) === lastSeen.height) return;
      if (box) lastSeen = { width: Math.round(box.width), height: Math.round(box.height) };
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(fitTerminal);
    });

    resizeObserver.observe(containerRef.current);
    terminalRef.current = terminal;
    fitRef.current = fit;
    writtenIndexRef.current = 0;
    lastWrittenRef.current = null;

    return () => {
      disposed = true;
      window.cancelAnimationFrame(resizeFrame);
      inputDisposable.dispose();
      scrollDisposable.dispose();
      resizeDisposable.dispose();
      resizeObserver.disconnect();
      window.clearTimeout(webglReleaseTimer.current);
      releaseWebgl();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
      writtenIndexRef.current = 0;
      lastWrittenRef.current = null;
    };
  }, [sessionId]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.fontFamily = fontFamily;
    terminal.options.fontSize = fontSize;
    // A font change alters the cell, so this one must fit even though the
    // container has not moved — it goes through the addon directly and lets the
    // observer's guard re-baseline on whatever size results.
    const frame = window.requestAnimationFrame(() => {
      if (!containerRef.current || !fitRef.current) return;
      if (containerRef.current.clientWidth === 0 || containerRef.current.clientHeight === 0) return;
      fitRef.current.fit();
      onResizeRef.current(terminal.cols, terminal.rows);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fontFamily, fontSize]);

  useEffect(() => {
    if (!active) return;
    /**
     * Becoming visible means fitting to the room this pane actually has.
     *
     * This used to be one animation frame, and gave up without a word if the
     * pane had no size yet. A pane that has just been unhidden often does not:
     * the class lands in the same render, and the browser has not necessarily
     * laid it out by the next frame. The fit was skipped, nothing scheduled
     * another, and the terminal kept whatever grid the last pane to fit it had
     * left behind — the council's cell, which is a quarter of the width.
     *
     * So it keeps asking, briefly, until the pane has a size. Bounded: a pane
     * that is still nothing after half a second is one nobody is looking at.
     */
    let frame = 0;
    let tries = 0;
    const attempt = () => {
      const container = containerRef.current;
      const terminal = terminalRef.current;
      const fit = fitRef.current;
      if (!container || !terminal || !fit) return;
      if (container.clientWidth === 0 || container.clientHeight === 0) {
        if (tries++ > 30) return;
        frame = window.requestAnimationFrame(attempt);
        return;
      }
      fit.fit();
      // Unconditional: this pane is now the one on screen, so the PTY has to
      // hear its size whether or not the fit above changed anything. The grid
      // is often already right and the PTY still wearing the other pane's.
      onResizeRef.current(terminal.cols, terminal.rows);
      terminal.focus();
    };
    frame = window.requestAnimationFrame(attempt);

    return () => window.cancelAnimationFrame(frame);
  }, [active]);

  /**
   * Start over when this pane comes back on screen.
   *
   * One session can be rendered in two places at once — its row in the Terminal
   * tab and its cell in the Council grid — and each pane fits itself, so both
   * resize the single PTY they share. Only the visible pane's size ever matches
   * it. The hidden one keeps receiving output drawn for the other pane's width,
   * and the moment it is shown it reflows that into overlapping boxes and
   * half-drawn rules.
   *
   * Nothing on a hidden pane is worth preserving, so becoming visible means
   * clearing it and replaying the buffer. The effect below then treats it as a
   * terminal with nothing on it, which is the one case where replaying from a
   * read boundary is safe; the `active` effect above fits it and resizes the
   * PTY on the next frame, and the CLI redraws for the size it is given.
   */
  const [resyncToken, setResyncToken] = useState(0);
  const wasActiveRef = useRef(active);
  useEffect(() => {
    const becameVisible = active && !wasActiveRef.current;
    wasActiveRef.current = active;
    const terminal = terminalRef.current;
    if (!becameVisible || !terminal) return;
    // Only when the size actually diverged. Replaying on every activation would
    // repaint the whole pane each time you changed session, which is the cost
    // keeping panes mounted exists to avoid.
    if (!needsResync(ptySize, { cols: terminal.cols, rows: terminal.rows })) return;
    terminal.reset();
    writtenIndexRef.current = 0;
    lastWrittenRef.current = null;
    setResyncToken((token) => token + 1);
  }, [active, ptySize]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || !geometryReady) return;

    const plan = terminalWritePlan(chunks, writtenIndexRef.current, lastWrittenRef.current, undefined, dropped, replayPreamble?.(sessionId) ?? "");
    if (plan.reset) {
      terminal.reset();
      // Counted where tests can see it: a pane that keeps resetting is a pane that flickers.
      if (containerRef.current) containerRef.current.dataset.resets = String(Number(containerRef.current.dataset.resets || 0) + 1);
    }

    // Verbatim. Every entry already carries whatever line ending it needs — the
    // PTY's own for output, terminalNotice's for anything Pitwall prints — and
    // adding one here would break the stream mid-redraw.
    for (const write of plan.writes) terminal.write(write);

    // Absolute, so it survives the buffer trimming from the front.
    writtenIndexRef.current = dropped + chunks.length;
    lastWrittenRef.current = chunks.length > 0 ? chunks[chunks.length - 1] : null;
  }, [chunks, resyncToken, dropped, geometryReady]);

  return (
    <div
      className={`dk-xterm${isDraggingImage ? " is-dragging-image" : ""}`}
      ref={containerRef}
      onClick={() => terminalRef.current?.focus()}
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepthRef.current += 1;
        if (Array.from(event.dataTransfer.items).some((item) => item.kind === "file")) {
          setIsDraggingImage(true);
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setIsDraggingImage(false);
      }}
      onDrop={handleDrop}
      onPaste={handlePaste}
    >
      <button
        className="dk-icon-btn dk-xterm-attach"
        type="button"
        title="Add images to terminal"
        aria-label="Add images to terminal"
        onClick={(event) => {
          event.stopPropagation();
          void chooseImages();
        }}
      >
        <ImagePlus size={16} aria-hidden="true" />
      </button>
      <div className="dk-xterm-drop" aria-hidden={!isDraggingImage}>
        Drop images to attach
      </div>
      {attachmentStatus && (
        <div
          className={`dk-xterm-status is-${attachmentStatus.tone}`}
          role="status"
          aria-live="polite"
        >
          {attachmentStatus.message}
        </div>
      )}
    </div>
  );
});
