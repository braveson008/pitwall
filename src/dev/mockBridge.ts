/**
 * A fake main process, so the renderer can be worked on in a browser.
 *
 * Pitwall's UI normally needs a packaged Electron app and real repositories to
 * show anything, which makes iterating on a panel like the review changeset
 * slow enough that it does not happen. This stands in for `window.braveli` with
 * fixed data, reached at `?mock`.
 *
 * Development only, and imported dynamically so it is never part of a release
 * bundle. Everything in it is invented — no real project or ticket names.
 */

const BASE = "9f2c41ab6d3e";

const mockScheduleJobs: ScheduleJob[] = [];

const FILES: BraveliChangedFile[] = [
  { path: "src/pricing/currencyTotals.ts", from: null, status: "modified", binary: false, additions: 64, deletions: 18 },
  { path: "src/pricing/roundingRules.ts", from: null, status: "added", binary: false, additions: 41, deletions: 0 },
  { path: "src/pricing/legacyRounding.ts", from: null, status: "deleted", binary: false, additions: 0, deletions: 27 },
  { path: "src/pricing/format.ts", from: "src/pricing/formatMoney.ts", status: "renamed", binary: false, additions: 6, deletions: 4 },
  { path: "src/pricing/currencyTotals.test.ts", from: null, status: "modified", binary: false, additions: 22, deletions: 2 },
  { path: "docs/pricing-notes.md", from: null, status: "added", binary: false, additions: 9, deletions: 0, untracked: true },
  { path: "assets/currency-flags.png", from: null, status: "modified", binary: true, additions: 0, deletions: 0 },
];

const PATCHES: Record<string, string> = {
  "src/pricing/currencyTotals.ts": `@@ -12,10 +12,14 @@ export function totalFor(lines: Line[], currency: Currency) {
 export function totalFor(lines: Line[], currency: Currency) {
-  let total = 0;
-  for (const line of lines) {
-    total += line.unitPrice * line.quantity;
-  }
-  return Math.round(total * 100) / 100;
+  // Sum in minor units. Accumulating floats and rounding once at the end lets a
+  // half-cent from each line drift into the total, which is how an order of
+  // twelve items ends up a penny short of the sum of its parts.
+  let minorUnits = 0;
+  for (const line of lines) {
+    minorUnits += toMinorUnits(line.unitPrice, currency) * line.quantity;
+  }
+  return fromMinorUnits(minorUnits, currency);
 }
@@ -30,6 +34,12 @@ function applyDiscount(total: number, discount: Discount) {
 function applyDiscount(total: number, discount: Discount) {
   if (discount.kind === "percentage") {
-    return total * (1 - discount.value / 100);
+    // Percentage discounts round half up, matching what the invoice shows.
+    return roundHalfUp(total * (1 - discount.value / 100));
   }
   return total - discount.value;
 }`,
  "src/pricing/roundingRules.ts": `@@ -0,0 +1,12 @@
+/**
+ * Rounding, in one place.
+ *
+ * Three call sites each had their own idea of what "round" meant, and two of
+ * them disagreed with the invoice.
+ */
+export function roundHalfUp(value: number): number {
+  return Math.sign(value) * Math.round(Math.abs(value) * 100) / 100;
+}
+
+export const MINOR_UNITS: Record<string, number> = { JPY: 1, USD: 100, EUR: 100 };`,
  "src/pricing/legacyRounding.ts": `@@ -1,9 +0,0 @@
-// Superseded by roundingRules.ts.
-export function oldRound(value: number) {
-  return Math.round(value * 100) / 100;
-}
-
-export function oldRoundUp(value: number) {
-  return Math.ceil(value * 100) / 100;
-}`,
  "src/pricing/format.ts": `@@ -1,6 +1,8 @@
-import { oldRound } from "./legacyRounding";
+import { roundHalfUp } from "./roundingRules";
 
 export function formatMoney(value: number, currency: Currency) {
-  return new Intl.NumberFormat("en", { style: "currency", currency }).format(oldRound(value));
+  return new Intl.NumberFormat("en", { style: "currency", currency }).format(roundHalfUp(value));
 }`,
  "src/pricing/currencyTotals.test.ts": `@@ -18,6 +18,26 @@ describe("totalFor", () => {
   });
 
+  it("does not lose a penny across many lines", () => {
+    const lines = Array.from({ length: 12 }, () => ({ unitPrice: 0.125, quantity: 1 }));
+    expect(totalFor(lines, "USD")).toBe(1.5);
+  });
+
+  it("rounds a percentage discount the way the invoice does", () => {
+    expect(applyDiscount(10.005, { kind: "percentage", value: 0 })).toBe(10.01);
+  });
+
   it("handles an empty basket", () => {
     expect(totalFor([], "USD")).toBe(0);
   });`,
  "docs/pricing-notes.md": `+# Pricing notes
+
+Totals are accumulated in minor units and converted back once, so per-line
+rounding cannot drift into the total.
+
+JPY has no minor unit. Anything dividing by 100 unconditionally is wrong.`,
};

