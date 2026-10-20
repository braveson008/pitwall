import { Component, Suspense, lazy, memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ChevronRight, ExternalLink, File, Folder, FolderOpen, MessageSquarePlus, RotateCw, X } from "lucide-react";
import { ancestorsOf, baseName, buildTree, changedFolders, flattenTree, type TreeRow } from "../lib/fileTree";
import type { EditorSelection } from "./CodeEditor";
import { shortcutLabel, filesShortcutLabel } from "../lib/shortcutLabel";

// The editor is a few hundred kilobytes nobody pays for until they open a file.
const CodeEditor = lazy(() => import("./CodeEditor"));

const ROW = 26;
const OVERSCAN = 12;
const STATUS_EVERY_MS = 3000;

export type FilesOpenRequest = { path: string; nonce: number };

type Props = {
  /** The session's worktree. Everything shown is inside it. */
  root: string;
  openRequest: FilesOpenRequest | null;
  editorName: string | null;
  onOpenExternal: (filePath: string) => void;
  /** Puts a reference into the session's input, unsent. */
  onAskAgent: (reference: string) => void;
  onClose: () => void;
};

type OpenFile = {
  path: string;
  text: string;
  hash: string;
  /** The disk changed under the open file. */
  stale: boolean;
  error: string;
};

const kindLabel: Record<string, string> = { added: "A", untracked: "U", modified: "M", deleted: "D", renamed: "R" };

