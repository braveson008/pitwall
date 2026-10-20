import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Boxes,
  Code2,
  Cpu,
  GitBranch,
  Github,
  Search,
  Sparkles,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import { localCatalogue as agentCatalogue, type LocalCatalogueEntry as CatalogueEntry } from "../domain/agentCatalogue";
import { OllamaSetup } from "./OllamaSetup";

/** What an installed agent reports it can reach, asked of the CLI itself. */
export interface LiveModels {
  /** Keyed by the binary, so first-class providers and catalogue entries meet. */
  [command: string]: string[];
}

interface LiveFacts {
  version: string;
  downloads: string;
  activity: string;
  stale: boolean;
  publisherMatches: boolean | null;
}

type Sort = "popular" | "name" | "recent";


const SORTS: Array<{ id: Sort; label: string }> = [
  { id: "popular", label: "Most installed" },
  { id: "recent", label: "Recently updated" },
  { id: "name", label: "Name" },
];

/**
 * What each one costs you, said the way you would say it out loud.
 *
 * "Bring your own key" means nothing to somebody who has never held an API
 * key, and it is the most common label on this page.
 */
/**
 * The harnesses that can drive a local model.
 *
 * Kept in step with the main process's bridge list; a name here that is not
 * there would tell somebody they are finished when they are not.
 */
const LOCAL_HARNESSES = ["qwen", "opencode", "aider", "crush"];

/**
 * The three questions somebody actually has here, as places to go.
 *
 * The filter row this replaces — All, Installed, Agents, Runtimes, Open
 * source, No subscription — was seven ways to slice a list for somebody who
 * had not yet decided what they wanted. These are the decisions instead:
 * use what I pay for, run it free on this machine, or show me everything.
 */
type Tab = "signin" | "local" | "all";

const TABS: Array<{ id: Tab; label: string; hint: string }> = [
  { id: "signin", label: "Sign in and go", hint: "Use a model you already pay for" },
  { id: "local", label: "Run free on this computer", hint: "Open source, nothing leaves your machine" },
  { id: "all", label: "Everything", hint: "The full catalogue" },
];

/**
 * A mark for each agent: an icon for what it is, tinted per agent.
 *
 * Not vendor logos. Shipping those means bundling trademarks whose licences
 * differ per company, and a marketplace that is wrong about somebody's brand
 * is worse than one with no marks at all. These say what kind of thing each
 * one is — a terminal agent, a runtime, an editor assistant — which is what
 * somebody scanning the grid is actually sorting by.
 */
/* One word each. "Needs your own API key" repeated down nineteen rows is a
   sentence pretending to be a column; the reader is comparing, not reading. */
const ACCESS_LABEL: Record<CatalogueEntry["access"], string> = {
  "open-source": "Free",
  subscription: "Subscription",
  "bring-your-own-key": "API key",
};

/**
 * Browsing the agents, the way you browse models elsewhere.
 *
 * The obvious reference is a model catalogue, and it is the wrong shape for
 * Pitwall by one step: Pitwall routes to no model. Every model reaches it
 * through an agent's own CLI, and Pitwall holds no keys. A page listing the
 * world's models with their prices would be browsing things this app cannot
 * run, and clicking one could only ever say "install a CLI that supports it".
 *
 * So the browsing happens over the agents — which is what Pitwall actually
 * starts — and the models sit under whichever one you open. For an agent
 * that is installed those are the models its own CLI reported when asked;
 * for the rest they are the providers its documentation says it drives. The
 * first is a fact about your machine and the second is a claim about the
 * software, so they are never mixed silently: an installed agent's list says
 * where it came from.
 */