/** Untracked: in the worktree, not in any commit, so not in the pull request. */
const UNTRACKED: BraveliChangedFile[] = [
  { path: ".braveli/council/council-1787490087426-j298re/thread.md", from: null, status: "added", binary: false, additions: 357, deletions: 0, untracked: true },
  { path: ".braveli/council/council-1787490087426-j298re/stage-1.md", from: null, status: "added", binary: false, additions: 99, deletions: 0, untracked: true },
  { path: ".braveli/council/council-1787490087426-j298re/task.md", from: null, status: "added", binary: false, additions: 32, deletions: 0, untracked: true },
  { path: "graphify-out/.graphify_root", from: null, status: "added", binary: false, additions: 1, deletions: 0, untracked: true },
  { path: "graphify-out/.graphify_detect.json", from: null, status: "added", binary: false, additions: 1, deletions: 0, untracked: true },
];

const CHANGESET: BraveliChangeset = {
  ok: true,
  base: BASE,
  worktreePath: "/tmp/checkout-service/worktrees/pay-118",
  files: FILES,
  untrackedFiles: UNTRACKED,
  additions: FILES.reduce((total, file) => total + file.additions, 0),
  deletions: FILES.reduce((total, file) => total + file.deletions, 0),
};

const EMPTY_CHANGESET: BraveliChangeset = { ok: true, base: BASE, files: [], untrackedFiles: [], additions: 0, deletions: 0 };

