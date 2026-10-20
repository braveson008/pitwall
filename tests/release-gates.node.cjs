const assert = require("node:assert/strict");
const { test } = require("node:test");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");

const root = path.resolve(__dirname, "..");
function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "pitwall-release-gates-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const sub of ["scripts", "release", "bin"]) mkdirSync(path.join(dir, sub));
  for (const name of ["prepare-release.mjs", "load-env.mjs", "write-update-manifest.mjs", "upload-release.mjs", "verify-release-archive.mjs", "release-identity.mjs"])
    copyFileSync(path.join(root, "scripts", name), path.join(dir, "scripts", name));
  mkdirSync(path.join(dir, "electron", "lib"), { recursive: true });
  copyFileSync(path.join(root, "electron", "lib", "legacyNames.cjs"), path.join(dir, "electron", "lib", "legacyNames.cjs"));
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version: "9.9.9", type: "module", build: { productName: "Pitwall" } }));
  writeFileSync(path.join(dir, "notary.p8"), "-----BEGIN PRIVATE KEY-----\nfixture-only\n");
  for (const name of ["Pitwall-9.9.9-arm64.zip", "Pitwall-9.9.9-arm64.dmg", "Pitwall-9.9.9-arm64.zip.blockmap", "Pitwall-9.9.9-arm64.dmg.blockmap"])
    writeFileSync(path.join(dir, "release", name), "fixture-only");
  const env = {
    PATH: path.join(dir, "bin"), PITWALL_DOWNLOADS_URL: "https://updates.example.invalid",
    APPLE_TEAM_ID: "ABCDEFGHIJ", APPLE_API_KEY_ID: "KLMNOPQRST",
    APPLE_API_ISSUER: "12345678-1234-1234-1234-123456789abc", APPLE_API_KEY: path.join(dir, "notary.p8"),
  };
  function command(name, source) {
    writeFileSync(path.join(dir, "bin", name), `#!${process.execPath}\n${source}\n`, { mode: 0o700 });
  }
  command("xcrun", 'console.log("The validate action worked!")');
  command("spctl", 'console.log("accepted")');
  command("codesign", 'process.exit(0)');
  command("ditto", 'import fs from "node:fs"; import path from "node:path"; fs.mkdirSync(path.join(process.argv.at(-1), "Pitwall.app"))');
  return { dir, env, command,
    run(name, args = [], overrides = {}) {
      return spawnSync(process.execPath, [path.join(dir, "scripts", name), ...args], {
        env: { ...env, ...overrides }, encoding: "utf8", timeout: 10_000,
      });
    },
  };
}
const output = (result) => `${result.stdout}${result.stderr}`;

test("paid signing requires an endpoint before writing build configuration", (t) => {
  const f = fixture(t);
  const result = f.run("prepare-release.mjs");
  assert.equal(result.status, 1);
  assert.match(output(result), /PITWALL_LICENCE_ENDPOINT is required/);
  assert.equal(existsSync(path.join(f.dir, "build")), false);
});

test("signed paid configuration accepts the API-key credentials supplied by CI", (t) => {
  const f = fixture(t);
  const result = f.run("prepare-release.mjs", [], { PITWALL_LICENCE_ENDPOINT: "https://licence.example.invalid/verify" });
  assert.equal(result.status, 0, output(result));
  assert.equal(JSON.parse(readFileSync(path.join(f.dir, "build/licence-config.json"))).endpoint, "https://licence.example.invalid/verify");
});

test("only an explicit free signed release may omit the licence service", (t) => {
  const f = fixture(t);
  assert.equal(f.run("prepare-release.mjs", [], { PITWALL_FREE_RELEASE: "true" }).status, 1);
  const result = f.run("prepare-release.mjs", [], { PITWALL_FREE_RELEASE: "1" });
  assert.equal(result.status, 0, output(result));
});

test("licence endpoints reject insecure transport and embedded credentials", (t) => {
  const f = fixture(t);
  for (const endpoint of ["http://licence.example.invalid", "https://user:password@licence.example.invalid"]) {
    assert.equal(f.run("prepare-release.mjs", [], { PITWALL_LICENCE_ENDPOINT: endpoint }).status, 1);
  }
});

test("unsigned manifests are separate and require no signing tools", (t) => {
  const f = fixture(t);
  f.command("xcrun", 'throw new Error("must not call Apple for unsigned output")');
  const result = f.run("write-update-manifest.mjs", ["--unsigned"]);
  assert.equal(result.status, 0, output(result));
  assert.equal(existsSync(path.join(f.dir, "release/latest-mac.yml")), false);
  assert.match(readFileSync(path.join(f.dir, "release/latest-mac-unsigned.yml"), "utf8"), /^pitwallSigned: false$/m);
});

