#!/usr/bin/env node
/**
 * Compiles the Swift voice daemon into `electron/voice/bin/pitwall-voice`.
 *
 * Kept out of `npm run build` so a contributor without Xcode's command line
 * tools can still work on the rest of the app — voice degrades to "engine not
 * built" rather than breaking the build. `npm run dist` does run it, because a
 * release without the daemon would ship a feature that silently does nothing.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const outputDirectory = path.join(root, "electron", "voice", "bin");

/**
 * Two binaries, deliberately separate. The voice daemon is long-lived and owns
 * the microphone; the observer is a one-shot read of the accessibility tree.
 * Keeping them apart means a screen read cannot wedge the microphone, and the
 * observer can be granted Accessibility without the daemon needing it.
 */
const binaries = [
  { source: path.join(root, "electron", "voice", "PitwallVoice.swift"), name: "pitwall-voice", frameworks: ["AVFoundation", "Speech"] },
  { source: path.join(root, "electron", "voice", "PitwallObserve.swift"), name: "pitwall-observe", frameworks: ["ApplicationServices", "AppKit"] },
];

const optional = process.argv.includes("--optional");

function fail(message) {
  if (optional) {
    console.warn(`[voice] ${message} — skipping (voice features will be unavailable).`);
    process.exit(0);
  }
  console.error(`[voice] ${message}`);
  process.exit(1);
}

if (process.platform !== "darwin") {
  fail("The voice engine is macOS-only.");
}

const swiftc = spawnSync("xcrun", ["--find", "swiftc"], { encoding: "utf8" });
if (swiftc.status !== 0) {
  fail("swiftc was not found. Install Xcode command line tools with `xcode-select --install`.");
}

fs.mkdirSync(outputDirectory, { recursive: true });

// Universal where possible so an Intel Mac gets a working binary from an
// Apple Silicon build machine. Falls back to the host arch when the SDK
// cannot produce both slices.
const targets = ["arm64-apple-macos13.0", "x86_64-apple-macos13.0"];

for (const binary of binaries) {
  if (!fs.existsSync(binary.source)) fail(`Missing source: ${binary.source}`);

  const output = path.join(outputDirectory, binary.name);
  const frameworkArgs = binary.frameworks.flatMap((framework) => ["-framework", framework]);
  const slices = [];

  for (const target of targets) {
    const slice = path.join(outputDirectory, `${binary.name}-${target.split("-")[0]}`);
    const result = spawnSync(
      "xcrun",
      ["swiftc", "-O", "-target", target, ...frameworkArgs, binary.source, "-o", slice],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    if (result.status === 0) {
      slices.push(slice);
    } else {
      console.warn(`[voice] Could not build the ${target} slice of ${binary.name}: ${(result.stderr || "").trim().split("\n").pop()}`);
    }
  }

  if (!slices.length) fail(`${binary.name} failed to compile for any architecture.`);

  if (slices.length === 1) {
    fs.copyFileSync(slices[0], output);
  } else {
    const lipo = spawnSync("xcrun", ["lipo", "-create", ...slices, "-output", output], { encoding: "utf8" });
    if (lipo.status !== 0) {
      console.warn(`[voice] lipo failed for ${binary.name}; shipping the host-architecture slice only.`);
      fs.copyFileSync(slices[0], output);
    }
  }

  for (const slice of slices) fs.rmSync(slice, { force: true });
  fs.chmodSync(output, 0o755);

  const { size } = fs.statSync(output);
  console.log(`[voice] Built ${path.relative(root, output)} (${(size / 1024).toFixed(0)} KB, ${slices.length} arch).`);
}
