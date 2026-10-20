// Where a packaged build looks for updates: a generic feed (a bucket behind a URL) or GitHub releases.
function feedFromConfig(config, env = process.env) {
  if (env.PITWALL_UPDATE_URL) return { provider: "generic", url: env.PITWALL_UPDATE_URL };
  if (!config || !config.enabled) return null;
  if (config.provider === "github") {
    return config.owner && config.repo ? { provider: "github", owner: String(config.owner), repo: String(config.repo) } : null;
  }
  return typeof config.url === "string" && config.url ? { provider: "generic", url: config.url } : null;
}

/** electron-updater reads app-update.yml before every download; a build with no publish target ships none. */
function updaterYaml(feed) {
  const fields = feed.provider === "github" ? `owner: ${JSON.stringify(feed.owner)}\nrepo: ${JSON.stringify(feed.repo)}` : `url: ${JSON.stringify(feed.url)}`;
  return `provider: ${feed.provider}\n${fields}\nupdaterCacheDirName: pitwall-updater\n`;
}

module.exports = { feedFromConfig, updaterYaml };
