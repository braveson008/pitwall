import { Check, Loader2, RefreshCw, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getProviderById } from "../domain/providers";
import { ExtensionDetails, type DetailsSubject } from "./ExtensionDetails";
import { useAgentExtensions } from "../hooks/useAgentExtensions";
import {
  EXTENSION_TABS,
  formatInstalls,
  formatTokens,
  matchesQuery,
  skillInstallNote,
  type ExtensionTab,
} from "../lib/agentExtensions";

/**
 * What each agent can be given, and giving it.
 *
 * Every agent Pitwall runs has its own catalogue of plugins, its own idea of
 * where they come from, and its own command for installing one — and all of it
 * lived in a terminal. Pitwall already runs the agents; it should be able to
 * say what they can do.
 *
 * Three tabs, because those are the three things people go looking for, but
 * only one of them is a unit of installation: skills and MCP servers both ship
 * *inside* plugins. Rather than hide that, every skill and server row names the
 * plugin it would bring, and installing from those tabs installs that plugin.
 * The alternative — a Skills tab whose install button quietly pulls in eleven
 * other skills — is the kind of thing that makes people stop trusting a screen.
 *
 * Everything goes through the agent's own CLI, for the same reason every model
 * path does: Pitwall holds no credentials and must not end up with a second,
 * divergent idea of what is installed.
 */

/** Which agents have a plugin system Pitwall can drive. */
const EXTENSION_PROVIDERS = ["claude", "codex"] as const;