test("failed notarization cannot produce a trusted manifest, even with success text", (t) => {
  const f = fixture(t);
  f.command("xcrun", 'console.log("The validate action worked!"); process.exit(1)');
  const result = f.run("write-update-manifest.mjs");
  assert.equal(result.status, 1);
  assert.equal(existsSync(path.join(f.dir, "release/latest-mac.yml")), false);
});

test("a signed DMG cannot authorize an unsigned updater ZIP", (t) => {
  const f = fixture(t);
  f.command("codesign", 'console.error("ZIP app signature invalid"); process.exit(1)');
  const result = f.run("write-update-manifest.mjs");
  assert.equal(result.status, 1);
  assert.match(output(result), /Update ZIP.*not signed and notarized: ZIP app signature invalid/);
  assert.equal(existsSync(path.join(f.dir, "release/latest-mac.yml")), false);
});

test("signed manifest is emitted only after successful acceptance checks", (t) => {
  const f = fixture(t);
  const result = f.run("write-update-manifest.mjs");
  assert.equal(result.status, 0, output(result));
  assert.match(readFileSync(path.join(f.dir, "release/latest-mac.yml"), "utf8"), /^pitwallSigned: true$/m);
});

test("upload refuses unsigned metadata and stale ZIP hashes before constructing a network client", (t) => {
  const f = fixture(t);
  const sdk = path.join(f.dir, "node_modules/@aws-sdk/client-s3");
  mkdirSync(sdk, { recursive: true });
  writeFileSync(path.join(sdk, "package.json"), JSON.stringify({ type: "module", main: "index.js" }));
  writeFileSync(path.join(sdk, "index.js"), 'export class S3Client { constructor() { throw new Error("NETWORK_FORBIDDEN"); } } export class PutObjectCommand {}');
  const manifest = path.join(f.dir, "release/latest-mac.yml");
  const digest = createHash("sha512").update("fixture-only").digest("base64");
  for (const [signed, checksum, expected] of [[false, digest, /not a verified signed-release manifest/], [true, "stale", /checksum does not match/]]) {
    writeFileSync(manifest, `version: 9.9.9\npitwallSigned: ${signed}\npath: Pitwall-9.9.9-arm64.zip\nsha512: ${checksum}\n`);
    const result = f.run("upload-release.mjs", [], { R2_ENDPOINT: "https://fixture.invalid", R2_BUCKET: "fixture", R2_ACCESS_KEY_ID: "fixture", R2_SECRET_ACCESS_KEY: "fixture" });
    assert.equal(result.status, 1);
    assert.match(output(result), expected);
    assert.doesNotMatch(output(result), /NETWORK_FORBIDDEN/);
  }
});

function notarizeHook(env, childProcess, blockmap) {
  const vm = require("node:vm");
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(path.join(root, "scripts/notarize-dmg.cjs"), "utf8"), {
    module, process: { env }, console: { log() {}, warn() {} },
    require(name) {
      if (name === "node:child_process") return childProcess;
      if (name === "app-builder-lib/out/targets/blockmap/blockmap" && blockmap) return blockmap;
      return require(name);
    },
  });
  return module.exports;
}

test("notarization hook imports with the installed builder and unsigned mode calls no signing tools", async () => {
  assert.equal(typeof require("../scripts/notarize-dmg.cjs"), "function");
  const refuse = () => { throw new Error("unsigned build must not invoke a signing tool"); };
  const hook = notarizeHook({ CSC_IDENTITY_AUTO_DISCOVERY: "false" }, { execFileSync: refuse, spawnSync: refuse });
  await hook({ artifactPaths: ["fixture.dmg"] });
});

