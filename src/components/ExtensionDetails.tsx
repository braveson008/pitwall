import { createPortal } from "react-dom";
import { useModalFocus } from "../hooks/useModalFocus";
import { ArrowUpRight, Check, Download, Loader2, Plug, Trash2, X } from "lucide-react";
import { formatInstalls, formatTokens } from "../lib/agentExtensions";

/**
 * One plugin or server, in full.
 *
 * The list rows are deliberately shallow — a name, two lines of description and
 * a button — because several hundred of them have to stay scannable. That
 * leaves nowhere to put the things you actually want before installing
 * something into every future session: everything it contains, what it will
 * cost on every prompt, exactly which command is about to run on your machine,
 * and which keys it will demand afterwards.
 *
 * There are no star ratings here because neither catalogue has any. The Claude
 * plugin catalogue publishes install counts; the MCP registry publishes nothing
 * at all, so npm's weekly downloads stand in where a server is an npm package.
 * Inventing a five-star average would be easy and would be a lie about how
 * much other people trust a thing.
 */

export type DetailsSubject =
  | { kind: "plugin"; plugin: AgentPlugin }
  | { kind: "server"; server: RegistryMcpServer };

export function ExtensionDetails({
  subject,
  provider,
  busy,
  onClose,
  onInstall,
  onRemove,
}: {
  subject: DetailsSubject;
  provider: string;
  busy: boolean;
  onClose: () => void;
  onInstall: () => void;
  onRemove?: () => void;
}) {
  const dialogRef = useModalFocus<HTMLDivElement>(true, onClose);
  const installed = subject.kind === "plugin" && subject.plugin.installed;

  // Portalled: as a child of the narrow page it took the page's column width.
  return createPortal(
    <div className="dk-backdrop dk-sheet-backdrop" onClick={onClose} role="presentation">
      <div ref={dialogRef}
        className="dk-dialog dk-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={subject.kind === "plugin" ? subject.plugin.name : subject.server.title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dk-dialog-header">
          <div>
            <h2 className="dk-dialog-title">{subject.kind === "plugin" ? subject.plugin.name : subject.server.title}</h2>
            <p className="dk-dialog-desc">{subject.kind === "plugin" ? "Plugin" : "MCP server"}</p>
          </div>
          <button type="button" className="dk-icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="dk-dialog-body">
          {subject.kind === "plugin" ? <PluginDetail plugin={subject.plugin} /> : <ServerDetail server={subject.server} />}
        </div>

        <div className="dk-dialog-footer">
          {installed && onRemove ? (
            <button type="button" className="dk-btn dk-btn--ghost dk-btn--danger" disabled={busy} onClick={onRemove}>
              <Trash2 size={13} />
              Remove
            </button>
          ) : null}
          <span className="dk-spacer" />
          <button type="button" className="dk-btn dk-btn--primary" disabled={busy || installed} onClick={onInstall}>
            {busy ? <Loader2 size={13} className="dk-spin" /> : installed ? <Check size={13} /> : <Download size={13} />}
            {busy ? "Working" : installed ? `Installed for ${provider}` : `Install for ${provider}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function PluginDetail({ plugin }: { plugin: AgentPlugin }) {
  const components = plugin.components ?? {};
  const groups = [
    { key: "skills", label: "Skills" },
    { key: "commands", label: "Commands" },
    { key: "agents", label: "Agents" },
    { key: "mcpServers", label: "MCP servers" },
    { key: "hooks", label: "Hooks" },
  ].filter((group) => (components[group.key]?.length ?? 0) > 0);

  return (
    <>
      <p className="dk-detail-lede">{plugin.description || "This plugin ships no description."}</p>

      <dl className="dk-fact-grid">
        {plugin.author ? <Fact label="Published by" value={plugin.author} /> : null}
        <Fact label="Marketplace" value={plugin.marketplace} />
        {plugin.version ? <Fact label="Version" value={plugin.version} mono /> : null}
        {/* The nearest thing to a rating either catalogue has. */}
        {formatInstalls(plugin.installs) ? <Fact label="Installs" value={`${formatInstalls(plugin.installs)} people`} /> : null}
      </dl>

      {plugin.tokens?.alwaysOn || plugin.tokens?.onInvoke ? (
        <section className="dk-section">
          <h3 className="dk-section-title">What it costs</h3>
          <dl className="dk-fact-grid">
            {formatTokens(plugin.tokens?.alwaysOn) ? (
              <Fact
                label="Every session"
                value={`${formatTokens(plugin.tokens?.alwaysOn)} tokens`}
                note="Added to every prompt, whether or not you use it"
              />
            ) : null}
            {formatTokens(plugin.tokens?.onInvoke) ? (
              <Fact
                label="When it fires"
                value={`${formatTokens(plugin.tokens?.onInvoke)} tokens`}
                note="Paid each time one of its skills actually runs"
              />
            ) : null}
          </dl>
        </section>
      ) : null}

      {groups.length > 0 ? (
        <section className="dk-section">
          <h3 className="dk-section-title">What comes with it</h3>
          {groups.map((group) => (
            <div className="dk-section" key={group.key}>
              <span className="dk-label">
                {group.label} <span className="dk-faint">{components[group.key].length}</span>
              </span>
              <ul className="dk-list dk-detail-list">
                {components[group.key].map((item) => (
                  <li className="dk-list-row" key={item.name}>
                    <code className="dk-mono">{item.name}</code>
                    {formatTokens(item.alwaysOn) ? <span className="dk-faint">{formatTokens(item.alwaysOn)} tok always on</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ) : null}
    </>
  );
}

function ServerDetail({ server }: { server: RegistryMcpServer }) {
  const launch = server.launch;

  return (
    <>
      <p className="dk-detail-lede">{server.description || "This server ships no description."}</p>

      <dl className="dk-fact-grid">
        {/* The registry carries no rating and no verification badge, so who
            published it is the whole of the provenance. */}
        {server.publisher ? <Fact label="Published by" value={server.publisher} mono /> : null}
        {server.version ? <Fact label="Version" value={server.version} mono /> : null}
        {typeof server.weeklyDownloads === "number" ? (
          <Fact
            label="Downloads"
            value={`${formatInstalls(server.weeklyDownloads)} a week`}
            note="From npm — the registry publishes no popularity data of its own"
          />
        ) : null}
        <Fact
          label="Runs"
          value={launch?.kind === "remote" ? "Hosted by the publisher" : "On this machine"}
          note={
            launch?.kind === "remote"
              ? "Nothing is installed; the agent connects over the network"
              : "Started as a subprocess when the agent needs it"
          }
        />
      </dl>

      {launch ? (
        <section className="dk-section">
          <h3 className="dk-section-title">What will run</h3>
          {/* Shown before it runs, not after. Somebody should be able to see
              exactly what is about to execute on their machine. */}
          <pre className="dk-code">
            {launch.kind === "remote" ? launch.url : `${launch.command} ${(launch.args ?? []).join(" ")}`}
          </pre>
        </section>
      ) : (
        <section className="dk-section">
          <h3 className="dk-section-title">What will run</h3>
          <p className="dk-section-desc">
            This server is published as a container image. Pitwall will not guess at a Docker command for you — add it by
            hand if you have the runtime.
          </p>
        </section>
      )}

      {launch?.env?.length ? (
        <section className="dk-section">
          <h3 className="dk-section-title">Keys it will need</h3>
          <p className="dk-section-desc">
            Installing it here does not set these. It will connect only once they are in the agent's own configuration.
          </p>
          <ul className="dk-list dk-detail-list">
            {launch.env.map((variable) => (
              <li className="dk-list-row" key={variable.name}>
                <code className="dk-mono">{variable.name}</code>
                {variable.description ? <span className="dk-faint">{variable.description}</span> : null}
                {variable.secret ? <span className="dk-badge">Secret</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {server.websiteUrl ? (
        <span>
          <button
            type="button"
            className="dk-link dk-detail-link"
            onClick={() => void window.pitwall?.openExternalUrl?.(server.websiteUrl)}
          >
            <Plug size={12} />
            {server.websiteUrl}
            <ArrowUpRight size={12} />
          </button>
        </span>
      ) : null}
    </>
  );
}

function Fact({ label, value, note, mono }: { label: string; value: string; note?: string; mono?: boolean }) {
  return (
    <div className="dk-fact">
      <dt>{label}</dt>
      <dd className={mono ? "dk-mono" : undefined}>{value}</dd>
      {note ? <small>{note}</small> : null}
    </div>
  );
}