export function ExtensionsPanel({
  initialProvider,
  onAddCustomMcp,
  track,
}: {
  /** Which agent to open on, when Connections sent you here about one. */
  initialProvider?: string;
  onAddCustomMcp?: (provider: string) => void;
  track?: (event: string, properties?: Record<string, string | number | boolean>) => void;
}) {
  const {
    provider,
    setProvider,
    tab,
    setTab,
    query,
    setQuery,
    current,
    rows,
    counts,
    loading,
    busyPlugin,
    registry,
    registryError,
    registryLoading,
    busyServer,
    installServer,
    notice,
    dismissNotice,
    refresh,
    change,
  } = useAgentExtensions(EXTENSION_PROVIDERS, initialProvider, track);

  // The list rows stay shallow so several hundred of them remain scannable;
  // everything worth knowing before installing lives here instead.
  const [details, setDetails] = useState<DetailsSubject | null>(null);

  /**
   * A new tab starts at the top.
   *
   * The list keeps its scroll position when the content under it is replaced,
   * so switching from four hundred plugins to two thousand skills left you
   * halfway down a list you had never seen — reading the middle of something
   * as though it were the start.
   */
  const bodyRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [tab, provider, query]);

  /** Opens the plugin behind a skill or a bundled server. */
  const openPlugin = (pluginId: string) => {
    const plugin = current?.plugins.find((item) => item.pluginId === pluginId);
    if (plugin) setDetails({ kind: "plugin", plugin });
  };

  // Only the MCP tab actually goes anywhere to search; plugins and skills are
  // filtered in memory and answer instantly, so a spinner there would be a lie.
  const searching = tab === "mcp" && registryLoading;

  const tabCount = (id: ExtensionTab) =>
    id === "plugins" ? counts.plugins : id === "skills" ? counts.skills : registry.length || counts.mcp;

  const providerName = getProviderById(provider)?.displayName ?? provider;

  return (
    <section className="dk-page dk-page--narrow" ref={bodyRef}>
      <div className="dk-ext-head">
        <div className="dk-toolbar">
          <div className="dk-segmented" role="group" aria-label="Agent">
            {EXTENSION_PROVIDERS.map((id) => (
              <button
                key={id}
                type="button"
                className={provider === id ? "is-current" : undefined}
                aria-pressed={provider === id}
                onClick={() => setProvider(id)}
              >
                {getProviderById(id)?.displayName ?? id}
              </button>
            ))}
          </div>

          <span className="dk-spacer" />

          <label className="dk-search dk-ext-search">
            {searching ? (
              <Loader2 size={14} className="dk-spin" aria-hidden="true" />
            ) : (
              <Search size={14} aria-hidden="true" />
            )}
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                tab === "plugins"
                  ? "Search plugins"
                  : tab === "skills"
                    ? "Search skills — by what it does, or by its plugin"
                    : "Search MCP servers"
              }
              aria-label="Search the catalogue"
            />
            {query ? (
              <button
                type="button"
                className="dk-icon-btn dk-icon-btn--sm"
                onClick={() => setQuery("")}
                title="Clear the search"
                aria-label="Clear the search"
              >
                <X size={12} />
              </button>
            ) : null}
          </label>

          <button
            type="button"
            className="dk-btn dk-btn--sm dk-btn--ghost"
            onClick={() => void refresh()}
            disabled={loading}
            title="Ask the CLI again — it reaches every configured marketplace, so this is not instant"
          >
            <RefreshCw size={13} className={loading ? "dk-spin" : undefined} />
            {loading ? "Fetching" : "Refresh"}
          </button>
        </div>

        <div className="dk-subtabs" role="tablist">
          {EXTENSION_TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={tab === item.id ? "is-current" : undefined}
              onClick={() => setTab(item.id)}
            >
              {item.label}
              {tabCount(item.id) > 0 ? <span className="dk-tab-count"> {tabCount(item.id)}</span> : null}
            </button>
          ))}
          {counts.installed > 0 ? (
            <span className="dk-subtabs-aside">{counts.installed} installed</span>
          ) : null}
        </div>
      </div>

      {notice ? (
        <p className={`dk-notice is-${notice.tone}`} role="status">
          {notice.text}
          <button type="button" className="dk-icon-btn dk-icon-btn--sm" onClick={dismissNotice} aria-label="Dismiss">
            <X size={12} />
          </button>
        </p>
      ) : null}

      {tab === "mcp" ? (
        <McpCatalogue
          onOpen={(server) => setDetails({ kind: "server", server })}
          onOpenPlugin={openPlugin}
          onClearQuery={() => setQuery("")}
          servers={registry}
          fromPlugins={current?.mcpServers ?? []}
          loading={registryLoading}
          error={registryError}
          query={query}
          busyServer={busyServer}
          provider={provider}
          onInstall={installServer}
          onInstallPlugin={(pluginId) => change(pluginId, "install")}
          busyPlugin={busyPlugin}
          onAddCustom={onAddCustomMcp}
        />
      ) : (
        <Body
          onOpen={(plugin) => setDetails({ kind: "plugin", plugin })}
          onOpenPlugin={openPlugin}
          onClearQuery={() => setQuery("")}
          loading={loading}
          current={current}
          tab={tab}
          rows={rows as Array<AgentPlugin | AgentSkill>}
          query={query}
          providerName={providerName}
          busyPlugin={busyPlugin}
          onChange={change}
        />
      )}

      {details ? (
        <ExtensionDetails
          subject={details}
          provider={providerName}
          busy={
            details.kind === "plugin" ? busyPlugin === details.plugin.pluginId : busyServer === details.server.id
          }
          onClose={() => setDetails(null)}
          onInstall={() => {
            if (details.kind === "plugin") change(details.plugin.pluginId, "install");
            else void installServer(details.server);
            setDetails(null);
          }}
          onRemove={
            details.kind === "plugin"
              ? () => {
                  change(details.plugin.pluginId, "remove");
                  setDetails(null);
                }
              : undefined
          }
        />
      ) : null}
    </section>
  );
}