export default function FilesPanel({ root, openRequest, editorName, onOpenExternal, onAskAgent, onClose }: Props) {
  const [files, setFiles] = useState<string[]>([]);
  const [listError, setListError] = useState("");
  const [changes, setChanges] = useState<Map<string, string>>(new Map());
  const [view, setView] = useState<"all" | "changed">("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState(0);
  const [open, setOpen] = useState<OpenFile | null>(null);
  const [dirty, setDirty] = useState(false);
  const [selection, setSelection] = useState<EditorSelection | null>(null);
  const [saveNote, setSaveNote] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ top: 0, height: 600 });
  const openRef = useRef(open);
  openRef.current = open;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const changeKey = useRef("");
  // A reply for a worktree that is no longer shown must not land in this one.
  const rootRef = useRef(root);
  rootRef.current = root;

  // ── listing and status ───────────────────────────────────────────────
  const relist = useCallback(async () => {
    const result = await window.braveli?.listFiles?.({ root });
    if (!result || rootRef.current !== root) return;
    if (!result.ok) {
      setListError(result.error || "The files could not be listed");
      return;
    }
    setListError("");
    setFiles(result.files);
  }, [root]);

  const refreshStatus = useCallback(async () => {
    const status = await window.braveli?.fileChanges?.({ root }).catch(() => null);
    if (!status?.ok || rootRef.current !== root) return;
    const key = status.changes.map((change) => `${change.kind}:${change.path}`).join("\n");
    if (key === changeKey.current) return;
    const added = status.changes.some((change) => change.kind === "untracked" || change.kind === "added" || change.kind === "deleted" || change.kind === "renamed");
    changeKey.current = key;
    setChanges(new Map(status.changes.map((change) => [change.path, change.kind])));
    // A file appearing or going is the only thing that changes the listing.
    if (added) void relist();
  }, [relist, root]);

  useEffect(() => {
    setFiles([]);
    setChanges(new Map());
    setExpanded(new Set());
    setOpen(null);
    setFocused(0);
    changeKey.current = "";
    void relist();
    void refreshStatus();
    const tick = () => {
      if (document.visibilityState === "visible") void refreshStatus();
    };
    const timer = window.setInterval(tick, STATUS_EVERY_MS);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
    };
  }, [refreshStatus, relist]);

  // ── the open file ───────────────────────────────────────────────────
  const openFile = useCallback(async (filePath: string) => {
    const result = await window.braveli?.readFile?.({ root, path: filePath });
    if (rootRef.current !== root) return;
    setSelection(null);
    setSaveNote("");
    if (!result?.ok) {
      setOpen({ path: filePath, text: "", hash: "", stale: false, error: result?.error || "The file could not be opened" });
      return;
    }
    setOpen({ path: filePath, text: result.content ?? "", hash: result.hash ?? "", stale: false, error: "" });
  }, [root]);

  // Edits live only in the editor, so leaving the file is where they would be lost.
  const keepEdits = useCallback(() => {
    if (!dirtyRef.current) return false;
    if (window.confirm(`Discard your unsaved changes to ${openRef.current?.path ?? "this file"}?`)) {
      setDirty(false);
      return false;
    }
    return true;
  }, []);
  const closeFile = () => {
    if (!keepEdits()) setOpen(null);
  };

  useEffect(() => {
    if (!openRequest) return;
    if (openRef.current?.path !== openRequest.path && keepEdits()) return;
    setExpanded((current) => new Set([...current, ...ancestorsOf(openRequest.path)]));
    void openFile(openRequest.path);
  }, [keepEdits, openFile, openRequest]);

  const reload = useCallback(async () => {
    const current = openRef.current;
    if (!current) return;
    const result = await window.braveli?.readFile?.({ root, path: current.path });
    if (!result?.ok) {
      setOpen({ ...current, stale: false, error: result?.error || "The file could not be read" });
      return;
    }
    setSaveNote("");
    setOpen({ path: current.path, text: result.content ?? "", hash: result.hash ?? "", stale: false, error: "" });
  }, [root]);

  // An agent writing the open file: take it in quietly when nothing would be
  // lost, and ask only when there are edits of yours to lose.
  useEffect(() => {
    const path = open?.path;
    if (!path || !window.braveli?.watchFile) return;
    void window.braveli.watchFile({ root, path });
    const off = window.braveli.onFileChanged?.((event) => {
      if (event.root !== root || event.path !== path) return;
      void window.braveli?.readFile?.({ root, path }).then((result) => {
        const current = openRef.current;
        if (!result?.ok || !current || current.path !== path || result.hash === current.hash) return;
        if (dirtyRef.current) setOpen({ ...current, stale: true });
        else setOpen({ ...current, text: result.content ?? "", hash: result.hash ?? "", stale: false, error: "" });
      });
    });
    return () => {
      off?.();
      void window.braveli?.unwatchFile?.();
    };
  }, [open?.path, root]);

  const save = useCallback(async (text: string) => {
    const current = openRef.current;
    if (!current || !window.braveli?.writeFile) return false;
    const result = await window.braveli.writeFile({ root, path: current.path, content: text, hash: current.hash });
    if (!result.ok) {
      if (result.conflict) setOpen({ ...current, stale: true });
      setSaveNote(result.conflict ? "" : result.error || "Not saved");
      return false;
    }
    void window.braveli?.captureEvent?.("file_saved", { surface: "files" });
    // The hash moves on, the text does not: replacing it would rebuild the editor under the cursor.
    openRef.current = { ...current, hash: result.hash ?? current.hash, stale: false };
    setOpen(openRef.current);
    setSaveNote("");
    return true;
  }, [root]);

  // ── the tree ────────────────────────────────────────────────────────
  const tree = useMemo(() => buildTree(files), [files]);
  const changedDirs = useMemo(() => changedFolders(changes.keys()), [changes]);
  const rows: TreeRow[] = useMemo(() => {
    if (view === "changed") {
      return [...changes.keys()].sort().map((filePath) => ({ path: filePath, name: baseName(filePath), depth: 0, isDir: false }));
    }
    return flattenTree(tree, expanded);
  }, [changes, expanded, tree, view]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setScroll({ top: list.scrollTop, height: list.clientHeight }));
    };
    measure();
    list.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => {
      cancelAnimationFrame(frame);
      list.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [open]);

  const first = Math.max(0, Math.floor(scroll.top / ROW) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scroll.top + scroll.height) / ROW) + OVERSCAN);

  const activate = useCallback((row: TreeRow) => {
    if (!row.isDir) {
      void openFile(row.path);
      return;
    }
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(row.path)) next.delete(row.path);
      else next.add(row.path);
      return next;
    });
  }, [openFile]);

  const onRowActivate = useCallback((row: TreeRow, index: number) => {
    setFocused(index);
    activate(row);
  }, [activate]);

  const keepVisible = (index: number) => {
    const list = listRef.current;
    if (!list) return;
    const top = index * ROW;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + ROW > list.scrollTop + list.clientHeight) list.scrollTop = top + ROW - list.clientHeight;
  };

  const onTreeKey = (event: React.KeyboardEvent) => {
    const row = rows[focused];
    let next = focused;
    if (event.key === "ArrowDown") next = Math.min(rows.length - 1, focused + 1);
    else if (event.key === "ArrowUp") next = Math.max(0, focused - 1);
    else if (event.key === "Enter" && row) activate(row);
    else if (event.key === "ArrowRight" && row?.isDir && !expanded.has(row.path)) activate(row);
    else if (event.key === "ArrowLeft" && row?.isDir && expanded.has(row.path)) activate(row);
    else if (event.key === "Escape") onClose();
    else return;
    event.preventDefault();
    setFocused(next);
    keepVisible(next);
  };

  const askAgent = () => {
    if (!open || !selection) return;
    const lines = selection.startLine === selection.endLine ? `${selection.startLine}` : `${selection.startLine}-${selection.endLine}`;
    onAskAgent(`${open.path}:${lines} `);
    setSelection(null);
  };

  // ── drawing ─────────────────────────────────────────────────────────
  if (open) {
    const crumbs = open.path.split("/");
    return (
      <section className="dk-files" aria-label="File" onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented && !selection) closeFile();
      }}>
        <header className="dk-files-head">
          <button type="button" className="dk-icon-btn" onClick={closeFile} title="Back to files (Esc)" aria-label="Back to files">
            <ArrowLeft size={15} aria-hidden="true" />
          </button>
          <span className="dk-files-crumbs" title={open.path}>
            {crumbs.slice(0, -1).map((part, index) => <span key={index} className="dk-faint">{part}<span aria-hidden="true"> › </span></span>)}
            <strong>{crumbs[crumbs.length - 1]}</strong>
            {dirty ? <span className="dk-files-dirty" title={shortcutLabel("Unsaved — ⌘S to save")} aria-label="Unsaved changes" /> : null}
          </span>
          <button type="button" className="dk-icon-btn" onClick={() => onOpenExternal(open.path)} title={editorName ? `Open in ${editorName}` : "Reveal in Finder"} aria-label={editorName ? `Open in ${editorName}` : "Reveal in Finder"}>
            <ExternalLink size={14} aria-hidden="true" />
          </button>
        </header>
        {open.stale ? (
          <div className="dk-files-note" role="status">
            <span>{dirty ? "Changed on disk while you were editing." : "Changed on disk."}</span>
            <button type="button" className="dk-link-btn" onClick={() => void reload()}>
              <RotateCw size={12} aria-hidden="true" /> {dirty ? "Reload and drop my edits" : "Reload"}
            </button>
          </div>
        ) : saveNote ? (
          <div className="dk-files-note is-error" role="alert">{saveNote}</div>
        ) : null}
        <div className="dk-files-editor">
          {open.error ? (
            <p className="dk-files-empty">{open.error}</p>
          ) : (
            <EditorBoundary key={open.path}>
              <Suspense fallback={<p className="dk-files-empty">Opening…</p>}>
                <CodeEditor path={open.path} text={open.text} onDirty={setDirty} onSave={save} onSelection={setSelection} />
              </Suspense>
            </EditorBoundary>
          )}
          {selection ? (
            <button
              type="button"
              className="dk-files-ask"
              style={{ top: selection.top + 6, left: Math.max(8, selection.left) }}
              onMouseDown={(event) => event.preventDefault()}
              onClick={askAgent}
            >
              <MessageSquarePlus size={13} aria-hidden="true" /> Ask agent
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className="dk-files" aria-label="Files">
      <header className="dk-files-head">
        <div className="dk-files-switch" role="group" aria-label="Which files">
          <button type="button" aria-pressed={view === "all"} className={view === "all" ? "is-current" : undefined} onClick={() => { setView("all"); setFocused(0); }}>
            All files
          </button>
          <button type="button" aria-pressed={view === "changed"} className={view === "changed" ? "is-current" : undefined} onClick={() => { setView("changed"); setFocused(0); }}>
            Changed <span className="dk-tab-count">{changes.size}</span>
          </button>
        </div>
        <span className="dk-spacer" />
        <button type="button" className="dk-icon-btn" onClick={onClose} title={`Close files (${filesShortcutLabel()})`} aria-label="Close files">
          <X size={14} aria-hidden="true" />
        </button>
      </header>
      <div
        className="dk-files-list"
        ref={listRef}
        role="tree"
        tabIndex={0}
        aria-label="Worktree files"
        aria-activedescendant={rows[focused] ? `file-row-${focused}` : undefined}
        onKeyDown={onTreeKey}
      >
        {listError ? <p className="dk-files-empty">{listError}</p> : null}
        {!listError && rows.length === 0 ? (
          <p className="dk-files-empty">{view === "changed" ? "Nothing changed yet." : "Listing files…"}</p>
        ) : null}
        <div style={{ height: rows.length * ROW, position: "relative" }}>
          {rows.slice(first, last).map((row, offset) => (
            <FileRow
              key={row.path}
              row={row}
              index={first + offset}
              focused={first + offset === focused}
              expanded={row.isDir && expanded.has(row.path)}
              change={row.isDir ? (changedDirs.has(row.path) ? "folder" : "") : changes.get(row.path) || ""}
              showDir={view === "changed"}
              onActivate={onRowActivate}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

/** A failed editor load is a line in the panel, never a blank window. */
class EditorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <p className="dk-files-empty">
        The editor could not load.{" "}
        <button type="button" className="dk-link-btn" onClick={() => window.location.reload()}>Reload</button>
      </p>
    );
  }
}

const FileRow = memo(function FileRow({ row, index, focused, expanded, change, showDir, onActivate }: {
  row: TreeRow;
  index: number;
  focused: boolean;
  expanded: boolean;
  change: string;
  showDir: boolean;
  onActivate: (row: TreeRow, index: number) => void;
}) {
  const dir = showDir ? row.path.slice(0, row.path.length - row.name.length - 1) : "";
  return (
    <div
      id={`file-row-${index}`}
      role="treeitem"
      aria-expanded={row.isDir ? expanded : undefined}
      aria-selected={focused}
      className={`dk-files-row${focused ? " is-focused" : ""}${change && change !== "folder" ? ` is-${change}` : ""}`}
      style={{ transform: `translateY(${index * ROW}px)`, paddingLeft: 10 + row.depth * 14 }}
      onClick={() => onActivate(row, index)}
      title={row.path}
    >
      {row.isDir ? (
        <>
          <ChevronRight size={12} className={`dk-files-caret${expanded ? " is-open" : ""}`} aria-hidden="true" />
          {expanded ? <FolderOpen size={14} aria-hidden="true" /> : <Folder size={14} aria-hidden="true" />}
        </>
      ) : (
        <>
          <span className="dk-files-caret" aria-hidden="true" />
          <File size={14} aria-hidden="true" />
        </>
      )}
      <span className="dk-files-name">{row.name}</span>
      {dir ? <span className="dk-files-dir">{dir}</span> : null}
      {change === "folder" ? <span className="dk-files-mark" aria-label="Contains changes" /> : null}
      {change && change !== "folder" ? <span className="dk-files-kind" aria-label={change}>{kindLabel[change] ?? "M"}</span> : null}
    </div>
  );
});
