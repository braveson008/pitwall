import { GITHUB_REPO, feedUrl } from "./release-identity.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { loadEnv } from "./load-env.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv(root);

const unsigned = process.argv.includes("--unsigned");
// A Windows release has the feed baked in but is not code-signed yet, so none
// of the Apple notarisation settings apply to it.
const windows = process.argv.includes("--windows");
// The open-source build: GitHub releases for updates, and none of the private services (.env would otherwise supply them).
const publicBuild = process.env.PITWALL_PUBLIC_BUILD === "1";
const updateUrl = unsigned || publicBuild ? "" : feedUrl();
const freeRelease = process.env.BRAVELI_FREE_RELEASE === "1";
const licenceEndpoint = publicBuild ? "" : String(process.env.BRAVELI_LICENCE_ENDPOINT || "").trim();
if (!unsigned && !freeRelease && !publicBuild && !licenceEndpoint) {
  throw new Error("BRAVELI_LICENCE_ENDPOINT is required for a paid release; set BRAVELI_FREE_RELEASE=1 only for an intentional free release");
}
if (licenceEndpoint) {
  const endpoint = new URL(licenceEndpoint);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) {
    throw new Error("BRAVELI_LICENCE_ENDPOINT must be an HTTPS URL without embedded credentials");
  }
}


/**
 * Everything a signed build needs, checked before anything is built.
 *
 * Without this the failure arrives at the end: electron-builder compiles,
 * packages, signs with whichever identity it found first, and only then does
 * notarisation reject it — with a message about the submission rather than
 * about the credential that was wrong. Two of these values are ten uppercase
 * characters and belong to different systems, so transposing them is the
 * likely mistake and worth naming explicitly.
 */
if (!unsigned && !windows) {
  const TEAM_OR_KEY = /^[A-Z0-9]{10}$/;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const problems = [];

  const teamId = String(process.env.APPLE_TEAM_ID || "").trim();
  const keyId = String(process.env.APPLE_API_KEY_ID || "").trim();
  const issuer = String(process.env.APPLE_API_ISSUER || "").trim();
  const keyPath = String(process.env.APPLE_API_KEY || "").trim();

  if (!teamId) problems.push("APPLE_TEAM_ID is not set (Membership details on developer.apple.com)");
  else if (!TEAM_OR_KEY.test(teamId)) problems.push(`APPLE_TEAM_ID "${teamId}" is not ten uppercase alphanumerics`);

  if (!keyId) problems.push("APPLE_API_KEY_ID is not set (the AuthKey_XXXXXXXXXX.p8 filename)");
  else if (!TEAM_OR_KEY.test(keyId)) problems.push(`APPLE_API_KEY_ID "${keyId}" is not ten uppercase alphanumerics`);

  if (teamId && keyId && teamId === keyId) {
    problems.push("APPLE_TEAM_ID and APPLE_API_KEY_ID are the same value — one of them is the other's");
  }

  if (!issuer) problems.push("APPLE_API_ISSUER is not set (Issuer ID on appstoreconnect.apple.com)");
  else if (!UUID.test(issuer)) problems.push(`APPLE_API_ISSUER "${issuer}" is not a UUID — it may be a Key ID`);

  if (!keyPath) problems.push("APPLE_API_KEY is not set (path to your AuthKey_*.p8)");
  else if (!existsSync(keyPath)) problems.push(`APPLE_API_KEY points at ${keyPath}, which does not exist`);
  else if (!readFileSync(keyPath, "utf8").includes("BEGIN PRIVATE KEY")) {
    problems.push(`APPLE_API_KEY at ${keyPath} is not a PKCS#8 private key`);
  }

  if (problems.length) {
    throw new Error(
      `Cannot make a signed build:\n  - ${problems.join("\n  - ")}\n\n` +
        "These live in .env (gitignored). A signed build without them would package, sign\n" +
        "with whichever identity was found first, and fail at notarisation.",
    );
  }
  console.log(`Signing as team ${teamId}, notarising with key ${keyId}`);
}

await mkdir(path.join(root, "build"), { recursive: true });
// A signed build with no feed URL is the public one, and updates from GitHub releases.
const updateConfig = updateUrl
  ? { enabled: true, url: updateUrl }
  : unsigned ? { enabled: false, url: "" } : { enabled: true, provider: "github", ...GITHUB_REPO };
// The bundled Node runtime went with code-server: it existed because
// code-server ships no node of its own and forks the VS Code server through
// process.execPath. Nothing in the app runs Node as a subprocess any more.
await writeFile(
  path.join(root, "build", "update-config.json"),
  `${JSON.stringify(updateConfig, null, 2)}\n`,
  "utf8",
);
console.log(updateUrl ? `Configured updates from ${updateUrl}` : unsigned ? "Built without an update feed" : `Configured updates from GitHub releases of ${GITHUB_REPO.owner}/${GITHUB_REPO.repo}`);

// Analytics travels the same road as the update feed: an environment variable
// at build time, written into a file that ships in Resources. `electron/**` is
// copied into the app rather than bundled, so a process.env read there runs on
// the user's machine — where nothing set it. Baking is the only way it arrives.
const posthogKey = publicBuild ? "" : process.env.BRAVELI_POSTHOG_KEY || "";
const posthogHost = process.env.BRAVELI_POSTHOG_HOST || "https://eu.i.posthog.com";
await writeFile(
  path.join(root, "build", "analytics-config.json"),
  `${JSON.stringify({ key: posthogKey, host: posthogHost }, null, 2)}\n`,
  "utf8",
);
console.log(posthogKey ? `Analytics enabled via ${posthogHost}` : "Built without analytics");

// The credits gateway, baked the same way; the open-source build has none, so it never offers credits.
const gateway = publicBuild ? "" : String(process.env.PITWALL_GATEWAY_URL || "").trim();
// The owner's builds sell credits and sync through the gateway; one built without it would quietly lose both.
if (updateUrl && !gateway) throw new Error("PITWALL_GATEWAY_URL is required for a build on your own update feed (PITWALL_PUBLIC_BUILD=1 builds the open-source one)");
await writeFile(path.join(root, "build", "credits-config.json"), `${JSON.stringify({ gateway }, null, 2)}\n`, "utf8");
console.log(gateway ? `Credits via ${gateway}` : "Built without a credits gateway");

// The licence service, baked for the same reason as everything above it. An
// explicitly free or unsigned build may omit the endpoint: `verifyWithMerchant`
// answers "not-configured" and licence enforcement stays disabled. Paid signed
// releases must configure the service before any build files are written.
const checkoutUrl = process.env.BRAVELI_CHECKOUT_URL || "https://braveli.app/#pricing";
await writeFile(
  path.join(root, "build", "licence-config.json"),
  `${JSON.stringify({ endpoint: licenceEndpoint, checkoutUrl }, null, 2)}\n`,
  "utf8",
);
console.log(
  licenceEndpoint
    ? `Licence checks via ${licenceEndpoint}`
    : "Built without a licence service — licence enforcement disabled",
);