function Body({
  onOpen,
  onOpenPlugin,
  onClearQuery,
  loading,
  current,
  tab,
  rows,
  query,
  providerName,
  busyPlugin,
  onChange,
}: {
  onOpen: (plugin: AgentPlugin) => void;
  /** A skill is not installable alone, so its row opens the plugin behind it. */
  onOpenPlugin: (pluginId: string) => void;
  onClearQuery?: () => void;
  loading: boolean;
  current: AgentExtensions | null;
  tab: Exclude<ExtensionTab, "mcp">;
  rows: Array<AgentPlugin | AgentSkill>;
  query: string;
  providerName: string;
  busyPlugin: string;
  onChange: (pluginId: string, action: "install" | "remove") => void;
}) {
  if (loading && !current) {
    return (
      <p className="dk-empty">
        <Loader2 size={15} className="dk-spin" />
        Asking the CLI what it can install — it reaches every marketplace, so give it a moment.
      </p>
    );
  }

  if (current && !current.installed) {
    return <p className="dk-empty">{current.message || "That agent's CLI is not installed."}</p>;
  }

  if (current && !current.supported) {
    return <p className="dk-empty">{current.message || "That agent has no plugin system Pitwall can drive."}</p>;
  }

  if (current?.error) {
    return <p className="dk-empty dk-error">{current.error}</p>;
  }

  if (rows.length === 0) {
    return (
      <p className="dk-empty">
        {query ? `Nothing here matches “${query}”.` : "This agent's marketplaces list nothing here."}
        {/* The search carries across tabs on purpose — you may well want the
            same word in each — but landing on an empty one needs a way out
            that is not "delete what you typed and work out why". */}
        {query && onClearQuery ? (
          <button type="button" className="dk-link" onClick={onClearQuery}>
            Clear the search
          </button>
        ) : null}
      </p>
    );
  }

  const renderRow = (row: AgentPlugin | AgentSkill) =>
    tab === "plugins" ? (
      <PluginRow
        key={(row as AgentPlugin).pluginId}
        plugin={row as AgentPlugin}
        busy={busyPlugin === (row as AgentPlugin).pluginId}
        onChange={onChange}
        onOpen={() => onOpen(row as AgentPlugin)}
      />
    ) : (
      <SkillRow
        key={`${(row as AgentSkill).pluginId}:${row.name}`}
        skill={row as AgentSkill}
        busy={busyPlugin === (row as AgentSkill).pluginId}
        onChange={onChange}
        onOpen={() => onOpenPlugin((row as AgentSkill).pluginId)}
      />
    );

  // The MCP tab is its own catalogue; this renders the other two.
  const installed = rows.filter((row) => row.installed);
  const available = rows.filter((row) => !row.installed);

  return (
    <>
      {installed.length > 0 ? (
        <ExtensionSection title={`Installed for ${providerName}`}>{installed.map(renderRow)}</ExtensionSection>
      ) : null}
      {available.length > 0 ? (
        <ExtensionSection title="Available">{available.map(renderRow)}</ExtensionSection>
      ) : null}
    </>
  );
}

function ExtensionSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="dk-section">
      <h2 className="dk-section-title dk-ext-group">{title}</h2>
      <ul className="dk-list dk-ext-list">{children}</ul>
    </section>
  );
}

/**
 * MCP servers you can browse and press Install on.
 *
 * This tab used to list only the servers that happened to arrive inside a
 * plugin. Everything else meant the Add server form: a name, a transport, a
 * command, its arguments, and its environment — reasonable for someone who
 * already knows they want `npx -y @playwright/mcp`, and no help at all to
 * anyone looking to find out what exists.
 *
 * The public registry publishes what each server needs in order to run, so the
 * command can be built rather than typed. The form is still here for anything
 * unpublished, which is where it belongs: the exception, not the front door.
 */
