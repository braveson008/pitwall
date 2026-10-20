import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Electron is a devDependency but its Chromium/Node runtime ships in every app.
// npm audit runs over the whole tree; this also rejects an EOL build even when
// the advisory database has no current match. Review at each Electron upgrade.
const expected = [
  ["electron", "44.2.0", "node_modules/electron"],
  ["js-yaml", "4.3.1", "node_modules/js-yaml"],
];
const electronSupportEnds = Date.parse("2027-03-02T00:00:00Z");
if (Date.now() >= electronSupportEnds) {
  throw new Error("Electron 44 has reached end of support; upgrade the shipped runtime and review its release schedule");
}
for (const [name, version, relativeTarget] of expected) {
  const packageJson = JSON.parse(
    await readFile(path.join(root, relativeTarget, "package.json"), "utf8"),
  );
  if (packageJson.version !== version) {
    throw new Error(`Unreviewed bundled ${name}: expected ${version}, found ${packageJson.version}`);
  }
  console.log(`OK shipped ${name}@${version}`);
}