/** Seeds the stores the app reads at first render, then fakes the bridge. */
export function installMockBridge() {
  const now = new Date().toISOString();
  const projectId = "mock-checkout";

  localStorage.setItem("braveli-onboarded", "yes");
  localStorage.setItem("braveli-active-project", projectId);
  localStorage.setItem(
    "braveli-projects",
    JSON.stringify([
      {
        id: projectId, name: "checkout-service", path: "/tmp/checkout-service", branch: "main",
        status: "active", accent: "#6f6ae8", health: 92, openSessions: 0, queuedTasks: 1,
        lastCommit: "Sum in minor units", ci: "passing", sessions: [], queue: [], timeline: [],
      },
    ]),
  );
  localStorage.setItem(
    "braveli-workspace-state",
    JSON.stringify({
      version: 1,
      projects: [{ id: projectId, name: "checkout-service", path: "/tmp/checkout-service", defaultBranch: "main", providerIds: ["claude"], createdAt: now, updatedAt: now }],
      tasks: [
        {
          id: "mock-task-1", identifier: "pay-118", projectId, worktree: "pay-118",
          title: "Multi-currency totals are a penny short",
          description: "Baskets of more than ten lines total a penny below the sum of their lines. Per-line rounding is drifting into the total.",
          status: "review", priority: "high", assignedAgent: "claude",
          relatedFiles: FILES.map((file) => file.path), createdAt: now, updatedAt: now,
          completionSummary: {
            what: "Totals now accumulate in minor units and convert back once.",
            how: "Rounding moved behind one helper; the three call sites that disagreed with the invoice now share it.",
            components: FILES.slice(0, 3).map((file) => file.path),
          },
        },
        {
          id: "mock-task-2", identifier: "pay-140", projectId, worktree: "pay-140",
          title: "Retry the payment webhook on a 502",
          description: "A gateway restart drops the confirmation and the order stays pending.",
          status: "review", priority: "medium", assignedAgent: "codex",
          relatedFiles: [], createdAt: now, updatedAt: now,
          completionSummary: { what: "Reported complete.", how: "No changes were written to the branch.", components: [] },
        },
      ],
      contextEntries: [], contextSnapshots: [], sessions: [], activity: [], councilRuns: [], compareRuns: [],
    }),
  );

  /**
 * A stand-in catalogue, big enough to show what 350 plugins actually look like
 * without being 350 invented names. Every figure here is made up.
 */
const MOCK_PLUGINS: AgentPlugin[] = [
  {
    pluginId: "design-tools@studio-official", name: "design-tools", marketplace: "studio-official",
    description: "Read a design file, generate components from a frame, and keep code and design in step. Includes the design MCP server and twelve skills for the workflows people actually repeat.",
    version: "2.2.96", author: "Studio", installs: 175055, installed: true, enabled: true,
    tokens: { alwaysOn: 2074, onInvoke: 40000 },
    components: {
      skills: [
        { name: "design-to-code", alwaysOn: 190, onInvoke: 1600 },
        { name: "generate-library", alwaysOn: 260, onInvoke: 8400 },
        { name: "implement-motion", alwaysOn: 140, onInvoke: 8400 },
      ],
      mcpServers: [{ name: "design", alwaysOn: null, onInvoke: null }],
      commands: [], agents: [], hooks: [], lspServers: [],
    },
  },
  {
    pluginId: "frontend-review@studio-official", name: "frontend-review", marketplace: "studio-official",
    description: "Guidance for distinctive, intentional visual design when building new UI or reshaping an existing one.",
    version: "1.4.0", author: "Studio", installs: 1193335, installed: true, enabled: true,
    tokens: { alwaysOn: 83, onInvoke: 9200 },
    components: { skills: [{ name: "frontend-design", alwaysOn: 83, onInvoke: 9200 }], mcpServers: [], commands: [], agents: [], hooks: [], lspServers: [] },
  },
  {
    pluginId: "browser-drive@studio-official", name: "browser-drive", marketplace: "studio-official",
    description: "Drive a real browser: click through a flow, fill a form, read the console, capture what happened.",
    version: "3.1.2", author: "Studio", installs: 88400, installed: false, enabled: false,
    tokens: { alwaysOn: 640, onInvoke: 14200 },
    components: {
      skills: [{ name: "browser-drive", alwaysOn: 640, onInvoke: 14200 }],
      mcpServers: [{ name: "browser", alwaysOn: null, onInvoke: null }],
      commands: [], agents: [], hooks: [], lspServers: [],
    },
  },
  {
    pluginId: "error-tracker@studio-official", name: "error-tracker", marketplace: "studio-official",
    description: "Pull the stack trace behind a production error and the release that introduced it.",
    version: "0.9.1", author: "Tracker Co", installs: 42100, installed: false, enabled: false,
    tokens: { alwaysOn: 310, onInvoke: 5100 },
    components: { skills: [{ name: "triage-error", alwaysOn: 310, onInvoke: 5100 }], mcpServers: [{ name: "tracker", alwaysOn: null, onInvoke: null }], commands: [], agents: [], hooks: [], lspServers: [] },
  },
  {
    pluginId: "api-security@partner", name: "api-security", marketplace: "partner",
    description: "Audit an OpenAPI spec, find the risks that matter, and apply the fixes it can prove.",
    version: "1.0.0", author: "Partner", installs: 2713, installed: false, enabled: false,
    tokens: { alwaysOn: 1081, onInvoke: 25462 },
    components: {
      skills: [
        { name: "spec-audit", alwaysOn: 532, onInvoke: 3579 },
        { name: "spec-scan", alwaysOn: 610, onInvoke: 6803 },
        { name: "generate-spec", alwaysOn: 761, onInvoke: 41225 },
      ],
      mcpServers: [], commands: [], agents: [], hooks: [], lspServers: [],
    },
  },
  {
    pluginId: "calendar@partner", name: "calendar", marketplace: "partner",
    description: "Read and write a calendar the agent is signed in to.",
    version: "11c74d6b", author: "Partner", installs: null, installed: false, enabled: false,
    category: "Productivity", needsAuth: true, installable: true,
    components: { skills: [{ name: "calendar-read", alwaysOn: 120, onInvoke: 900 }], mcpServers: [], commands: [], agents: [], hooks: [], lspServers: [] },
  },
  {
    pluginId: "internal-only@partner", name: "internal-only", marketplace: "partner",
    description: "Listed by the marketplace but not installable from here.",
    version: "0.2.0", author: "Partner", installs: null, installed: false, enabled: false,
    installable: false,
    components: { skills: [], mcpServers: [], commands: [], agents: [], hooks: [], lspServers: [] },
  },
];

function mockExtensions(provider: string): AgentExtensions {
  const plugins = provider === "codex" ? MOCK_PLUGINS.slice(3) : MOCK_PLUGINS;
  const skills = plugins.flatMap((plugin) =>
    (plugin.components?.skills ?? []).map((skill) => ({
      name: skill.name, pluginId: plugin.pluginId, pluginName: plugin.name, marketplace: plugin.marketplace,
      installed: plugin.installed, enabled: plugin.enabled,
      alwaysOn: skill.alwaysOn, onInvoke: skill.onInvoke,
      siblings: plugin.components?.skills?.length ?? 1,
    })),
  );
  const mcpServers = plugins.flatMap((plugin) =>
    (plugin.components?.mcpServers ?? []).map((server) => ({
      name: server.name, pluginId: plugin.pluginId, pluginName: plugin.name,
      marketplace: plugin.marketplace, installed: plugin.installed, viaPlugin: true,
    })),
  );
  return { ok: true, provider, installed: true, supported: true, plugins, skills, mcpServers };
}

  const noop = async () => ({ ok: true });
  window.braveli = {
    ...(window.braveli ?? {}),
    getAppVersion: async () => ({ version: "0.1.5-mock", packaged: false, installation: { ok: true } }),
    getUpdateState: async () => ({ status: "current", currentVersion: "0.1.5-mock", availableVersion: null, progress: 0, message: "Pitwall is up to date" }),
    onUpdateStatus: () => () => {},
    getLicence: async () => ({ record: { installedAt: now }, checkoutUrl: "", enforced: false }),
    // The second task deliberately has nothing to show, so the empty state is
    // as easy to look at as the populated one.
    getTaskChangeset: async ({ branch }: { branch: string }) =>
      branch === "pay-118" ? CHANGESET : EMPTY_CHANGESET,
    getTaskFileDiff: async ({ filePath }: { filePath: string }) => ({ ok: true, diff: PATCHES[filePath] ?? "" }),
    openPath: noop, openExternalUrl: noop, listEditors: async () => ({ ok: true, editors: [] }),
    listAgentExtensions: async ({ provider }: { provider: string }) => mockExtensions(provider),
    // The real registry, so the catalogue can be looked at as it will actually
    // be. The shaping is duplicated in miniature here rather than imported:
    // the real one is CommonJS in the main process and will not load in a page.
    searchMcpRegistry: async ({ query }: { query: string }) => {
      const url = new URL("https://registry.modelcontextprotocol.io/v0/servers");
      url.searchParams.set("limit", "100");
      if (query) url.searchParams.set("search", query);
      const payload = await (await fetch(url)).json();
      const seen = new Set<string>();
      const servers: RegistryMcpServer[] = [];
      for (const entry of payload.servers ?? []) {
        const meta = entry?._meta?.["io.modelcontextprotocol.registry/official"] ?? {};
        const sv = entry?.server;
        if (!sv?.name || meta.isLatest === false || seen.has(sv.name)) continue;
        seen.add(sv.name);
        const slash = sv.name.indexOf("/");
        const remote = (sv.remotes ?? [])[0];
        const pkg = (sv.packages ?? []).find((p: { registryType?: string }) => p.registryType === "npm" || p.registryType === "pypi");
        const launch = remote
          ? { kind: "remote" as const, transport: remote.type === "sse" ? ("sse" as const) : ("http" as const), url: remote.url }
          : pkg
            ? {
                kind: "package" as const, transport: "stdio" as const,
                command: pkg.registryType === "npm" ? "npx" : "uvx",
                args: [...(pkg.registryType === "npm" ? ["-y"] : []), pkg.version ? `${pkg.identifier}@${pkg.version}` : pkg.identifier],
                env: (pkg.environmentVariables ?? []).map((e: { name: string }) => ({ name: e.name, description: "", secret: true })),
              }
            : null;
        servers.push({
          id: sv.name,
          name: slash > 0 ? sv.name.slice(slash + 1) : sv.name,
          publisher: slash > 0 ? sv.name.slice(0, slash) : "",
          title: sv.title || (slash > 0 ? sv.name.slice(slash + 1) : sv.name),
          description: sv.description ?? "",
          version: sv.version ?? "",
          websiteUrl: sv.websiteUrl ?? "",
          launch,
          npmPackage:
            launch?.kind === "package" && launch.command === "npx"
              ? (() => { const spec = launch.args.find((a) => !a.startsWith("-")) ?? ""; const at = spec.lastIndexOf("@"); return at > 0 ? spec.slice(0, at) : spec; })()
              : null,
          installable: Boolean(launch),
          needsEnv: (launch && "env" in launch ? launch.env ?? [] : []).length > 0,
        });
      }
      // Real weekly downloads, so the preview ranks the way the product does.
      const scoped = servers.filter((s) => s.npmPackage?.startsWith("@")).slice(0, 20);
      const plain = servers.map((s) => s.npmPackage).filter((n): n is string => typeof n === "string" && n.length > 0 && !n.startsWith("@"));
      const counts = new Map<string, number>();
      await Promise.all([
        plain.length
          ? fetch(`https://api.npmjs.org/downloads/point/last-week/${plain.slice(0, 100).join(",")}`)
              .then((r) => r.json())
              .then((d) => { for (const [k, v] of Object.entries(d ?? {})) { const n = (v as { downloads?: number })?.downloads; if (Number.isFinite(n)) counts.set(k, n as number); } })
              .catch(() => {})
          : Promise.resolve(),
        ...scoped.map((s) =>
          fetch(`https://api.npmjs.org/downloads/point/last-week/${s.npmPackage}`)
            .then((r) => r.json())
            .then((d) => { if (Number.isFinite(d?.downloads)) counts.set(s.npmPackage!, d.downloads); })
            .catch(() => {}),
        ),
      ]);
      for (const s of servers) {
        const n = s.npmPackage ? counts.get(s.npmPackage) : undefined;
        if (Number.isFinite(n)) (s as { weeklyDownloads?: number }).weeklyDownloads = n;
      }
      servers.sort((a, b) => (b.weeklyDownloads ?? -1) - (a.weeklyDownloads ?? -1));
      return { ok: true, servers };
    },
    // The schedule, in memory. Enough to work on the screen in a browser:
    // jobs persist for the page's lifetime and nothing wakes anything.
    listSchedule: async () => ({ ok: true, jobs: mockScheduleJobs }),
    saveScheduleJob: async (payload: Partial<ScheduleJob>) => {
      const id = String(payload.id || `mock-job-${mockScheduleJobs.length + 1}`);
      const job: ScheduleJob = {
        id,
        hour: Number(payload.hour ?? 13),
        minute: Number(payload.minute ?? 0),
        prompt: String(payload.prompt || "Do the thing"),
        projectId: String(payload.projectId || ""),
        agent: String(payload.agent || "Codex"),
        days: Array.isArray(payload.days) ? payload.days : [],
        everyHours: Number(payload.everyHours) || 0,
        enabled: payload.enabled !== false,
        lastRunDate: String(payload.lastRunDate || ""),
        history: payload.history ?? [],
      };
      const index = mockScheduleJobs.findIndex((item) => item.id === id);
      if (index >= 0) mockScheduleJobs[index] = job;
      else mockScheduleJobs.push(job);
      return { ok: true, job };
    },
    deleteScheduleJob: async ({ id }: { id: string }) => {
      const index = mockScheduleJobs.findIndex((item) => item.id === id);
      if (index >= 0) mockScheduleJobs.splice(index, 1);
      return { ok: true };
    },
    recordScheduleRun: async ({ id, entry }: { id: string; entry: ScheduleRun }) => {
      const job = mockScheduleJobs.find((item) => item.id === id);
      if (job) job.history = [entry, ...job.history];
      return { ok: true, run: entry };
    },
    scheduleReady: async () => ({ ok: true }),
    onScheduleFire: () => () => {},
    installMcpServer: async () => ({ ok: true, message: "Nothing was really installed — this is the mock bridge." }),
    changeAgentExtension: async () => ({ ok: true, message: "Nothing was really installed — this is the mock bridge." }),
  } as unknown as typeof window.braveli;
}
