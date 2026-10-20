"use strict";

// The names older versions of this app, as Braveli, wrote to disk, env and agent prompts; read so existing data keeps working.

const LEGACY_APP_NAME = "Braveli";

/** Braveli's profile under appData, named after its package; development runs still use it. */
const LEGACY_PROFILE_DIR = "braveli";

const LEGACY_IMPORT_MARKER = ".imported-from-braveli";

/** Per-project Hermes profiles hold learned memory, so an existing one keeps its name. */
const LEGACY_HERMES_PROFILE_PREFIX = "braveli-";

/** Council stages, contracts and lessons in project worktrees. */
const LEGACY_COUNCIL_DIR = ".braveli";

/** Baked into LaunchAgents and scheduled tasks registered by older versions. */
const LEGACY_SCHEDULER_FIRE_FLAG = "--braveli-scheduler-fire";

/** Carried by processes that sessions of older versions left running. */
const LEGACY_SESSION_ENV = "BRAVELI_SESSION_ID";

/** Release settings in an existing .env, and the names they now go by. */
const LEGACY_ENV_NAMES = {
  BRAVELI_UPDATE_URL: "PITWALL_DOWNLOADS_URL",
  BRAVELI_POSTHOG_KEY: "PITWALL_POSTHOG_KEY",
  BRAVELI_POSTHOG_HOST: "PITWALL_POSTHOG_HOST",
  BRAVELI_FREE_RELEASE: "PITWALL_FREE_RELEASE",
  BRAVELI_LICENCE_ENDPOINT: "PITWALL_LICENCE_ENDPOINT",
  BRAVELI_CHECKOUT_URL: "PITWALL_CHECKOUT_URL",
};

module.exports = {
  LEGACY_APP_NAME,
  LEGACY_PROFILE_DIR,
  LEGACY_IMPORT_MARKER,
  LEGACY_HERMES_PROFILE_PREFIX,
  LEGACY_COUNCIL_DIR,
  LEGACY_SCHEDULER_FIRE_FLAG,
  LEGACY_SESSION_ENV,
  LEGACY_ENV_NAMES,
};
