import { Github, KeyRound, Plus, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { CatalogueEntry } from "../domain/agentCatalogue";
import { AgentMarketplace, type LiveModels } from "./AgentMarketplace";
import { providerRegistry, type ProviderDefinition } from "../domain/providers";
import type { AgentProvider } from "../data";
import type { PitwallProviderId } from "../domain/types";

/** How the screen names a project's code host. */
export interface RepositoryHostWords {
  kind: "github" | "gitlab";
  label: string;
  requestNoun: string;
}

export const GITHUB_WORDS: RepositoryHostWords = { kind: "github", label: "GitHub", requestNoun: "pull request" };

type ProviderConnection = {
  agent: AgentProvider;
  installed: boolean;
  authenticated: boolean | null;
  status: "ready" | "missing" | "needs-login" | "unknown";
  version: string | null;
  completionMode: "native" | "fallback" | "unavailable";
  completionEvent: string | null;
  completionMessage: string;
  projectMcpAuth: "isolated" | "provider-managed" | "none";
};

interface ConnectionsPanelProps {
  /** Anonymous usage counts: on unless turned off here. */
  usageReporting?: { enabled: boolean; onChange: (enabled: boolean) => void };
  projectName: string;
  githubLogin: string | null;
  checks: Partial<Record<string, ProviderConnection>>;
  mcpByProvider: Partial<Record<PitwallProviderId, McpListResult>>;
  focusedProvider: PitwallProviderId | null;
  refreshing: boolean;
  /** Opens the add-agent flow. Connections is where you come to see which
      agents you have, so it is where adding one belongs. */
  onAddAgent?: () => void;
  /** Offers to install a CLI that is missing. Shown only where Pitwall knows
      a confirmed command; the plan itself is decided in the main process. */
  onInstall?: (providerId: string) => void;
  /** Off on the app-level screen, where no one project is in view. */
  showRepositoryIdentity?: boolean;
  /** The service the project's code lives on; null when Pitwall holds no account there. */
  repositoryHost?: RepositoryHostWords | null;
  /** Agent CLIs and runtimes Pitwall knows how to install but does not drive. */
  catalogue?: CatalogueEntry[];
  /** Which catalogue commands are already on the PATH. */
  installedCommands?: Record<string, boolean>;
  onInstallCatalogue?: (entry: CatalogueEntry) => void;
  /** Models each installed CLI reported when asked, keyed by its binary. */
  liveModels?: LiveModels;
  /**
   * Binaries Pitwall can start a session with. Installing a catalogue agent
   * does not make it drivable — that still goes through Add agent — and a
   * marketplace that does not say so sets somebody up to be surprised.
   */
  drivableCommands?: Set<string>;
  /** Models Ollama has pulled, for the "what do I need" panel. */
  localModelCount?: number;
  /** Registers a local model as an agent, once one has something to drive it. */
  onAgentReady?: (agent: {
    name: string; command: string; args: string; models: string; modelDiscoveryCommand: string; login: string;
  }) => void;
  embedded?: boolean;
  onClose?: () => void;
  onGitHub: () => void;
  onProvider: (provider: PitwallProviderId) => void;
  onMcp: (provider: PitwallProviderId) => void;
  onBrowseExtensions?: (provider: PitwallProviderId) => void;
  onRefresh: () => void;
}

export function ConnectionsPanel({
  usageReporting,
  projectName,
  githubLogin,
  checks,
  mcpByProvider,
  focusedProvider,
  refreshing,
  onAddAgent,
  onInstall,
  showRepositoryIdentity = true,
  repositoryHost = GITHUB_WORDS,
  catalogue = [],
  installedCommands = {},
  onInstallCatalogue,
  liveModels = {},
  drivableCommands = new Set<string>(),
  localModelCount = 0,
  onAgentReady,
  embedded = false,
  onClose,
  onGitHub,
  onProvider,
  onMcp,
  onBrowseExtensions,
  onRefresh,
}: ConnectionsPanelProps) {
  const [diagnosing, setDiagnosing] = useState<PitwallProviderId | null>(null);
  const idPrefix = `connection-${embedded ? "page-" : ""}`;

  useEffect(() => {
    if (!focusedProvider) return;
    document.getElementById(`${idPrefix}${focusedProvider}`)?.scrollIntoView({ block: "nearest" });
  }, [idPrefix, focusedProvider]);

  const isReady = (provider: ProviderDefinition) => {
    const check = checks[provider.agent];
    return Boolean(check?.installed && check.status !== "needs-login");
  };
  // Installed only — but only where the catalogue is also on screen. An agent
  // you do not have is something you could install rather than a connection,
  // and it belongs in the list of things you could install. Hiding it in the
  // dialog, which has no catalogue, would remove the only way to install it.
  const listed = providerRegistry.filter((provider) => catalogue.length === 0 || checks[provider.agent]?.installed);
  const ready = providerRegistry.filter(isReady);

  const refreshButton = (
    <button
      type="button"
      className="dk-icon-btn"
      onClick={onRefresh}
      disabled={refreshing}
      title="Recheck installed providers"
      aria-label="Recheck installed providers"
    >
      <RefreshCw size={15} className={refreshing ? "dk-spin" : undefined} />
    </button>
  );

  const content = (
    <>
      <section className="dk-section" aria-labelledby={`${idPrefix}agents-heading`}>
        <div className="dk-section-head">
          <div>
            <h2 className="dk-section-title" id={`${idPrefix}agents-heading`}>Agents</h2>
            {/* Says which sense of "agent" this page means. Pitwall calls the
                command-line tools agents, and so does everyone who writes about
                them — but the same word is also used for the personas a CLI runs
                under, and a page called Agents that lists neither of those
                explicitly leaves you to work out which one it is. */}
            <p className="dk-section-desc">
              The command-line tools Pitwall can drive. Skills, plugins and sub-agents live in Extensions.
            </p>
          </div>
          {embedded ? refreshButton : null}
          {onAddAgent ? (
            <button type="button" className="dk-btn dk-btn--sm" onClick={onAddAgent}>
              <Plus size={14} />
              Add agent
            </button>
          ) : null}
        </div>

        {listed.length > 0 ? (
          <div className="dk-list">
            {listed.map((provider) => {
              const check = checks[provider.agent];
              const providerReady = isReady(provider);
              const completion = check?.completionMode ?? "unavailable";
              const open = diagnosing === provider.id;
              const tone = !check ? "" : !check.installed ? "is-idle" : check.status === "needs-login" ? "is-needs" : "is-ready";
              return (
                <div
                  id={`${idPrefix}${provider.id}`}
                  className={`dk-list-row dk-agent-row${focusedProvider === provider.id ? " is-focused" : ""}`}
                  key={provider.id}
                >
                  <span className="dk-tile" aria-hidden="true">{provider.icon}</span>
                  <span className="dk-row-main">
                    <span className="dk-row-title">{provider.displayName}</span>
                    <span className="dk-row-sub dk-mono">
                      {provider.command}
                      {check?.version ? ` · v${check.version}` : ""}
                    </span>
                  </span>

                  <span className={`dk-status${tone === "is-needs" ? " is-needs" : ""}`}>
                    {tone ? <span className={`dk-dot ${tone}`} aria-hidden="true" /> : null}
                    {!check ? "Checking"
                      : !check.installed ? "Not installed"
                        : check.status === "needs-login" ? "Needs sign-in"
                          : check.authenticated === null ? "Installed" : "Signed in"}
                  </span>

                  {providerReady ? (
                    <button type="button" className="dk-btn dk-btn--sm" onClick={() => onProvider(provider.id)}>
                      Open CLI
                    </button>
                  ) : check?.installed ? (
                    // Signing in happens inside the CLI; opening it is how you get there.
                    <button type="button" className="dk-btn dk-btn--sm" onClick={() => onProvider(provider.id)}>
                      Sign in
                    </button>
                  ) : check && onInstall ? (
                    <button type="button" className="dk-btn dk-btn--sm" onClick={() => onInstall(provider.id)}>
                      Install
                    </button>
                  ) : null}

                  {/* Auth mode and completion signal are the two things you look
                      up when something is wrong, and never otherwise. */}
                  <button
                    type="button"
                    className={`dk-icon-btn dk-icon-btn--sm${open ? " is-current" : ""}`}
                    aria-expanded={open}
                    aria-label={`Diagnostics for ${provider.displayName}`}
                    title={check?.completionMessage}
                    onClick={() => setDiagnosing(open ? null : provider.id)}
                  >
                    <ShieldCheck size={13} />
                  </button>

                  {open ? (
                    <div className="dk-agent-diag">
                      <p>
                        {completion === "native" ? check?.completionEvent || "Native completion"
                          : completion === "fallback" ? "Fallback completion" : "Completion unavailable"}
                        {" — "}
                        {check?.completionMessage || "Install and authenticate the provider to enable completion signals."}
                      </p>
                      {providerReady ? (
                        <p>
                          {check?.projectMcpAuth === "isolated" ? "Project-isolated auth"
                            : check?.projectMcpAuth === "provider-managed" ? "Provider-managed auth"
                              : "No project auth"}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="dk-empty dk-card">
            <strong>No agent CLIs are installed yet</strong>
            Install one below and Pitwall can start sessions with it.
          </p>
        )}
      </section>

      {/* Which GitHub account a repository is pushed as is a property of that
          repository, so it belongs to a project and not to the app-wide page.
          There it is on the project's Overview, with the branch and the path. */}
      {showRepositoryIdentity && repositoryHost ? (
        <section className="dk-section" aria-labelledby={`${idPrefix}github-heading`}>
          <div className="dk-section-head">
            <div>
              <h2 className="dk-section-title" id={`${idPrefix}github-heading`}>{repositoryHost.label}</h2>
              <p className="dk-section-desc">The account this project pushes and opens {repositoryHost.requestNoun}s as.</p>
            </div>
          </div>
          <div className="dk-list">
            <div className="dk-list-row">
              <span className="dk-tile" aria-hidden="true">{repositoryHost.kind === "github" ? <Github size={15} /> : <KeyRound size={15} />}</span>
              <span className="dk-row-main">
                <span className="dk-row-title">{repositoryHost.label} repository identity</span>
                <span className="dk-row-sub">
                  {githubLogin ? `@${githubLogin} is selected for this project` : "No project account selected"}
                </span>
              </span>
              <button type="button" className="dk-btn dk-btn--sm" onClick={onGitHub}>
                {githubLogin ? "Manage" : "Connect"}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {ready.length > 0 ? (
        <section className="dk-section" aria-labelledby={`${idPrefix}mcp-heading`}>
          <div className="dk-section-head">
            <div>
              <h2 className="dk-section-title" id={`${idPrefix}mcp-heading`}>MCP servers</h2>
              <p className="dk-section-desc">The tools each agent can reach, as its own CLI reports them.</p>
            </div>
          </div>
          <div className="dk-list">
            {ready.map((provider) => {
              const mcp = mcpByProvider[provider.id];
              const connected = mcp?.servers.filter((server) => server.status === "connected").length ?? 0;
              return (
                <div className="dk-list-row" key={provider.id}>
                  <span className="dk-tile" aria-hidden="true">{provider.icon}</span>
                  <span className="dk-row-main">
                    <span className="dk-row-title">{provider.displayName}</span>
                    <span className="dk-row-sub">
                      {mcp
                        ? `${mcp.servers.length} server${mcp.servers.length === 1 ? "" : "s"} · ${connected} connected`
                        : "Not checked yet"}
                    </span>
                  </span>
                  {onBrowseExtensions ? (
                    <button
                      type="button"
                      className="dk-btn dk-btn--sm dk-btn--ghost"
                      onClick={() => onBrowseExtensions(provider.id)}
                      title={`Find and install plugins, skills and MCP servers for ${provider.displayName}`}
                    >
                      Plugins &amp; skills
                    </button>
                  ) : null}
                  <button type="button" className="dk-btn dk-btn--sm" onClick={() => onMcp(provider.id)}>
                    {mcp ? "Manage" : "Check MCP"}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {usageReporting ? (
        <section className="dk-section" aria-labelledby={`${idPrefix}privacy-heading`}>
          <div className="dk-section-head">
            <div>
              <h2 className="dk-section-title" id={`${idPrefix}privacy-heading`}>Privacy</h2>
              <p className="dk-section-desc">
                Anonymous counts of which screens are used and whether sessions finish — never your code, file names, ticket titles or prompts.
              </p>
            </div>
          </div>
          <label className="dk-check">
            <input type="checkbox" checked={usageReporting.enabled} onChange={(event) => usageReporting.onChange(event.target.checked)} />
            Share anonymous usage counts
          </label>
        </section>
      ) : null}

      {catalogue.length > 0 ? (
        <AgentMarketplace
          installedCommands={installedCommands}
          liveModels={liveModels}
          drivableCommands={drivableCommands}
          localModelCount={localModelCount}
          extraEntries={providerRegistry
            .filter((provider) => !checks[provider.agent]?.installed)
            .map((provider) => ({
              id: provider.id,
              name: provider.displayName,
              kind: "agent" as const,
              summary: `${provider.displayName}'s own CLI. Pitwall drives it directly.`,
              command: provider.command,
              installCommand: provider.installCommand,
              ...(provider.installElsewhere ? { elsewhere: provider.installElsewhere } : {}),
              docs: provider.installDocs ?? "",
              access: "bring-your-own-key" as const,
              models: provider.supportedModels.map((model) => model.label),
            }))}
          onInstall={(entry) => onInstallCatalogue?.(entry)}
          onAgentReady={onAgentReady}
        />
      ) : null}
    </>
  );

  // The page header above already names this page, so the embedded form
  // starts with its content rather than a second title.
  if (embedded) {
    return (
      <div className="dk-page dk-page--narrow" role="region" aria-label="Agents and connections">
        {content}
      </div>
    );
  }

  return (
    <section
      className="dk-dialog dk-dialog--wide"
      role="dialog"
      aria-modal
      aria-labelledby="connections-title"
      onClick={(event) => event.stopPropagation()}
    >
      <header className="dk-dialog-header">
        <div>
          <h2 className="dk-dialog-title" id="connections-title">{projectName}</h2>
          <p className="dk-dialog-desc">Agents, MCP servers{repositoryHost ? ` and the ${repositoryHost.label} account` : ""} this project uses.</p>
        </div>
        {refreshButton}
        {onClose ? (
          <button type="button" className="dk-icon-btn" onClick={onClose} title="Close" aria-label="Close connections">
            <X size={16} />
          </button>
        ) : null}
      </header>
      <div className="dk-dialog-body">{content}</div>
    </section>
  );
}

export function ConnectionsModal({
  open,
  projectName,
  githubLogin,
  repositoryHost = GITHUB_WORDS,
  checks,
  mcpByProvider,
  focusedProvider,
  refreshing,
  onClose,
  onGitHub,
  onProvider,
  onMcp,
  onBrowseExtensions,
  onRefresh,
}: {
  open: boolean;
  projectName: string;
  githubLogin: string | null;
  repositoryHost?: RepositoryHostWords | null;
  checks: Partial<Record<string, ProviderConnection>>;
  mcpByProvider: Partial<Record<PitwallProviderId, McpListResult>>;
  focusedProvider: PitwallProviderId | null;
  refreshing: boolean;
  onClose: () => void;
  onGitHub: () => void;
  onProvider: (provider: PitwallProviderId) => void;
  onMcp: (provider: PitwallProviderId) => void;
  onBrowseExtensions?: (provider: PitwallProviderId) => void;
  onRefresh: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="dk-backdrop" onClick={onClose}>
      <ConnectionsPanel
        projectName={projectName}
        githubLogin={githubLogin}
        repositoryHost={repositoryHost}
        checks={checks}
        mcpByProvider={mcpByProvider}
        focusedProvider={focusedProvider}
        refreshing={refreshing}
        onClose={onClose}
        onGitHub={onGitHub}
        onProvider={onProvider}
        onMcp={onMcp}
        onBrowseExtensions={onBrowseExtensions}
        onRefresh={onRefresh}
      />
    </div>
  );
}
