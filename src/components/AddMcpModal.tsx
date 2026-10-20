import { useModalFocus } from "../hooks/useModalFocus";
import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { Dropdown } from "./Dropdown";

export interface AddMcpInput {
  name: string;
  transport: "stdio" | "http" | "sse";
  target: string;
  args: string;
  env: string;
  headers: string;
  scope: "local" | "project" | "user";
  auth: "none" | "oauth";
}

/**
 * Form for registering an MCP server on a provider. Owns its own fields and
 * submit/notice state; the parent performs the actual add and returns the
 * outcome so the modal can surface errors or close on success.
 */
export function AddMcpModal({
  open,
  providerLabel,
  showScope,
  onClose,
  onSubmit,
}: {
  open: boolean;
  providerLabel: string;
  showScope: boolean;
  onClose: () => void;
  onSubmit: (input: AddMcpInput) => Promise<{ ok: boolean; message?: string }>;
}) {
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<"stdio" | "http" | "sse">("stdio");
  const [target, setTarget] = useState("");
  const [args, setArgs] = useState("");
  const [env, setEnv] = useState("");
  const [headers, setHeaders] = useState("");
  const [scope, setScope] = useState<"local" | "project" | "user">("local");
  const [auth, setAuth] = useState<"none" | "oauth">("none");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!open) return;
    setName("");
    setTransport("stdio");
    setTarget("");
    setArgs("");
    setEnv("");
    setHeaders("");
    setScope("local");
    setAuth("none");
    setSubmitting(false);
    setNotice("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, onClose]);

  const dialogRef = useModalFocus<HTMLDivElement>(open, onClose);
  if (!open) return null;

  async function submit() {
    if (!name.trim() || !target.trim()) {
      setNotice("Name and command/URL are required.");
      return;
    }
    setSubmitting(true);
    setNotice("");
    // The OAuth box is hidden for a local server but keeps its tick from HTTP.
    const result = await onSubmit({ name, transport, target, args, env, headers, scope, auth: transport === "stdio" ? "none" : auth });
    if (result.ok) {
      onClose();
    } else {
      setNotice(result.message || "Failed to add MCP server.");
    }
    setSubmitting(false);
  }

  return (
    <div className="dk-backdrop" onClick={onClose}>
      <div ref={dialogRef} className="dk-dialog" role="dialog" aria-modal="true" aria-labelledby="add-mcp-title" onClick={(event) => event.stopPropagation()}>
        <div className="dk-dialog-header">
          <div>
            <h2 className="dk-dialog-title" id="add-mcp-title">Add an MCP server to {providerLabel}</h2>
            <p className="dk-dialog-desc">For a server that is not in the catalogue under Extensions.</p>
          </div>
          <button type="button" className="dk-icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="dk-dialog-body">
          <div className="dk-field">
            <span className="dk-label">Transport</span>
            <div className="dk-segmented" role="group" aria-label="Transport">
              {(["stdio", "http", "sse"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={transport === option ? "is-current" : undefined}
                  aria-pressed={transport === option}
                  onClick={() => setTransport(option)}
                >
                  {option === "stdio" ? "Local (stdio)" : option.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <label className="dk-field">
            <span className="dk-label">Name</span>
            <input className="dk-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. playwright" />
          </label>

          <label className="dk-field">
            <span className="dk-label">{transport === "stdio" ? "Command" : "Server URL"}</span>
            <input
              className="dk-input"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              placeholder={transport === "stdio" ? "npx" : "https://mcp.example.com/mcp"}
            />
          </label>

          {transport === "stdio" ? (
            <>
              <label className="dk-field">
                <span className="dk-label">Arguments</span>
                <input
                  className="dk-input"
                  value={args}
                  onChange={(event) => setArgs(event.target.value)}
                  placeholder="-y @modelcontextprotocol/server-filesystem ."
                />
              </label>
              <label className="dk-field">
                <span className="dk-label">Environment</span>
                <textarea className="dk-textarea" value={env} onChange={(event) => setEnv(event.target.value)} placeholder="API_KEY=sk-..." />
                <span className="dk-hint">One KEY=VALUE per line.</span>
              </label>
            </>
          ) : (
            <label className="dk-field">
              <span className="dk-label">Headers</span>
              <textarea
                className="dk-textarea"
                value={headers}
                onChange={(event) => setHeaders(event.target.value)}
                placeholder="Authorization: Bearer ..."
              />
              <span className="dk-hint">One per line.</span>
            </label>
          )}

          {showScope && (
            <div className="dk-field">
              <span className="dk-label">Scope</span>
              <Dropdown
                value={scope}
                onChange={(value) => setScope(value as "local" | "project" | "user")}
                ariaLabel="Scope"
                options={[
                  { value: "local", label: "Local · this machine, private" },
                  { value: "project", label: "Project · shared via .mcp.json" },
                  { value: "user", label: "User · all your projects" },
                ]}
              />
            </div>
          )}

          {transport !== "stdio" && (
            <label className="dk-check dk-check--block">
              <input
                type="checkbox"
                checked={auth === "oauth"}
                onChange={(event) => setAuth(event.target.checked ? "oauth" : "none")}
              />
              <span>
                OAuth authentication
                <span className="dk-hint">Use the provider's browser sign-in flow when supported.</span>
              </span>
            </label>
          )}

          {notice && <p className="dk-error" role="alert">{notice}</p>}
        </div>

        <div className="dk-dialog-footer">
          <button type="button" className="dk-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="dk-btn dk-btn--primary" onClick={() => void submit()} disabled={submitting}>
            <Plus size={15} />
            {submitting ? "Adding…" : "Add server"}
          </button>
        </div>
      </div>
    </div>
  );
}