function McpCatalogue({
  onOpen,
  onOpenPlugin,
  onClearQuery,
  servers,
  fromPlugins,
  loading,
  error,
  query,
  busyServer,
  provider,
  onInstall,
  onInstallPlugin,
  busyPlugin,
  onAddCustom,
}: {
  onOpen: (server: RegistryMcpServer) => void;
  onOpenPlugin: (pluginId: string) => void;
  onClearQuery?: () => void;
  servers: RegistryMcpServer[];
  fromPlugins: AgentPluginMcp[];
  loading: boolean;
  error: string;
  query: string;
  busyServer: string;
  provider: string;
  onInstall: (entry: RegistryMcpServer) => void;
  onInstallPlugin: (pluginId: string) => void;
  busyPlugin: string;
  onAddCustom?: (provider: string) => void;
}) {
  const bundled = fromPlugins.filter((server) => matchesQuery(server, query));

  return (
    <>
      {error ? (
        <p className="dk-empty">
          <span className="dk-error">{error} You can still add a server by hand.</span>
          {onAddCustom ? (
            <button type="button" className="dk-link" onClick={() => onAddCustom(provider)}>
              Add one
            </button>
          ) : null}
        </p>
      ) : null}

      {loading && servers.length === 0 ? (
        <p className="dk-empty">
          <Loader2 size={15} className="dk-spin" />
          Searching the MCP registry…
        </p>
      ) : null}

      {servers.length > 0 ? (
        <ExtensionSection title="From the MCP registry">
          {servers.map((entry) => (
            <ExtensionRow
              key={entry.id}
              name={entry.title}
              origin={entry.publisher || "unpublished"}
              badges={
                <>
                  <span className="dk-badge">{entry.launch?.kind === "remote" ? "Hosted" : "Runs locally"}</span>
                  {entry.needsEnv ? <span className="dk-badge dk-badge--amber">Needs a key</span> : null}
                </>
              }
              description={entry.description}
              meta={[
                typeof entry.weeklyDownloads === "number"
                  ? {
                      text: `${formatInstalls(entry.weeklyDownloads)}/wk`,
                      title: "Weekly npm downloads — the registry publishes no popularity data of its own",
                    }
                  : null,
                entry.version ? { text: `v${entry.version}` } : null,
              ]}
              action={
                entry.installable ? (
                  <button
                    type="button"
                    className="dk-btn dk-btn--sm"
                    disabled={busyServer === entry.id}
                    onClick={() => onInstall(entry)}
                    title={`Add ${entry.name} to ${provider}`}
                  >
                    {busyServer === entry.id ? <Loader2 size={12} className="dk-spin" /> : null}
                    {busyServer === entry.id ? "Adding" : "Install"}
                  </button>
                ) : (
                  <span className="dk-hint">Needs Docker</span>
                )
              }
              onOpen={() => onOpen(entry)}
            />
          ))}
        </ExtensionSection>
      ) : null}

      {bundled.length > 0 ? (
        <ExtensionSection title="Also available inside plugins">
          {bundled.map((server) => (
            <McpRow
              key={`${server.pluginId}:${server.name}`}
              server={server}
              busy={busyPlugin === server.pluginId}
              onChange={(action) => (action === "install" ? onInstallPlugin(server.pluginId) : undefined)}
              onOpen={() => onOpenPlugin(server.pluginId)}
            />
          ))}
        </ExtensionSection>
      ) : null}

      {!loading && !error && servers.length === 0 && bundled.length === 0 ? (
        <p className="dk-empty">
          {query ? `The registry has nothing matching “${query}”.` : "The MCP registry returned nothing."}
          {query && onClearQuery ? (
            <button type="button" className="dk-link" onClick={onClearQuery}>
              Clear the search
            </button>
          ) : null}
        </p>
      ) : null}

      {onAddCustom ? (
        <p className="dk-hint dk-ext-custom">
          Not listed? <button type="button" className="dk-link" onClick={() => onAddCustom(provider)}>Add a server by hand</button>
        </p>
      ) : null}
    </>
  );
}

/**
 * One thing in the catalogue, however it got there.
 *
 * Every kind shares one row shape so they can be compared, which is the only
 * thing a catalogue is for: the name and where it comes from, one line of
 * description, the facts as badges, and the action in the same place on every
 * row.
 */
function ExtensionRow({
  name,
  origin,
  badges,
  description,
  meta,
  action,
  onOpen,
}: {
  name: string;
  origin: string;
  badges?: React.ReactNode;
  description: string;
  meta: Array<{ text: string; title?: string } | null>;
  action: React.ReactNode;
  onOpen: () => void;
}) {
  return (
    <li className="dk-list-row">
      {/* The row opens the detail; only the button installs. Reading about
          something must never be the same gesture as installing it. */}
      <button type="button" className="dk-ext-open" onClick={onOpen} title={`Open details for ${name}`}>
        <span className="dk-ext-name">
          <span className="dk-row-title">{name}</span>
          <span className="dk-ext-origin">
            {origin}
            {meta.filter(Boolean).map((item) => (
              <span key={item!.text} title={item!.title}> · {item!.text}</span>
            ))}
          </span>
        </span>
        <span className="dk-ext-desc">{description || "No description published."}</span>
      </button>
      <span className="dk-badges">{badges}</span>
      <span className="dk-ext-action">{action}</span>
    </li>
  );
}

