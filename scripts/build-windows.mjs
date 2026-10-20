#!/usr/bin/env node
/**
 * Packages the Windows installer with the update feed it will read.
 *
 * electron-updater needs `app-update.yml` in the installed app's resources
 * before it can download anything, and electron-builder only writes one when
 * the build names a publish target. The feed is the same folder the Mac build
 * uses, so it is passed here rather than kept in package.json, where it would
 * also change the Mac build. The same step writes `release/latest.yml`, the
 * manifest installed copies read.
 */
import { spawnSync } from "node:child_process";
import { loadEnv } from "./load-env.mjs";
import { feedUrl } from "./release-identity.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv(root);
const url = feedUrl();
if (!url) throw new Error("PITWALL_DOWNLOADS_URL (or PITWALL_UPDATE_URL) is required for a Windows release build");

const builder = path.join(root, "node_modules", "electron-builder", "cli.js");
const result = spawnSync(process.execPath, [
  builder, "--win", "nsis", "--x64",
  "-c.npmRebuild=false",
  "-c.publish.provider=generic",
  `-c.publish.url=${url}`,
  "--publish", "never",
], { cwd: root, stdio: "inherit", env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" } });
process.exit(result.status ?? 1);
