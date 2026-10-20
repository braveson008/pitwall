/**
 * What the registries say about a catalogue entry, right now.
 *
 * Everything hard-coded goes stale, and a list of agent CLIs goes stale
 * quickly — these ship weekly, and the ones that stopped shipping look
 * identical to the ones that did not. Worse, the list was written from what
 * a model remembered, which is the least reliable source available for
 * package names that changed last month.
 *
 * So the facts that move are fetched: the current version, when it was last
 * published, and how many people install it. The catalogue keeps the facts
 * that do not — what a thing is, what it is called, where its documentation
 * lives — because those are the ones a network failure must not erase.
 */

const NPM_REGISTRY = "https://registry.npmjs.org";
const NPM_DOWNLOADS = "https://api.npmjs.org/downloads/point/last-month";

/** The package a command installs, when it is an npm install. */
function npmPackage(installCommand) {
  const match = String(installCommand || "").trim().match(/^npm (?:install|i) -g (@[a-z0-9-]+\/)?([a-z0-9._-]+)$/i);
  if (!match) return "";
  return `${match[1] ?? ""}${match[2]}`;
}

/**
 * Whether a package is still being worked on.
 *
 * Six months is not a rule about quality — plenty of finished software is
 * finished. It is the line past which "is anyone still shipping this" is a
 * question worth putting on screen, next to nine alternatives where somebody
 * is.
 */
function activity(publishedAt, now) {
  if (!publishedAt) return { label: "", stale: false };
  const days = Math.floor((now - Date.parse(publishedAt)) / 86_400_000);
  if (!Number.isFinite(days) || days < 0) return { label: "", stale: false };
  if (days <= 14) return { label: "updated this week", stale: false };
  if (days <= 60) return { label: "updated this month", stale: false };
  if (days <= 180) return { label: `updated ${Math.round(days / 30)} months ago`, stale: false };
  return { label: `last updated ${Math.round(days / 30)} months ago`, stale: true };
}

/** Downloads as something readable: `12k`, `1.4M`. */
function formatDownloads(count) {
  if (!Number.isFinite(count) || count <= 0) return "";
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${Math.round(count / 1000)}k`;
  return String(count);
}

/**
 * Whether the package a command installs belongs to the project it claims.
 *
 * The check that kept `grok-cli` out of the catalogue: a package whose name
 * matches and whose repository does not. Run again at runtime, because a
 * package can change hands after a list is written.
 */
function repositoryMatches(declaredRepo, docsUrl) {
  const repo = String(declaredRepo || "").toLowerCase();
  const docs = String(docsUrl || "").toLowerCase();
  const owner = docs.match(/github\.com\/([a-z0-9_.-]+)\/([a-z0-9_.-]+)/);
  if (!owner || !repo) return null;                 // nothing to compare
  return repo.includes(`${owner[1]}/${owner[2]}`);
}

async function fetchPackage(name, fetchImpl = fetch) {
  const encoded = name.replace("/", "%2f");
  const [meta, downloads] = await Promise.all([
    fetchImpl(`${NPM_REGISTRY}/${encoded}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetchImpl(`${NPM_DOWNLOADS}/${encoded}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  if (!meta) return null;

  const latest = meta["dist-tags"]?.latest;
  const version = meta.versions?.[latest];
  const repo = typeof version?.repository === "string" ? version.repository : version?.repository?.url;
  return {
    version: latest || "",
    publishedAt: meta.time?.[latest] || "",
    downloads: Number(downloads?.downloads) || 0,
    repository: repo || "",
  };
}

module.exports = { npmPackage, activity, formatDownloads, repositoryMatches, fetchPackage };