const installedBadge = (
  <span className="dk-badge dk-badge--green">
    <Check size={10} />
    Installed
  </span>
);

function PluginRow({
  plugin,
  busy,
  onChange,
  onOpen,
}: {
  plugin: AgentPlugin;
  busy: boolean;
  onChange: (pluginId: string, action: "install" | "remove") => void;
  onOpen: () => void;
}) {
  const skills = plugin.components?.skills?.length ?? 0;
  const servers = plugin.components?.mcpServers?.length ?? 0;

  return (
    <ExtensionRow
      name={plugin.name}
      origin={plugin.author || plugin.marketplace}
      badges={
        <>
          {plugin.installed ? installedBadge : null}
          {plugin.needsAuth ? <span className="dk-badge">Signs you in</span> : null}
        </>
      }
      description={plugin.description}
      meta={[
        formatInstalls(plugin.installs) ? { text: `${formatInstalls(plugin.installs)} installs` } : null,
        skills > 0 ? { text: `${skills} skill${skills === 1 ? "" : "s"}` } : null,
        servers > 0 ? { text: `${servers} MCP` } : null,
        // The number that decides whether a plugin is worth having: paid on
        // every session, whether or not it is used.
        formatTokens(plugin.tokens?.alwaysOn)
          ? { text: `${formatTokens(plugin.tokens?.alwaysOn)} tok`, title: "Added to every session, used or not" }
          : null,
      ]}
      action={
        <Action
          installed={plugin.installed}
          installable={plugin.installable !== false}
          busy={busy}
          onChange={(action) => onChange(plugin.pluginId, action)}
        />
      }
      onOpen={onOpen}
    />
  );
}

function SkillRow({
  skill,
  busy,
  onChange,
  onOpen,
}: {
  skill: AgentSkill;
  busy: boolean;
  onChange: (pluginId: string, action: "install" | "remove") => void;
  onOpen: () => void;
}) {
  return (
    <ExtensionRow
      name={skill.name}
      origin={skill.marketplace}
      badges={skill.installed ? installedBadge : null}
      // Said outright, because a skill is not a unit of installation and
      // pretending otherwise is how someone ends up with eleven they did not
      // ask for.
      description={skillInstallNote(skill)}
      meta={[
        formatTokens(skill.alwaysOn)
          ? { text: `${formatTokens(skill.alwaysOn)} tok`, title: "Added to every session, used or not" }
          : null,
        formatTokens(skill.onInvoke)
          ? { text: `${formatTokens(skill.onInvoke)} on use`, title: "Paid each time the skill actually runs" }
          : null,
      ]}
      action={
        <Action installed={skill.installed} installable busy={busy} onChange={(action) => onChange(skill.pluginId, action)} />
      }
      onOpen={onOpen}
    />
  );
}

function McpRow({
  server,
  busy,
  onChange,
  onOpen,
}: {
  server: AgentPluginMcp;
  busy: boolean;
  onChange: (action: "install" | "remove") => void;
  onOpen: () => void;
}) {
  return (
    <ExtensionRow
      name={server.name}
      origin={server.marketplace}
      badges={
        <>
          {server.installed ? installedBadge : null}
          <span className="dk-badge">In a plugin</span>
        </>
      }
      description={`Comes with the ${server.pluginName} plugin.`}
      meta={[]}
      action={<Action installed={server.installed} installable busy={busy} onChange={onChange} />}
      onOpen={onOpen}
    />
  );
}

function Action({
  installed,
  installable,
  busy,
  onChange,
}: {
  installed: boolean;
  installable: boolean;
  busy: boolean;
  onChange: (action: "install" | "remove") => void;
}) {
  if (!installable && !installed) {
    return <span className="dk-hint">Not installable from here</span>;
  }

  return (
    <button
      type="button"
      className={`dk-btn dk-btn--sm${installed ? " dk-ext-remove" : ""}`}
      disabled={busy}
      onClick={() => onChange(installed ? "remove" : "install")}
      title={installed ? "Remove it from this agent" : "Install it for this agent"}
    >
      {busy ? <Loader2 size={12} className="dk-spin" /> : null}
      {busy ? "Working" : installed ? "Remove" : "Install"}
    </button>
  );
}
