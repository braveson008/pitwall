import { ChevronRight, ExternalLink, LoaderCircle, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getProviderById } from "../domain/providers";
import { useModalFocus } from "../hooks/useModalFocus";
import { groupImportCandidates, summariseImportGroup, taskPreviewLine, mcpTaskIdentity, NOT_CONNECTED_HERE } from "../lib/taskImport";

interface McpTaskImportModalProps {
  open: boolean;
  projectId: string;
  projectPath: string;
  sources: McpTaskSource[];
  existingIdentities: Set<string>;
  onClose: () => void;
  onOpenConnections: (provider?: string) => void;
  onAuthenticate: (source: McpTaskSource) => void;
  onImport: (source: McpTaskSource, tasks: McpTaskCandidate[]) => void;
  onScopeSaved: (source: McpTaskSource) => void;
}

export function McpTaskImportModal({
  open,
  projectId,
  projectPath,
  sources,
  existingIdentities,
  onClose,
  onOpenConnections,
  onAuthenticate,
  onImport,
  onScopeSaved,
}: McpTaskImportModalProps) {
  const [sourceKey, setSourceKey] = useState("");
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("");
  const [tasks, setTasks] = useState<McpTaskCandidate[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  /**
   * Which groups are folded shut.
   *
   * Eighteen tickets in one open list is three and a half thousand pixels of
   * scrolling, and the first thing you want is not a ticket — it is the shape:
   * which sprints came back and how big each is. Folded, that fits on one
   * screen. The backlog starts shut because it is the part you are least often
   * importing.
   */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useModalFocus<HTMLElement>(open, onClose);

  useEffect(() => {
    if (!open) return;
    setSourceKey((current) => sources.some((item) => item.key === current) ? current : sources[0]?.key ?? "");
    setTasks([]);
    setStatusFilter("all");
    setSelected(new Set());
    setLoaded(false);
    setError("");
  }, [open, sources]);

  const selectedSource = sources.find((item) => item.key === sourceKey);
  useEffect(() => {
    setScope(selectedSource?.scope ?? "");
  }, [selectedSource?.key, selectedSource?.scope]);
  const available = useMemo(
    () => selectedSource
      ? tasks.filter((task) => !existingIdentities.has(mcpTaskIdentity(selectedSource.provider, selectedSource.name, task)))
      : [],
    [existingIdentities, selectedSource, tasks],
  );
  const sourceConnected = selectedSource?.status === "connected";
  const sourceReady = Boolean(sourceConnected && selectedSource?.importSupported);
  const statuses = useMemo(
    () => Array.from(new Set(tasks.map((task) => task.status?.trim()).filter((status): status is string => Boolean(status)))).sort(),
    [tasks],
  );
  const visibleTasks = statusFilter === "all" ? tasks : tasks.filter((task) => task.status?.trim() === statusFilter);

  if (!open) return null;

  async function saveScope() {
    if (!selectedSource || !window.pitwall?.setMcpTaskScope) return true;
    if (scope.trim() === (selectedSource.scope ?? "")) return true;
    const saved = await window.pitwall.setMcpTaskScope({
      projectId,
      projectPath,
      provider: selectedSource.provider,
      name: selectedSource.name,
      scope: scope.trim(),
    });
    if (!saved.ok) {
      setError(saved.error || "The scope could not be saved.");
      return false;
    }
    onScopeSaved(selectedSource);
    return true;
  }

  async function loadTasks() {
    if (!sourceReady || !selectedSource || !window.pitwall?.listMcpTasks) return;
    setLoading(true);
    setLoaded(false);
    setError("");
    try {
      if (!(await saveScope())) return;
      const result = await window.pitwall.listMcpTasks({
        projectId,
        projectPath,
        provider: selectedSource.provider,
        source: selectedSource.name,
        target: selectedSource.target,
        query: query.trim(),
      });
      if (!result.ok) {
        setTasks([]);
        setSelected(new Set());
        setError(result.error || "The MCP server did not return a task list.");
        return;
      }
      setTasks(result.tasks);
      setStatusFilter("all");
      setSelected(new Set(
        result.tasks
          .filter((task) => !existingIdentities.has(mcpTaskIdentity(selectedSource.provider, selectedSource.name, task)))
          .map((task) => mcpTaskIdentity(selectedSource.provider, selectedSource.name, task)),
      ));
    } catch (cause) {
      setTasks([]);
      setSelected(new Set());
      setError(cause instanceof Error ? cause.message : "Unable to read tasks from that MCP server.");
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }

  const selectedTasks = selectedSource
    ? available.filter((task) => selected.has(mcpTaskIdentity(selectedSource.provider, selectedSource.name, task)))
    : [];
  const providerName = selectedSource
    ? getProviderById(selectedSource.provider)?.displayName ?? selectedSource.provider
    : "provider";

  return (
    <div className="dk-backdrop" onClick={onClose}>
      <section ref={dialogRef} className="dk-dialog dk-dialog--wide dk-import" role="dialog" aria-modal="true" aria-labelledby="mcp-import-title" aria-describedby="mcp-import-description" onClick={(event) => event.stopPropagation()}>
        <div className="dk-dialog-header">
          <div>
            <h2 className="dk-dialog-title" id="mcp-import-title">Import from tracker</h2>
            {sources.length > 0 && sourceReady && selectedSource ? (
              <p className="dk-dialog-desc" id="mcp-import-description">
                Your open, assigned work from <strong>{selectedSource.label}</strong>, read through {providerName}. Importing only changes Pitwall.
              </p>
            ) : null}
          </div>
          <button className="dk-icon-btn" type="button" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        {sources.length === 0 ? (
          <div className="dk-empty">
            <strong>No tracker connected</strong>
            <span id="mcp-import-description">Connect Jira, Linear, or another issue tracker for this project, then import its assigned open work.</span>
            <button className="dk-btn dk-btn--primary" type="button" onClick={() => onOpenConnections()}>Open connections</button>
          </div>
        ) : (
          <>
            <div className="dk-import-fields">
              <label className="dk-field">
                <span className="dk-label">Source</span>
                <select className="dk-select" data-dialog-autofocus value={sourceKey} onChange={(event) => { setSourceKey(event.target.value); setTasks([]); setSelected(new Set()); setLoaded(false); setError(""); setCollapsed(new Set()); }}>
                  {sources.map((item) => {
                    const owner = getProviderById(item.provider)?.displayName ?? item.provider;
                    const state = item.status === "connected" ? "" : ` · ${item.statusText || item.status}`;
                    return <option value={item.key} key={item.key}>{item.label} — {owner}{state}</option>;
                  })}
                </select>
              </label>
              {sourceReady && selectedSource ? (
                <label className="dk-field">
                  <span className="dk-label">Scope</span>
                  <input className="dk-input" value={scope} maxLength={120} onChange={(event) => setScope(event.target.value)} onBlur={() => void saveScope()} onKeyDown={(event) => { if (event.key === "Enter") void loadTasks(); }} placeholder="e.g. SHOP" title="Every read for this project stays inside it. Empty reads everything assigned to you." />
                </label>
              ) : null}
              <label className="dk-field">
                <span className="dk-label">Filter</span>
                <input className="dk-input" value={query} disabled={!sourceReady} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void loadTasks(); }} placeholder="e.g. onboarding or ENG-412" />
              </label>
              <button className="dk-btn" type="button" onClick={() => void loadTasks()} disabled={loading || !sourceReady}>
                {loading ? <LoaderCircle className="dk-spin" size={14} /> : <Search size={14} />}
                {loading ? "Reading" : "Find tasks"}
              </button>
            </div>

            {sourceReady && selectedSource ? null : sourceConnected && selectedSource ? (
              <div className="dk-notice dk-import-notice" id="mcp-import-description">
                {selectedSource.provider === "claude" ? (
                  <span><strong>{selectedSource.label}</strong> is connected, but Pitwall has not audited a read-only task tool set for this source. Jira, Linear, and GitHub Issues are currently supported.</span>
                ) : (
                  <>
                    <span><strong>{selectedSource.label}</strong> belongs to {providerName}. Task preview currently runs through Claude, so add or connect this source under Claude to import from it.</span>
                    <button className="dk-btn dk-btn--sm" type="button" onClick={() => onOpenConnections("claude")}>Open Claude connections</button>
                  </>
                )}
              </div>
            ) : (
              <div className="dk-notice is-needs dk-import-notice" id="mcp-import-description">
                {selectedSource?.statusText === NOT_CONNECTED_HERE ? (
                  <span><strong>{selectedSource.label}</strong> isn’t connected for this project yet. Connect it once and Pitwall uses that login for this project from then on.</span>
                ) : (
                  <span><strong>{selectedSource?.label || "This source"}</strong> is configured for {providerName}, but {providerName} reports {selectedSource?.statusText || "authentication is required"}.</span>
                )}
                {selectedSource && /http|sse/i.test(selectedSource.transport)
                  ? <button className="dk-btn dk-btn--primary dk-btn--sm" type="button" onClick={() => onAuthenticate(selectedSource)}>{selectedSource.statusText === NOT_CONNECTED_HERE ? "Connect" : "Authenticate"}</button>
                  : <button className="dk-btn dk-btn--sm" type="button" onClick={() => onOpenConnections(selectedSource?.provider)}>Open connections</button>}
              </div>
            )}

            <div className="dk-import-results" aria-live="polite">
              {error ? <div className="dk-empty" role="alert"><strong>Couldn’t load tasks</strong><span>{error}</span></div> : null}
              {!error && loading ? <div className="dk-empty" role="status"><LoaderCircle className="dk-spin" size={20} aria-hidden="true" /><strong>Reading connected work</strong><span>The source decides which issue tools answer this request.</span></div> : null}
              {!error && !loading && loaded && tasks.length === 0 ? <div className="dk-empty" role="status"><strong>No matching open tasks</strong><span>Try a different filter or source.</span></div> : null}
              {!error && !loading && !loaded ? <div className="dk-empty"><strong>Choose what comes into Pitwall</strong><span>Find tasks, pick the ones you want, then import them as ready tasks.</span></div> : null}
              {!error && !loading && tasks.length > 0 ? (
                <>
                  {statuses.length > 1 ? (
                    <label className="dk-import-status">
                      <span className="dk-label">Tracker status</span>
                      <select className="dk-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                        <option value="all">All statuses ({tasks.length})</option>
                        {statuses.map((status) => <option value={status} key={status}>{status} ({tasks.filter((task) => task.status?.trim() === status).length})</option>)}
                      </select>
                    </label>
                  ) : null}
                  {/* Laid out the way the board it came from is: sprints and the
                      backlog as groups, so this week's work is told apart from
                      work three weeks out without opening every one. */}
                  {groupImportCandidates(visibleTasks).map((group) => {
                    const identityOf = (task: McpTaskCandidate) => mcpTaskIdentity(selectedSource!.provider, selectedSource!.name, task);
                    const groupNew = group.tasks.filter((task) => !existingIdentities.has(identityOf(task)));
                    const picked = groupNew.filter((task) => selected.has(identityOf(task))).length;
                    // The backlog opens shut: it is the part you are least
                    // often importing, and it is usually the biggest.
                    const isShut = collapsed.has(group.key) || (group.isBacklog && !collapsed.has(`open:${group.key}`));
                    return (
                      <section className="dk-import-group" key={group.key}>
                        <header className="dk-import-group-head">
                          <button
                            type="button"
                            className="dk-import-group-toggle"
                            aria-expanded={!isShut}
                            onClick={() => setCollapsed((current) => {
                              const next = new Set(current);
                              if (group.isBacklog) {
                                if (isShut) next.add(`open:${group.key}`);
                                else next.delete(`open:${group.key}`);
                              } else if (isShut) next.delete(group.key);
                              else next.add(group.key);
                              return next;
                            })}
                          >
                            <ChevronRight size={13} className={isShut ? undefined : "is-open"} aria-hidden="true" />
                            <strong>{group.label}</strong>
                            <span>{summariseImportGroup(group.tasks, group)}</span>
                          </button>
                          {groupNew.length > 0 ? (
                            <button
                              type="button"
                              className="dk-link"
                              onClick={() => setSelected((current) => {
                                const next = new Set(current);
                                const takeAll = picked < groupNew.length;
                                for (const task of groupNew) {
                                  if (takeAll) next.add(identityOf(task));
                                  else next.delete(identityOf(task));
                                }
                                return next;
                              })}
                            >
                              {picked === groupNew.length ? "Clear" : picked > 0 ? `Select all ${groupNew.length}` : `Select ${groupNew.length}`}
                            </button>
                          ) : null}
                        </header>
                        {!isShut ? (
                          <div className="dk-import-items">
                            {group.tasks.map((task) => {
                              const identity = identityOf(task);
                              const duplicate = existingIdentities.has(identity);
                              const checked = selected.has(identity);
                              const hint = taskPreviewLine(task.description);
                              return (
                                <label className={`dk-import-item${duplicate ? " is-duplicate" : ""}`} key={identity}>
                                  <input type="checkbox" checked={checked} disabled={duplicate} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(identity); else next.delete(identity); return next; })} />
                                  <span className="dk-row-main">
                                    {/* The title leads. The key and the column
                                        are how you place it, not what it is. */}
                                    <span className="dk-import-item-title">{task.title}</span>
                                    <span className="dk-row-sub">
                                      <span className="dk-mono">{task.id || "Task"}</span>
                                      {task.status ? ` · ${task.status}` : ""}
                                      {hint ? ` · ${hint}` : ""}
                                    </span>
                                  </span>
                                  {duplicate ? <span className="dk-badge">Already imported</span> : null}
                                  {task.url ? <button type="button" className="dk-icon-btn dk-icon-btn--sm" aria-label={`Open ${task.id || task.title}`} title="Open in tracker" onClick={(event) => { event.preventDefault(); event.stopPropagation(); void window.pitwall?.openExternalUrl(task.url!); }}><ExternalLink size={13} /></button> : null}
                                </label>
                              );
                            })}
                          </div>
                        ) : null}
                      </section>
                    );
                  })}
                  {visibleTasks.length === 0 ? <p className="dk-empty">No tasks have this tracker status.</p> : null}
                </>
              ) : null}
            </div>

            <div className="dk-dialog-footer">
              <span className="dk-hint">{tasks.length > 0 ? `${selectedTasks.length} of ${available.length} new tasks selected` : "You can still create tasks by hand."}</span>
              <button className="dk-btn dk-btn--ghost" type="button" onClick={onClose}>Cancel</button>
              <button className="dk-btn dk-btn--primary" type="button" disabled={selectedTasks.length === 0 || !selectedSource} onClick={() => selectedSource && onImport(selectedSource, selectedTasks)}>
                {selectedTasks.length ? `Import ${selectedTasks.length} ${selectedTasks.length === 1 ? "task" : "tasks"}` : "Import selected"}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
