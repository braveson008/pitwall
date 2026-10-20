import { useCallback, useEffect, useMemo, useState } from "react";
import { matchesQuery, type ExtensionTab } from "../lib/agentExtensions";

/**
 * What each agent can install, and installing it.
 *
 * One catalogue per agent, cached for as long as the app is open. Listing is
 * slow in a way nothing else in Pitwall is — the CLI reaches every configured
 * marketplace over the network, and Claude's catalogue is several hundred
 * plugins — so it is fetched when an agent is first opened and then only again
 * when something is installed or the user asks.
 */
export function useAgentExtensions(
  providers: readonly string[],
  initialProvider?: string,
  /** One anonymous count per install. Never which plugin. */
  track?: (event: string, properties?: Record<string, string | number | boolean>) => void,
) {
  const [provider, setProvider] = useState(
    initialProvider && providers.includes(initialProvider) ? initialProvider : providers[0] ?? "claude",
  );
  const [tab, setTab] = useState<ExtensionTab>("plugins");
  const [query, setQuery] = useState("");
  const [cache, setCache] = useState<Record<string, AgentExtensions>>({});
  const [loading, setLoading] = useState(false);
  const [busyPlugin, setBusyPlugin] = useState("");
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  // The MCP tab browses the public registry rather than only what plugins
  // happen to bring, so it has its own results and its own loading state.
  const [registry, setRegistry] = useState<RegistryMcpServer[]>([]);
  const [registryError, setRegistryError] = useState("");
  const [registryLoading, setRegistryLoading] = useState(false);
  const [busyServer, setBusyServer] = useState("");

  const refresh = useCallback(async (which: string) => {
    if (!window.braveli?.listAgentExtensions) return;
    setLoading(true);
    try {
      const result = await window.braveli.listAgentExtensions({ provider: which });
      setCache((current) => ({ ...current, [which]: result }));
    } catch (error) {
      setCache((current) => ({
        ...current,
        [which]: {
          ok: false,
          provider: which,
          installed: false,
          supported: false,
          plugins: [],
          skills: [],
          mcpServers: [],
          error: error instanceof Error ? error.message : String(error),
        },
      }));
    } finally {
      setLoading(false);
    }
  }, []);

  // Only on first open of an agent. Switching back to one already fetched shows
  // what it found rather than making the person wait through it again.
  useEffect(() => {
    if (!cache[provider]) void refresh(provider);
  }, [provider, cache, refresh]);

  const current = cache[provider] ?? null;

  /**
   * The registry, searched.
   *
   * Server-side: there are thousands of entries and the API filters far better
   * than shipping the lot to the renderer would. Debounced because it runs on
   * a keystroke.
   */
  useEffect(() => {
    const search = window.braveli?.searchMcpRegistry;
    if (tab !== "mcp" || !search) return;
    let cancelled = false;
    // Set before the debounce, not after it: the point of the indicator is to
    // say "your keystroke landed", and a spinner that appears 300ms later has
    // already missed the moment it was for.
    setRegistryLoading(true);
    const timer = window.setTimeout(() => {
      void search({ query })
        .then((result) => {
          if (cancelled) return;
          setRegistry(result?.servers ?? []);
          setRegistryError(result?.ok ? "" : result?.error || "The MCP registry could not be reached.");
        })
        .catch((error) => {
          if (!cancelled) setRegistryError(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          if (!cancelled) setRegistryLoading(false);
        });
    }, query ? 300 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [tab, query]);

  /** Installs one registry server into the agent currently shown. */
  const installServer = useCallback(
    async (entry: RegistryMcpServer) => {
      if (!window.braveli?.installMcpServer) return;
      setBusyServer(entry.id);
      setNotice(null);
      try {
        const result = await window.braveli.installMcpServer({ provider, entry });
        if (result?.ok) track?.("mcp_server_added", { provider });
        setNotice(
          result?.ok
            ? {
                tone: "success",
                text: entry.needsEnv
                  ? `Added ${entry.name}. It needs its keys set before it will connect.`
                  : `Added ${entry.name} to ${provider}.`,
              }
            : { tone: "error", text: result?.error || `Could not add ${entry.name}.` },
        );
      } finally {
        setBusyServer("");
      }
    },
    [provider],
  );

  const change = useCallback(
    async (pluginId: string, action: "install" | "remove") => {
      if (!window.braveli?.changeAgentExtension) return;
      setBusyPlugin(pluginId);
      setNotice(null);
      try {
        const result = await window.braveli.changeAgentExtension({ provider, pluginId, action });
        if (result?.ok) {
          if (action === "install") track?.("extension_installed", { kind: "plugin", provider });
          setNotice({
            tone: "success",
            text:
              action === "install"
                ? `Installed ${pluginId}. Agents started from now on will have it.`
                : `Removed ${pluginId}.`,
          });
          // The catalogue is now wrong about what is installed, and that is the
          // one column people look at.
          await refresh(provider);
        } else {
          setNotice({ tone: "error", text: result?.error || `Could not ${action} ${pluginId}.` });
        }
      } finally {
        setBusyPlugin("");
      }
    },
    [provider, refresh],
  );

  /**
   * The rows for the open tab, filtered.
   *
   * Filtering here rather than in each row keeps the empty state honest: "no
   * results" has to mean the search found nothing, not that the list is long
   * and the matches are below the fold.
   */
  const rows = useMemo(() => {
    if (!current) return [];
    const source = tab === "plugins" ? current.plugins : tab === "skills" ? current.skills : current.mcpServers;
    return source.filter((row) => matchesQuery(row, query));
  }, [current, tab, query]);

  /**
   * What each tab holds — filtered, once something is typed.
   *
   * Totals were misleading while a search was active: switching tabs with a
   * query in the box showed "Plugins 7" above an empty list, which reads as a
   * broken tab rather than as a search that found nothing here.
   */
  const counts = useMemo(() => {
    const plugins = (current?.plugins ?? []).filter((row) => matchesQuery(row, query));
    const skills = (current?.skills ?? []).filter((row) => matchesQuery(row, query));
    return {
      plugins: plugins.length,
      skills: skills.length,
      mcp: (current?.mcpServers ?? []).filter((row) => matchesQuery(row, query)).length,
      installed: (current?.plugins ?? []).filter((plugin) => plugin.installed).length,
    };
  }, [current, query]);

  return {
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
    dismissNotice: () => setNotice(null),
    refresh: () => refresh(provider),
    change,
  };
}
