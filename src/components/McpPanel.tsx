import { KeyRound, Plus, RefreshCw, Terminal, Trash2 } from "lucide-react";
import { getProviderById, providerRegistry } from "../domain/providers";
import type { BraveliProviderId } from "../domain/types";
import { mcpTaskSourceLabel } from "../lib/taskImport";

const mcpStatusLabel: Record<string, string> = {
  connected: "Connected",
  failed: "Failed",
  pending: "Pending approval",
  "needs-auth": "Needs auth",
  configured: "Configured",
};

const mcpStatusTone: Record<string, string> = {
  connected: "is-ready",
  failed: "is-failed",
  pending: "is-needs",
  "needs-auth": "is-needs",
};

const mcpStatusText: Record<string, string> = {
  failed: "is-failed",
  pending: "is-needs",
  "needs-auth": "is-needs",
};

function providerLabel(id: BraveliProviderId) {
  return getProviderById(id)?.displayName ?? String(id);
}

function providerCommand(id: BraveliProviderId) {
  return getProviderById(id)?.command ?? String(id);
}

/**
 * Live MCP server manager for the mission drawer. Discovery/mutations are driven
 * from the parent (it owns the IPC calls); this component just renders the
 * per-provider server list and reports intents back through callbacks.
 */
export function McpPanel({
  activeProjectId,
  mcpProvider,
  setMcpProvider,
  mcpByProvider,
  mcpLoading,
  mcpBusy,
  mcpAuthBusy,
  mcpNotice,
  mcpNoticeTone,
  onAdd,
  onRefresh,
  onRemove,
  onAuth,
  onUseInSession,
}: {
  activeProjectId: string;
  mcpProvider: BraveliProviderId;
  setMcpProvider: (id: BraveliProviderId) => void;
  mcpByProvider: Partial<Record<BraveliProviderId, McpListResult>>;
  mcpLoading: boolean;
  mcpBusy: string;
  mcpAuthBusy: string;
  mcpNotice: string;
  mcpNoticeTone: "neutral" | "success" | "error";
  onAdd: () => void;
  onRefresh: (provider: BraveliProviderId) => void;
  onRemove: (server: McpServerInfo) => void;
  onAuth: (server: McpServerInfo) => void;
  onUseInSession: (provider: BraveliProviderId) => void;
}) {
  const mcpState = mcpByProvider[mcpProvider];
  const mcpServers = mcpState?.servers ?? [];
  const mcpConnectedCount = mcpServers.filter((server) => server.status === "connected").length;


  return (
    <div className="dk-mcp">
      <div className="dk-toolbar">
        <div className="dk-segmented" role="group" aria-label="Agent">
          {providerRegistry.map((provider) => {
            const data = mcpByProvider[provider.id];
            const count = data?.servers.length ?? 0;
            const missing = Boolean(data && !data.installed);
            return (
              <button
                key={provider.id}
                type="button"
                className={[mcpProvider === provider.id ? "is-current" : "", missing ? "is-missing" : ""].filter(Boolean).join(" ") || undefined}
                aria-pressed={mcpProvider === provider.id}
                onClick={() => setMcpProvider(provider.id)}
                title={missing ? `${provider.command} CLI not found` : provider.command}
              >
                {provider.displayName}
                {count > 0 && <span className="dk-tab-count"> {count}</span>}
              </button>
            );
          })}
        </div>
        <span className="dk-spacer" />
        <span className="dk-hint">
          {mcpConnectedCount} live · {mcpServers.length} configured
        </span>
        <button type="button" className="dk-btn dk-btn--sm" onClick={onAdd} disabled={!activeProjectId || mcpState?.installed === false}>
          <Plus size={14} />
          Add server
        </button>
      </div>

      {mcpLoading && !mcpState ? (
        <p className="dk-empty dk-card">Checking {providerLabel(mcpProvider)} MCP servers…</p>
      ) : mcpState && !mcpState.installed ? (
        <p className="dk-empty dk-card">
          <strong>{providerCommand(mcpProvider)} CLI not found</strong>
          Install it to manage MCP servers for {providerLabel(mcpProvider)}.
        </p>
      ) : mcpState && !mcpState.supported ? (
        <p className="dk-empty dk-card">
          <strong>No MCP support</strong>
          {mcpState.message || `${providerCommand(mcpProvider)} does not expose an mcp command.`}
        </p>
      ) : mcpServers.length === 0 ? (
        <p className="dk-empty dk-card">
          <strong>No servers yet</strong>
          Add one to make it available in {providerLabel(mcpProvider)} sessions.
        </p>
      ) : (
        <div className="dk-list">
          {mcpServers.map((server) => {
            const authProfile = mcpState?.authProfiles?.find((profile) => profile.name === server.name);
            const supportsProjectAuth = ["claude", "codex", "kimi"].includes(mcpProvider) && /http|sse/i.test(server.transport);
            return (
              <div className="dk-list-row" key={`${mcpProvider}-${server.name}`} aria-label={`${mcpTaskSourceLabel(server.name)}, ${mcpStatusLabel[server.status] ?? server.statusText}`}>
                <span className={`dk-dot ${mcpStatusTone[server.status] ?? "is-idle"}`} aria-hidden="true" />
                <span className="dk-row-main">
                  <span className="dk-row-title">{mcpTaskSourceLabel(server.name)}</span>
                  <span className="dk-row-sub" title={server.target}>
                    <code className="dk-mono">{server.name}</code>{server.transport ? ` · ${server.transport}` : ""} · {server.target}
                  </span>
                </span>
                {authProfile?.authenticatedAt ? (
                  <span className="dk-badge dk-badge--accent">Project auth</span>
                ) : (
                  <span className={`dk-status ${mcpStatusText[server.status] ?? ""}`}>
                    {mcpStatusLabel[server.status] ?? server.statusText}
                  </span>
                )}
                {supportsProjectAuth ? (
                  <button
                    type="button"
                    className={`dk-icon-btn dk-icon-btn--sm${authProfile?.authenticatedAt ? " is-current" : ""}`}
                    title={`Project authentication for ${server.name}`}
                    aria-label={`Project authentication for ${server.name}`}
                    onClick={() => onAuth(server)}
                    disabled={mcpAuthBusy === server.name}
                  >
                    <KeyRound size={13} />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="dk-icon-btn dk-icon-btn--sm"
                  title={`Remove ${server.name}`}
                  aria-label={`Remove ${server.name}`}
                  onClick={() => onRemove(server)}
                  disabled={mcpBusy === server.name}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {mcpNotice && <p className={`dk-notice is-${mcpNoticeTone}`} role="status">{mcpNotice}</p>}

      <div className="dk-toolbar">
        <span className="dk-hint">Live status from {providerLabel(mcpProvider)} CLI</span>
        <span className="dk-spacer" />
        <button type="button" className="dk-btn dk-btn--sm dk-btn--ghost" onClick={() => onRefresh(mcpProvider)} disabled={mcpLoading}>
          <RefreshCw size={13} className={mcpLoading ? "dk-spin" : undefined} />
          Recheck
        </button>
        <button type="button" className="dk-btn dk-btn--sm" onClick={() => onUseInSession(mcpProvider)} disabled={!activeProjectId}>
          <Terminal size={13} />
          Use in session
        </button>
      </div>
    </div>
  );
}
