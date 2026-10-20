import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createAnalytics } = require("./analytics.cjs");

let dir = "";
const file = () => join(dir, "analytics.json");
const sent = (fetchImpl: ReturnType<typeof vi.fn>) => JSON.parse(fetchImpl.mock.calls[0][1].body);

const make = (over: Record<string, unknown> = {}) => {
  const fetchImpl = vi.fn(async () => ({ ok: true }));
  const analytics = createAnalytics({
    filePath: file(), apiKey: "phc_test", appVersion: "0.1.0", osVersion: "26.5.1", fetchImpl, ...over,
  });
  analytics.setEnabled(true);
  return { analytics, fetchImpl };
};

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "pitwall-analytics-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("identity", () => {
  it("mints an anonymous install id and keeps it across restarts", () => {
    const first = make().analytics.installId();
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(make().analytics.installId()).toBe(first);
  });

  it("stores nothing but the id and the choice", () => {
    make();
    expect(Object.keys(JSON.parse(readFileSync(file(), "utf8")))).toEqual(["installId", "enabled", "decided"]);
  });
});

describe("consent", () => {
  it("reports from the first launch unless switched off", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true }));
    const analytics = createAnalytics({ filePath: file(), apiKey: "phc_test", fetchImpl });
    expect(analytics.isEnabled()).toBe(true);
    expect(await analytics.capture("app_launched")).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("sends nothing once switched off, and remembers that", async () => {
    const { analytics, fetchImpl } = make();
    analytics.setEnabled(false);
    expect(await analytics.capture("app_launched")).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(createAnalytics({ filePath: file() }).isEnabled()).toBe(false);   // survives a restart
  });

  it("sends nothing without a project key, so forks and dev builds stay silent", async () => {
    const { analytics, fetchImpl } = make({ apiKey: "" });
    expect(await analytics.capture("app_launched")).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("what leaves the machine", () => {
  it("drops any property that is not on the allowlist", async () => {
    // The guarantee: a future call site cannot leak a path by adding a field.
    const { analytics, fetchImpl } = make();
    await analytics.capture("session_started", {
      agent: "claude",
      projectPath: "/Users/someone/work/secret-client",
      taskTitle: "Fix the billing bug for ACME",
      branch: "feature/acme-billing",
    });
    expect(sent(fetchImpl).properties).toEqual({ agent: "claude", app_version: "0.1.0", os_version: "26.5.1" });
  });

  it("refuses an event name that is not on the list", async () => {
    const { analytics, fetchImpl } = make();
    expect(await analytics.capture("prompt_submitted", { agent: "claude" })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports an agent it does not recognise as \"custom\", not by name", async () => {
    // Stronger than the truncation this replaces. Cutting a string to 64
    // characters stops a payload and does nothing about a name: an agent added
    // through "Add agent" is named by the person adding it, so "Acme Internal
    // Agent" fitted comfortably inside the old limit and went out verbatim.
    const { analytics, fetchImpl } = make();
    await analytics.capture("session_started", { agent: "Acme Internal Agent" });
    expect(sent(fetchImpl).properties.agent).toBe("custom");
  });

  it("still refuses a long string, which is now clamped rather than cut", async () => {
    const { analytics, fetchImpl } = make();
    await analytics.capture("session_started", { agent: "x".repeat(500) });
    expect(sent(fetchImpl).properties.agent).toBe("custom");
  });

  it("keeps the agents it does recognise, which is the point of the field", async () => {
    const { analytics, fetchImpl } = make();
    await analytics.capture("session_started", { agent: "Codex" });
    expect(sent(fetchImpl).properties.agent).toBe("codex");
  });

  it("clamps an enumerated value instead of passing text through", async () => {
    const { analytics, fetchImpl } = make();
    await analytics.capture("agent_gate_hit", { gate_kind: "waiting on jane@acme.com" });
    expect(sent(fetchImpl).properties.gate_kind).toBe("other");
  });

  it("keeps an enumerated value it recognises", async () => {
    // Separate runs: `sent` reads the first request, so two captures against
    // one mock would both assert on the same body.
    const { analytics, fetchImpl } = make();
    await analytics.capture("agent_gate_hit", { gate_kind: "trust" });
    expect(sent(fetchImpl).properties.gate_kind).toBe("trust");
  });

  it("carries the install id, version and os so retention can be read", async () => {
    const { analytics, fetchImpl } = make();
    await analytics.capture("app_launched");
    const body = sent(fetchImpl);
    expect(body.distinct_id).toBe(analytics.installId());
    expect(body.properties).toMatchObject({ app_version: "0.1.0", os_version: "26.5.1" });
  });
});

describe("failure", () => {
  it("never throws when the network is gone", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("offline"); });
    const { analytics } = make({ fetchImpl });
    await expect(analytics.capture("app_launched")).resolves.toBe(false);
  });

  it("never throws when the settings file cannot be written", () => {
    expect(() => createAnalytics({ filePath: "/proc/nope/analytics.json", apiKey: "k" })).not.toThrow();
  });
});

describe("the allowlists are the guarantee", () => {
  const dir = mkdtempSync(join(tmpdir(), "pitwall-analytics-guard-"));
  const sent: Array<Record<string, unknown>> = [];
  const analytics = createAnalytics({
    filePath: join(dir, "analytics.json"),
    apiKey: "phc_test",
    fetchImpl: async (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body));
      return { ok: true };
    },
  });

  analytics.setEnabled(true);

  // The point of the allowlist: a future call site cannot leak a path or a
  // title by adding one extra field, because the field is dropped rather than
  // reviewed.
  it("drops any property not on the list", async () => {
    sent.length = 0;
    await analytics.capture("session_started", {
      agent: "claude",
      file_path: "/Users/someone/secret-repo/src/billing.ts",
      prompt: "fix the payment bug in the enterprise contract flow",
      branch: "feature/acme-corp-migration",
    } as Record<string, string>);
    const properties = sent[0]?.properties as Record<string, unknown>;
    expect(properties.agent).toBe("claude");
    expect(properties.file_path).toBeUndefined();
    expect(properties.prompt).toBeUndefined();
    expect(properties.branch).toBeUndefined();
  });

  it("drops any event not on the list", async () => {
    sent.length = 0;
    expect(await analytics.capture("prompt_text", { agent: "claude" })).toBe(false);
    expect(sent).toHaveLength(0);
  });

  // Every property that can carry a string is capped, so even an allowlisted
  // key cannot become a smuggling route for a long value.
  it("truncates a string that is longer than it has any business being", async () => {
    sent.length = 0;
    await analytics.capture("session_started", { agent: "x".repeat(500) });
    expect(String((sent[0]?.properties as Record<string, string>).agent).length).toBeLessThanOrEqual(64);
  });

  // The outcome events are the half that was missing: six events said people
  // arrived and started things, and nothing about whether any of it worked.
  it("accepts the outcome events", async () => {
    for (const event of ["session_completed", "session_failed", "council_finished", "pull_request_opened"]) {
      expect(await analytics.capture(event, { outcome: "finished" })).toBe(true);
    }
  });
});