test("signed DMG blockmap is rebuilt from the final signed and stapled bytes", async (t) => {
  const { appendFileSync } = require("node:fs");
  const { gunzipSync } = require("node:zlib");
  const { blake2b } = require("@noble/hashes/blake2.js");
  const f = fixture(t);
  const dmg = path.join(f.dir, "release/Pitwall-9.9.9-arm64.dmg");
  const order = [];
  const hook = notarizeHook({ APPLE_API_KEY: "fixture", APPLE_API_KEY_ID: "fixture", APPLE_API_ISSUER: "fixture" }, {
    execFileSync(command, args) {
      if (command === "codesign") { appendFileSync(dmg, "signed"); order.push("sign"); }
      else if (command === "xcrun" && args[0] === "notarytool") order.push("notarize");
      else if (command === "xcrun" && args[1] === "staple") { appendFileSync(dmg, "stapled"); order.push("staple"); }
      else throw new Error(`Unexpected signing command ${command}`);
    },
    spawnSync(command) {
      if (command === "security") return { status: 0, stdout: '1) "Developer ID Application: Fixture"' };
      order.push("validate");
      return { status: 0, stdout: "The validate action worked!" };
    },
  });
  await hook({ artifactPaths: [dmg] });
  const bytes = readFileSync(dmg);
  const map = JSON.parse(gunzipSync(readFileSync(`${dmg}.blockmap`)));
  assert.deepEqual(order, ["sign", "notarize", "staple", "validate"]);
  assert.equal(map.version, "2");
  assert.deepEqual(map.files[0].sizes, [bytes.length]);
  assert.deepEqual(map.files[0].checksums, [Buffer.from(blake2b(bytes, { dkLen: 18 })).toString("base64")]);
});

test("a blockmap generation failure fails the signed build", async () => {
  let validated = false;
  const hook = notarizeHook({ APPLE_API_KEY: "fixture", APPLE_API_KEY_ID: "fixture", APPLE_API_ISSUER: "fixture" }, {
    execFileSync() {},
    spawnSync(command) {
      if (command === "security") return { status: 0, stdout: '1) "Developer ID Application: Fixture"' };
      validated = true;
      return { status: 0 };
    },
  }, { async buildBlockMap() { throw new Error("disk full rebuilding blockmap"); } });
  await assert.rejects(hook({ artifactPaths: ["fixture.dmg"] }), /disk full rebuilding blockmap/);
  assert.equal(validated, false);
});

test("the public build updates from GitHub and carries none of the private services", (t) => {
  const f = fixture(t);
  const result = f.run("prepare-release.mjs", [], { PITWALL_PUBLIC_BUILD: "1", PITWALL_POSTHOG_KEY: "phc_private", PITWALL_LICENCE_ENDPOINT: "https://licence.example.invalid/verify" });
  assert.equal(result.status, 0, output(result));
  const read = (name) => JSON.parse(readFileSync(path.join(f.dir, "build", name)));
  assert.deepEqual(read("update-config.json"), { enabled: true, provider: "github", owner: "braveson008", repo: "pitwall" });
  assert.equal(read("analytics-config.json").key, "");
  assert.equal(read("licence-config.json").endpoint, "");
});

test("the owner's build keeps its feed", (t) => {
  const f = fixture(t);
  const result = f.run("prepare-release.mjs", [], { PITWALL_FREE_RELEASE: "1" });
  assert.equal(result.status, 0, output(result));
  assert.equal(JSON.parse(readFileSync(path.join(f.dir, "build/update-config.json"))).url, "https://updates.example.invalid/pitwall");
});

test("a .env written under the old names keeps configuring the build", (t) => {
  const f = fixture(t);
  writeFileSync(path.join(f.dir, ".env"), [
    "BRAVELI_UPDATE_URL=https://legacy.example.invalid/",
    "BRAVELI_POSTHOG_KEY=phc_legacy",
    "BRAVELI_POSTHOG_HOST=https://legacy-posthog.example.invalid",
    "BRAVELI_FREE_RELEASE=1",
  ].join("\n"));
  const result = f.run("prepare-release.mjs", [], { PITWALL_DOWNLOADS_URL: "" });
  assert.equal(result.status, 0, output(result));
  const read = (name) => JSON.parse(readFileSync(path.join(f.dir, "build", name)));
  assert.equal(read("update-config.json").url, "https://legacy.example.invalid/pitwall");
  assert.deepEqual(read("analytics-config.json"), { key: "phc_legacy", host: "https://legacy-posthog.example.invalid" });
});

test("a current name beats the old one", (t) => {
  const f = fixture(t);
  writeFileSync(path.join(f.dir, ".env"), "BRAVELI_UPDATE_URL=https://legacy.example.invalid\nPITWALL_FREE_RELEASE=1\n");
  const result = f.run("prepare-release.mjs", []);
  assert.equal(result.status, 0, output(result));
  assert.equal(JSON.parse(readFileSync(path.join(f.dir, "build/update-config.json"))).url, "https://updates.example.invalid/pitwall");
});
