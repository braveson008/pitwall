const PROVIDER_CAPABILITIES = {
  claude: {
    completionEvent: "Stop",
    completionLabel: "Claude Stop hook",
    minimumCompletionVersion: null,
    mcp: true,
    projectMcpAuth: "isolated",
  },
  codex: {
    completionEvent: "agent-turn-complete",
    completionLabel: "Codex notify callback",
    minimumCompletionVersion: null,
    mcp: true,
    projectMcpAuth: "isolated",
  },
  gemini: {
    completionEvent: "AfterAgent",
    completionLabel: "Gemini AfterAgent hook",
    minimumCompletionVersion: "0.26.0",
    mcp: true,
    projectMcpAuth: "provider-managed",
  },
  grok: {
    completionEvent: "Stop",
    completionLabel: "Grok Stop hook",
    minimumCompletionVersion: null,
    mcp: true,
    projectMcpAuth: "provider-managed",
  },
  kimi: {
    completionEvent: "Stop",
    completionLabel: "Kimi Stop hook",
    minimumCompletionVersion: "1.20.0",
    mcp: true,
    projectMcpAuth: "isolated",
  },
};

function parseCliVersion(output) {
  const match = String(output || "").match(/(?:^|\s|v)(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?/);
  return match ? `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}` : null;
}

function compareVersions(left, right) {
  const a = String(left || "0.0.0").split(".").map(Number);
  const b = String(right || "0.0.0").split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] || 0) > (b[index] || 0)) return 1;
    if ((a[index] || 0) < (b[index] || 0)) return -1;
  }
  return 0;
}

function getProviderCompatibility(provider, version, installed = true) {
  const id = String(provider || "custom").toLowerCase();
  const capability = PROVIDER_CAPABILITIES[id];
  if (!installed) {
    return {
      completionMode: "unavailable",
      completionEvent: null,
      completionMessage: "Install the CLI to enable completion detection.",
      mcpSupport: false,
      projectMcpAuth: "none",
    };
  }
  if (!capability) {
    return {
      completionMode: "fallback",
      completionEvent: null,
      completionMessage: id === "hermes"
        ? "Hermes turn notification (display.bell_on_complete), with process exit as a backstop."
        : "Custom CLI uses terminal and process-exit completion detection.",
      // Hermes manages its own servers, for every session at once.
      mcpSupport: id === "hermes",
      projectMcpAuth: id === "hermes" ? "provider-managed" : "none",
    };
  }

  const belowMinimum = capability.minimumCompletionVersion &&
    (!version || compareVersions(version, capability.minimumCompletionVersion) < 0);
  return {
    completionMode: belowMinimum ? "fallback" : "native",
    completionEvent: belowMinimum ? null : capability.completionEvent,
    completionMessage: belowMinimum
      ? `${capability.completionLabel} requires ${capability.minimumCompletionVersion}+; using terminal and process-exit detection.`
      : `${capability.completionLabel} enabled.`,
    mcpSupport: capability.mcp,
    projectMcpAuth: capability.projectMcpAuth,
  };
}

function supportsNativeLaunchOptions(provider, helpOutput) {
  const id = String(provider || "").toLowerCase();
  const help = String(helpOutput || "");
  if (id === "claude") return /--settings\b/.test(help);
  if (id === "codex") return /(?:^|\s)(?:-c|--config)(?:\s|,|$)/m.test(help);
  if (id === "kimi") return /--config-file\b/.test(help);
  return true;
}

module.exports = {
  PROVIDER_CAPABILITIES,
  compareVersions,
  getProviderCompatibility,
  parseCliVersion,
  supportsNativeLaunchOptions,
};
