import { Check, Pencil, Pin, RefreshCw, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { KnowledgeUpdateInput, KnowledgeView, ProjectKnowledgeSnapshot } from "../domain/projectKnowledge";
import { excerptBlocks, formatKnowledge, type KnowledgeBlock, type KnowledgeSpan } from "../lib/knowledgeText";
import { ContextReceiptList } from "./CouncilSummary";
import "../styles/projectKnowledge.css";

/**
 * Records are excerpts of real files, so their text arrives as Markdown, YAML
 * front matter or bare `key: value` lines. Rendering real elements is what
 * makes them readable; the source is never treated as HTML.
 */
function Spans({ spans }: { spans: KnowledgeSpan[] }) {
  return (
    <>
      {spans.map((span, index) =>
        span.code ? (
          <code key={index} title={span.href}>
            {span.text}
          </code>
        ) : span.href ? (
          <span className="dk-knowledge-link" key={index} title={span.href}>
            {span.text}
          </span>
        ) : (
          <span key={index}>{span.text}</span>
        ),
      )}
    </>
  );
}

function Blocks({ blocks }: { blocks: KnowledgeBlock[] }) {
  return (
    <div className="dk-desc">
      {blocks.map((block, index) => {
        if (block.type === "rule") return <hr key={index} />;
        if (block.type === "code") return <pre key={index}>{block.text}</pre>;
        if (block.type === "fields")
          return (
            <dl key={index}>
              {block.fields.map((field, position) => (
                <div key={position}>
                  <dt>{field.name}</dt>
                  <dd>{field.value}</dd>
                </div>
              ))}
            </dl>
          );
        if (block.type === "list") {
          const items = block.items.map((item, position) => (
            <li key={position}>
              <Spans spans={item} />
            </li>
          ));
          return block.ordered ? <ol key={index}>{items}</ol> : <ul key={index}>{items}</ul>;
        }
        if (block.type === "heading") {
          const Tag = (block.level <= 2 ? "h4" : "h5") as "h4" | "h5";
          return (
            <Tag key={index}>
              <Spans spans={block.spans} />
            </Tag>
          );
        }
        return (
          <p key={index}>
            <Spans spans={block.spans} />
          </p>
        );
      })}
    </div>
  );
}

function KnowledgeContent({ content }: { content: string }) {
  const blocks = formatKnowledge(content);
  const excerpt = excerptBlocks(blocks);
  if (!excerpt.truncated) return <Blocks blocks={blocks} />;
  return (
    <>
      <Blocks blocks={excerpt.blocks} />
      <details className="dk-knowledge-more">
        <summary>Read full record</summary>
        <Blocks blocks={blocks} />
      </details>
    </>
  );
}

type KnowledgeTab = "overview" | "areas" | "decisions" | "recent" | "receipts";
const TABS: Array<{ id: KnowledgeTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "areas", label: "Areas" },
  { id: "decisions", label: "Decisions" },
  { id: "recent", label: "Recent learning" },
  { id: "receipts", label: "Context used" },
];

export interface ProjectKnowledgePanelProps {
  projectPath: string;
  taskId?: string;
  workspacePath?: string;
  manualContext: ReactNode;
  refreshKey?: number;
}