export function AgentMarketplace({
  installedCommands,
  liveModels,
  drivableCommands,
  extraEntries = [],
  localModelCount = 0,
  onInstall,
  onAgentReady,
}: {
  installedCommands: Record<string, boolean>;
  liveModels: LiveModels;
  /** Binaries Pitwall can start a session with, rather than merely install. */
  drivableCommands: Set<string>;
  /** Agents Pitwall ships support for that are not installed yet. */
  extraEntries?: CatalogueEntry[];
  /** How many models Ollama has pulled, for the "what do I need" panel. */
  localModelCount?: number;
  onInstall: (entry: CatalogueEntry) => void;
  /** Registers a local model as an agent Pitwall can start sessions with. */
  onAgentReady?: (agent: {
    name: string; command: string; args: string; models: string; modelDiscoveryCommand: string; login: string;
  }) => void;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("popular");
  const [tab, setTab] = useState<Tab>("signin");
  const [live, setLive] = useState<Record<string, LiveFacts>>({});

  // Asked of the registry rather than remembered. A hard-coded version is
  // wrong the week after it is written; this one is wrong only while the
  // network is down, and then it is simply absent.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const result = await window.braveli?.catalogueLive?.({
        entries: agentCatalogue.map((entry) => ({
          id: entry.id,
          installCommand: entry.installCommand,
          docs: entry.docs,
        })),
      });
      if (alive && result?.ok) setLive(result.live);
    })();
    return () => { alive = false; };
  }, []);

  // The first-class agents that are not installed belong here rather than in
  // the connections list: they are something you could have, which is what
  // this list is. They keep their mark, because Pitwall can drive them the
  // moment they exist.
  const listing = useMemo(() => [...extraEntries, ...agentCatalogue], [extraEntries]);

  /**
   * Where this machine actually stands, in the three parts that matter.
   *
   * Read from what is installed rather than described in general terms: the
   * question being answered is "what do I do next", and that depends on which
   * of these is missing.
   */
  const cloudReadyNames = listing
    .filter((entry) => drivableCommands.has(entry.command) && installedCommands[entry.command])
    .map((entry) => entry.name);
  const cloudReady = cloudReadyNames.length > 0;

  const localSteps = {
    ollama: Boolean(installedCommands.ollama),
    model: localModelCount > 0,
    // A harness is any agent that is not one of the provider CLIs — the tool
    // that does the reading and running, with the local model thinking.
    harness: LOCAL_HARNESSES.some((command) => installedCommands[command]),
  };
  const localReady = localSteps.ollama && localSteps.model && localSteps.harness;
  const localNextLabel = localSteps.ollama
    ? localSteps.model
      ? localSteps.harness
        ? ""
        : "install a harness — Qwen Code or OpenCode — so the model can read files and run commands."
      : "pull a model. Open Ollama below and choose one."
    : "install Ollama. It is the part that runs models on your machine.";

  const ollamaEntry = listing.find((entry) => entry.id === "ollama");
  const harnessEntries = LOCAL_HARNESSES
    .map((command) => listing.find((entry) => entry.command === command))
    .filter((entry): entry is CatalogueEntry => Boolean(entry) && Boolean(entry!.installCommand));

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = listing.filter((entry) => {
      // "Sign in and go" is exactly the set Pitwall can start a session with
      // as soon as it exists — no config, no harness, no key to paste.
      if (tab === "signin" && !drivableCommands.has(entry.command)) return false;
      if (!needle) return true;
      // Searching the models too: "ollama" should find every agent that can
      // drive it, not only Ollama itself.
      return [entry.name, entry.summary, entry.licence ?? "", ...entry.models]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });

    // Popularity where a figure exists, name where it does not — a package
    // with no download count sorting to the top would be an accident, not a
    // recommendation.
    const rank = (entry: CatalogueEntry) => {
      const raw = live[entry.id]?.downloads ?? "";
      const value = parseFloat(raw);
      if (!Number.isFinite(value)) return -1;
      return raw.endsWith("M") ? value * 1_000_000 : raw.endsWith("k") ? value * 1000 : value;
    };

    return [...matches].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "recent") return Number(Boolean(live[a.id]?.stale)) - Number(Boolean(live[b.id]?.stale));
      return rank(b) - rank(a);
    });
  }, [query, tab, sort, installedCommands, drivableCommands, live, listing]);

  return (
    <section className="dk-section" aria-labelledby="marketplace-heading">
      {/* The agents above are the ones Pitwall starts sessions with. Everything
          here installs and then goes through Add agent, and a page that does
          not say so sets somebody up to be surprised by the step that is
          missing. */}
      <div className="dk-section-head">
        <div>
          <h2 className="dk-section-title" id="marketplace-heading">Add more agents</h2>
          <p className="dk-section-desc">
            {tab === "signin"
              ? "These have their own command-line tool. Install it, sign in with the account you already have, and Pitwall can run it — there is nothing else to set up."
              : tab === "local"
                ? "Run a model on your own machine. Nothing is sent anywhere, there is no account and no key, and it costs nothing to use. Three parts, in this order."
                : "Everything Pitwall knows how to install, including the ones that need a key or a subscription."}
          </p>
        </div>
      </div>

      {/* Three decisions, not seven filters. Most people arrive asking "what do
          I install to make this work", and the answer depends only on whether
          they want to pay a provider or run it on their own machine. */}
      <div className="dk-subtabs" role="tablist" aria-label="How to run an agent">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className={tab === entry.id ? "is-current" : undefined}
            title={entry.hint}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === "local" ? (
        <>
          {/* A setup, in the order it has to happen, with the state of each
              step and the one button that advances it. Local models go wrong
              at the joins — the server not running, no model pulled, nothing
              able to drive it — and each of those failures surfaces somewhere
              else entirely as a refused connection or a 404. */}
          <ol className="dk-list dk-steps">
            <li className={`dk-list-row dk-step${localSteps.ollama ? " is-done" : " is-next"}`}>
              <span className="dk-tile" aria-hidden="true">1</span>
              <div className="dk-row-main">
                <span className="dk-row-title">Ollama</span>
                <p className="dk-step-desc">The program that runs models on your computer.</p>
                {ollamaEntry?.elsewhere ? (
                  <span className="dk-catalogue-elsewhere">On {ollamaEntry.elsewhere.label}: <code>{ollamaEntry.elsewhere.installCommand}</code></span>
                ) : null}
              </div>
              {localSteps.ollama ? (
                <span className="dk-status"><span className="dk-dot is-ready" aria-hidden="true" />Installed</span>
              ) : ollamaEntry ? (
                <button className="dk-btn dk-btn--sm dk-btn--primary" type="button" onClick={() => onInstall(ollamaEntry)}>
                  Install Ollama
                </button>
              ) : null}
            </li>

            <li className={`dk-list-row dk-step${localSteps.model ? " is-done" : localSteps.ollama ? " is-next" : ""}`}>
              <span className="dk-tile" aria-hidden="true">2</span>
              <div className="dk-row-main">
                <span className="dk-row-title">A model</span>
                <p className="dk-step-desc">
                  The part that does the thinking. A coding model of about 30B fits comfortably in 32&nbsp;GB of memory, on a Mac or a PC.
                </p>
                {!localSteps.model ? (
                  <p className="dk-step-desc dk-faint">
                    {localSteps.ollama
                      ? "Choose one under Ollama below — Pitwall pulls it and shows the progress."
                      : "Install Ollama first."}
                  </p>
                ) : null}
              </div>
              {localSteps.model ? (
                <span className="dk-status">
                  <span className="dk-dot is-ready" aria-hidden="true" />
                  {localModelCount === 1 ? "1 model pulled" : `${localModelCount} models pulled`}
                </span>
              ) : null}
            </li>

            <li className={`dk-list-row dk-step${localSteps.harness ? " is-done" : localSteps.model ? " is-next" : ""}`}>
              <span className="dk-tile" aria-hidden="true">3</span>
              <div className="dk-row-main">
                <span className="dk-row-title">A harness</span>
                <p className="dk-step-desc">
                  The tool that reads your files and runs commands, using the model to think.
                  A model on its own cannot touch your code — this is the part people miss.
                </p>
                {localSteps.harness ? (
                  <p className="dk-step-desc dk-faint">Your models appear when you start a session.</p>
                ) : (
                  <div className="dk-card-grid">
                    {harnessEntries.map((entry) => (
                      <CatalogueCard
                        key={entry.id}
                        entry={entry}
                        badges={[entry.licence ?? "", "Free"]}
                        onInstall={() => onInstall(entry)}
                      />
                    ))}
                  </div>
                )}
              </div>
              {localSteps.harness ? (
                <span className="dk-status"><span className="dk-dot is-ready" aria-hidden="true" />Installed</span>
              ) : null}
            </li>
          </ol>

          {localSteps.ollama ? (
            <OllamaSetup
              onAgentReady={onAgentReady}
              onInstallAgent={(catalogueId) => {
                const found = listing.find((item) => item.id === catalogueId);
                if (found) onInstall(found);
              }}
            />
          ) : null}
        </>
      ) : (
        <>
          {tab === "all" ? (
            <label className="dk-search dk-catalogue-search">
              <Search size={13} aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search agents and models"
                aria-label="Search agents"
              />
            </label>
          ) : null}

          {results.length === 0 ? (
            <p className="dk-empty">Nothing matches “{query}”.</p>
          ) : (
            <div className="dk-card-grid">
              {results.map((entry) => {
                const facts = live[entry.id];
                return (
                  <CatalogueCard
                    key={entry.id}
                    entry={entry}
                    installed={Boolean(installedCommands[entry.command])}
                    badges={[
                      entry.licence ?? "",
                      { text: ACCESS_LABEL[entry.access], tone: entry.access === "subscription" ? "amber" : undefined },
                      facts?.downloads ? { text: `${facts.downloads}/mo`, title: "Installs in the last month" } : "",
                      facts?.stale ? { text: "Dormant", title: facts.activity, tone: "amber" } : "",
                      drivableCommands.has(entry.command)
                        ? { text: "Direct", title: "Pitwall starts sessions with this one itself", tone: "accent" }
                        : "",
                    ]}
                    // Only the cards this is true of: a package that no longer
                    // points where its docs say is the one fact here worth
                    // interrupting a scan for.
                    warning={
                      facts?.publisherMatches === false
                        ? "The package this installs no longer points at the project its docs describe."
                        : ""
                    }
                    onInstall={() => onInstall(entry)}
                  />
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}

type Badge = string | { text: string; title?: string; tone?: "amber" | "accent" };

function CatalogueCard({
  entry,
  installed = false,
  badges,
  warning = "",
  onInstall,
}: {
  entry: CatalogueEntry;
  installed?: boolean;
  badges: Badge[];
  warning?: string;
  onInstall: () => void;
}) {
  return (
    <article className="dk-card dk-card--pad dk-catalogue-card">
      <span className="dk-row-title">{entry.name}</span>
      <p className="dk-catalogue-desc">{entry.summary}</p>
      <span className="dk-badges">
        {badges.filter(Boolean).map((badge) => {
          const item = typeof badge === "string" ? { text: badge } : badge;
          return (
            <span
              key={item.text}
              className={`dk-badge${"tone" in item && item.tone ? ` dk-badge--${item.tone}` : ""}`}
              title={"title" in item ? item.title : undefined}
            >
              {item.text}
            </span>
          );
        })}
      </span>
      {warning ? (
        <p className="dk-catalogue-warning">
          <AlertTriangle size={12} aria-hidden="true" />
          {warning}
        </p>
      ) : null}
      <span className="dk-catalogue-actions">
        {installed ? (
          <span className="dk-status"><span className="dk-dot is-ready" aria-hidden="true" />Installed</span>
        ) : entry.installCommand ? (
          <button className="dk-btn dk-btn--sm" type="button" onClick={onInstall}>
            Install
          </button>
        ) : null}
        {entry.docs ? <a className="dk-link" href={entry.docs} target="_blank" rel="noreferrer">Docs</a> : null}
      </span>
      {entry.elsewhere ? (
        <span className="dk-catalogue-elsewhere">On {entry.elsewhere.label}: <code>{entry.elsewhere.installCommand}</code></span>
      ) : null}
    </article>
  );
}