export function ProjectKnowledgePanel({
  projectPath,
  taskId,
  workspacePath,
  manualContext,
  refreshKey,
}: ProjectKnowledgePanelProps) {
  const [snapshot, setSnapshot] = useState<ProjectKnowledgeSnapshot | null>(null);
  const [tab, setTab] = useState<KnowledgeTab>("overview");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<"loading" | "learning" | "saving" | null>("loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const requestId = useRef(0);
  const lastRefreshKey = useRef(refreshKey);
  const scope = `${projectPath}\n${workspacePath ?? ""}\n${taskId ?? ""}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const inspect = useCallback(
    async (clear = false) => {
      const request = ++requestId.current;
      const scopeAtStart = scopeRef.current;
      if (clear) {
        setSnapshot(null);
        setNotice("");
      }
      setBusy("loading");
      setError("");
      try {
        if (!window.pitwall?.inspectProjectKnowledge)
          throw new Error("Project knowledge is available in the desktop app after it has been restarted.");
        const result = await window.pitwall.inspectProjectKnowledge({ projectPath, workspacePath, taskId });
        if (request !== requestId.current || scopeAtStart !== scopeRef.current) return;
        if (!result.ok) throw new Error(result.error || "Could not load project knowledge.");
        setSnapshot(result);
      } catch (cause) {
        if (request === requestId.current && scopeAtStart === scopeRef.current)
          setError(cause instanceof Error ? cause.message : "Could not load project knowledge.");
      } finally {
        if (request === requestId.current && scopeAtStart === scopeRef.current) setBusy(null);
      }
    },
    [projectPath, workspacePath, taskId],
  );

  useEffect(() => {
    void inspect(true);
    return () => {
      requestId.current += 1;
    };
  }, [inspect]);

  useEffect(() => {
    if (lastRefreshKey.current === refreshKey || busy) return;
    lastRefreshKey.current = refreshKey;
    void inspect();
  }, [refreshKey, inspect, busy]);

  const learn = async () => {
    const request = ++requestId.current;
    const scopeAtStart = scope;
    setBusy("learning");
    setError("");
    setNotice("");
    try {
      if (!window.pitwall?.learnProjectKnowledge)
        throw new Error("Project learning is unavailable. Restart the desktop app and try again.");
      const result = await window.pitwall.learnProjectKnowledge({ projectPath, workspacePath, taskId });
      if (request !== requestId.current || scopeAtStart !== scopeRef.current) return;
      if (!result.ok) throw new Error(result.error || "Project learning failed.");
      setSnapshot(result);
      setNotice(`Project knowledge refreshed. ${result.coverage.filesInspected} source files inspected.`);
    } catch (cause) {
      if (request === requestId.current && scopeAtStart === scopeRef.current)
        setError(cause instanceof Error ? cause.message : "Project learning failed.");
    } finally {
      if (request === requestId.current && scopeAtStart === scopeRef.current) setBusy(null);
    }
  };

  const update = async (
    record: KnowledgeView,
    patch: KnowledgeUpdateInput["patch"],
    expectedVersion = record.version,
  ): Promise<boolean> => {
    const request = ++requestId.current;
    const scopeAtStart = scope;
    setBusy("saving");
    setError("");
    setNotice("");
    try {
      const bridge = window.pitwall;
      if (!bridge?.updateProjectKnowledge || !bridge.inspectProjectKnowledge)
        throw new Error("Updating project knowledge is unavailable. Restart the desktop app and try again.");
      const result = await bridge.updateProjectKnowledge({
        projectPath,
        workspacePath:
          patch.scope?.type === "project" && record.scope.type !== "project"
            ? record.scope.workspacePath
            : workspacePath,
        taskId: patch.scope?.type === "project" && record.scope.type === "task" ? record.scope.taskId : taskId,
        id: record.id,
        expectedVersion,
        patch,
      });
      if (request !== requestId.current || scopeAtStart !== scopeRef.current) return false;
      const refreshed = await bridge.inspectProjectKnowledge({ projectPath, workspacePath, taskId });
      if (request !== requestId.current || scopeAtStart !== scopeRef.current) return false;
      if (refreshed.ok) setSnapshot(refreshed);
      if (!result.ok) throw new Error(result.error || "Could not update this knowledge record.");
      if (!refreshed.ok)
        throw new Error(`The change was saved, but reloading failed. ${refreshed.error || "Try reloading."}`);
      setNotice(
        patch.status === "forgotten"
          ? "Record forgotten. It will no longer be included in new agent context."
          : "Knowledge updated.",
      );
      return true;
    } catch (cause) {
      if (request === requestId.current && scopeAtStart === scopeRef.current)
        setError(cause instanceof Error ? cause.message : "Could not update this knowledge record.");
      return false;
    } finally {
      if (request === requestId.current && scopeAtStart === scopeRef.current) setBusy(null);
    }
  };

  const records =
    snapshot?.records.filter((record) => record.status !== "forgotten" && record.status !== "superseded") ?? [];
  const search = query.trim().toLocaleLowerCase();
  const visible = records
    .filter((record) => {
      if (tab === "areas" && record.kind !== "area") return false;
      if (tab === "decisions" && record.kind !== "decision") return false;
      if (
        tab === "overview" &&
        record.kind !== "overview" &&
        record.kind !== "command" &&
        record.kind !== "convention" &&
        !record.pinned
      )
        return false;
      return (
        !search ||
        [record.title, record.content, ...record.sources.map((source) => source.path)]
          .join("\n")
          .toLocaleLowerCase()
          .includes(search)
      );
    })
    .sort((a, b) =>
      tab === "recent"
        ? b.updatedAt.localeCompare(a.updatedAt)
        : Number(b.pinned) - Number(a.pinned) || a.title.localeCompare(b.title),
    );
  const staleCount = records.filter((record) => record.compatible && record.freshness === "stale").length;

  return (
    <section className="dk-page dk-memory" aria-label="Project knowledge">
      {manualContext}

      <section className="dk-section" aria-labelledby="knowledge-title">
        <div className="dk-section-head">
          <div>
            <h2 className="dk-section-title" id="knowledge-title">Learned by agents</h2>
            <p className="dk-section-desc">
              Read from the repository and picked up while agents work, shared across its worktrees. Keep what’s right; forget what isn’t.
            </p>
          </div>
          <button type="button" className="dk-btn" onClick={() => void learn()} disabled={busy !== null}>
            <RefreshCw size={14} aria-hidden="true" className={busy === "learning" ? "dk-spin" : undefined} />
            {busy === "learning"
              ? "Learning project…"
              : snapshot?.coverage.lastLearnedAt
                ? "Refresh project"
                : "Learn project"}
          </button>
        </div>

        {snapshot ? (
          <p className="dk-hint dk-memory-coverage">
            {[
              `${records.length} active ${records.length === 1 ? "record" : "records"}`,
              `${snapshot.coverage.filesInspected} source files inspected`,
              staleCount > 0 ? `${staleCount} need refresh` : "",
              snapshot.coverage.lastLearnedAt ? `Learned ${new Date(snapshot.coverage.lastLearnedAt).toLocaleString()}` : "",
            ].filter(Boolean).join(" · ")}
          </p>
        ) : null}
        {snapshot?.coverage.scanTruncated ? (
          <p className="dk-notice is-needs">
            This learning pass reached its scan limit. The records describe the inspected areas; further learning can add
            more coverage.
          </p>
        ) : null}
        {snapshot?.warnings.map((warning, index) => (
          <p className="dk-notice is-needs" key={`${index}-${warning}`}>
            {warning}
          </p>
        ))}
        {error ? (
          <div className="dk-notice is-failed" role="alert">
            <span>{error}</span>
            <button type="button" className="dk-btn dk-btn--sm" onClick={() => void inspect()} disabled={busy !== null}>
              Reload
            </button>
          </div>
        ) : null}
        <div className="dk-hint dk-memory-status" role="status" aria-live="polite">
          {busy === "learning"
            ? "Reading project instructions, manifests and entry points. This pass is bounded; deeper knowledge accumulates as agents work."
            : busy === "loading"
              ? "Loading project knowledge…"
              : busy === "saving"
                ? "Saving knowledge…"
                : notice}
        </div>

        <div className="dk-memory-bar">
          <div className="dk-subtabs" role="group" aria-label="Project knowledge views">
            {TABS.map((item) => (
              <button
                type="button"
                key={item.id}
                className={tab === item.id ? "is-current" : undefined}
                aria-pressed={tab === item.id}
                onClick={() => setTab(item.id)}
              >
                {item.label}
                {item.id === "receipts" && snapshot?.receipts.length ? <span className="dk-faint"> {snapshot.receipts.length}</span> : null}
              </button>
            ))}
          </div>
          {tab === "receipts" ? null : (
            <label className="dk-search dk-memory-search">
              <Search size={14} aria-hidden="true" />
              <input
                type="search"
                aria-label="Search project knowledge"
                placeholder="Search knowledge or source paths"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          )}
        </div>

        {tab === "receipts" ? (
          <ContextReceiptList receipts={snapshot?.receipts ?? []} />
        ) : visible.length ? (
          <div className="dk-list">
            {visible.map((record) => (
              <KnowledgeCard
                key={`${scope}-${record.id}`}
                record={record}
                disabled={busy !== null}
                onUpdate={update}
              />
            ))}
          </div>
        ) : busy === "loading" ? null : (
          <div className="dk-card dk-empty">
            <strong>
              {search
                ? "No matching knowledge"
                : records.length
                  ? `No ${tab === "recent" ? "recent learning" : tab} records yet`
                  : "Give the next task a head start"}
            </strong>
            <span>
              {search
                ? "Try another phrase or source path."
                : records.length
                  ? "Knowledge grows as the project is learned and agents record their findings."
                  : "Learn the project to collect its instructions, documented commands and main areas. Agents add discoveries as they work."}
            </span>
          </div>
        )}
      </section>
    </section>
  );
}

function KnowledgeCard({
  record,
  disabled,
  onUpdate,
}: {
  record: KnowledgeView;
  disabled: boolean;
  onUpdate: (record: KnowledgeView, patch: KnowledgeUpdateInput["patch"], expectedVersion?: number) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<{ title: string; content: string; version: number } | null>(null);
  const scopeLabel =
    record.scope.type === "project"
      ? "Project"
      : record.scope.type === "task"
        ? `Task · ${record.scope.taskId}`
        : "Workspace";
  const changed = draft && draft.version !== record.version;
  return (
    <article className={`dk-knowledge${record.pinned ? " is-pinned" : ""}`}>
      {draft ? (
        <form
          className="dk-knowledge-editor"
          onSubmit={async (event) => {
            event.preventDefault();
            if (await onUpdate(record, { title: draft.title.trim(), content: draft.content.trim() }, draft.version))
              setDraft(null);
          }}
        >
          <label className="dk-field">
            <span className="dk-label">Title</span>
            <input
              className="dk-input"
              aria-label="Title"
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              required
              maxLength={240}
            />
          </label>
          <label className="dk-field">
            <span className="dk-label">Knowledge</span>
            <textarea
              className="dk-textarea"
              aria-label="Knowledge"
              value={draft.content}
              onChange={(event) => setDraft({ ...draft, content: event.target.value })}
              required
              rows={5}
              maxLength={12000}
            />
          </label>
          {changed ? (
            <div className="dk-notice is-needs" role="alert">
              <p>This record changed while you were editing. Your draft is preserved.</p>
              <details>
                <summary>Review the latest saved version</summary>
                <strong>{record.title}</strong>
                <p>{record.content}</p>
              </details>
              <button type="button" className="dk-btn dk-btn--sm" onClick={() => setDraft({ ...draft, version: record.version })}>
                Keep draft and use version {record.version}
              </button>
            </div>
          ) : null}
          <div className="dk-knowledge-actions">
            <button type="button" className="dk-btn dk-btn--ghost dk-btn--sm" onClick={() => setDraft(null)} disabled={disabled}>
              <X size={13} aria-hidden="true" />
              Cancel
            </button>
            <button
              type="submit"
              className="dk-btn dk-btn--primary dk-btn--sm"
              disabled={disabled || Boolean(changed) || !draft.title.trim() || !draft.content.trim()}
            >
              <Check size={13} aria-hidden="true" />
              Save
            </button>
          </div>
        </form>
      ) : (
        <>
          <h3 className="dk-knowledge-title">
            {record.pinned ? <Pin size={12} className="dk-faint" aria-label="Pinned" /> : null}
            {record.title}
          </h3>
          <KnowledgeContent content={record.content} />
        </>
      )}
      <div className="dk-knowledge-foot">
        <span className="dk-knowledge-meta">
          <span>{record.kind.charAt(0).toUpperCase() + record.kind.slice(1)}</span>
          <span>{scopeLabel}</span>
          <span className={`dk-badge${record.freshness === "stale" ? " dk-badge--amber" : record.freshness === "current" ? " dk-badge--green" : ""}`}>
            {record.freshness === "current"
              ? "Sources unchanged"
              : record.freshness === "stale"
                ? "Sources changed"
                : "Freshness unknown"}
          </span>
          {record.status === "tentative" ? <span className="dk-badge">Tentative</span> : null}
          {!record.compatible ? <span className="dk-badge">Other task or workspace</span> : null}
        </span>
        <details className="dk-knowledge-sources">
          <summary>
            {record.sources.length
              ? `${record.sources.length} source${record.sources.length === 1 ? "" : "s"}`
              : "No source evidence"}{" "}
            · v{record.version}
          </summary>
          <p>
            {record.origin === "inventory"
              ? "Learned from repository files"
              : record.origin === "user"
                ? "Edited by you"
                : record.author === "hermes"
                  ? "Learned by Hermes"
                  : "Observed by an agent"}{" "}
            · {new Date(record.updatedAt).toLocaleString()}
          </p>
          {record.sources.map((source) => (
            <p key={source.path}>
              <code className="dk-mono">{source.path}</code>
              <span className="dk-faint"> Hash: {source.hash}</span>
            </p>
          ))}
          {record.scope.type !== "project" ? (
            <p className="dk-faint">
              {record.scope.workspacePath}
              {record.scope.branch ? ` · ${record.scope.branch}` : ""}
            </p>
          ) : null}
        </details>
        {!draft ? (
          <div className="dk-knowledge-actions">
            <button
              type="button"
              className="dk-btn dk-btn--ghost dk-btn--sm"
              onClick={() => setDraft({ title: record.title, content: record.content, version: record.version })}
              disabled={disabled}
              aria-label={`Edit ${record.title}`}
            >
              <Pencil size={13} aria-hidden="true" />
              Edit
            </button>
            <button
              type="button"
              className="dk-btn dk-btn--ghost dk-btn--sm"
              onClick={() => void onUpdate(record, { pinned: !record.pinned })}
              disabled={disabled}
              aria-pressed={record.pinned}
              aria-label={`${record.pinned ? "Unpin" : "Pin"} ${record.title}`}
            >
              <Pin size={13} aria-hidden="true" />
              {record.pinned ? "Pinned" : "Pin"}
            </button>
            {record.scope.type !== "project" && record.sources.length > 0 ? (
              <button
                type="button"
                className="dk-btn dk-btn--ghost dk-btn--sm"
                onClick={() => void onUpdate(record, { scope: { type: "project" } })}
                disabled={disabled}
                title="Share this finding with other tasks after its sources match the main project"
              >
                Share with project
              </button>
            ) : null}
            <button
              type="button"
              className="dk-btn dk-btn--sm"
              onClick={() => void onUpdate(record, { status: "forgotten" })}
              disabled={disabled}
              aria-label={`Forget ${record.title}`}
            >
              Forget
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}
