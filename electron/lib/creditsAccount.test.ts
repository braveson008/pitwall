import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import credits from "./creditsAccount.cjs";

const { clearAccount, gatewayRequest, gatewayUrl, isLocalGateway, readAccount, readCreditsScreen, withCreditsProvider, writeAccount } = credits;

const fakeSafeStorage = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (text: string) => Buffer.from(`enc:${text}`),
  decryptString: (buffer: Buffer) => buffer.toString().replace(/^enc:/, ""),
});

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

describe("the stored account", () => {
  it("keeps the key encrypted on disk and reads it back", () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "pitwall-account-"));
    const context = { userDataPath: dir, safeStorage: fakeSafeStorage() };
    expect(writeAccount(context, { email: "ana@example.com", gateway: "http://localhost:8787", key: "brv_secret" })).toEqual({ persisted: true });
    const raw = readFileSync(path.join(dir, "pitwall-account.json"), "utf8");
    expect(raw).not.toContain("brv_secret");
    expect(readAccount(context)).toEqual({ email: "ana@example.com", gateway: "http://localhost:8787", key: "brv_secret" });
    clearAccount(context);
    expect(readAccount(context)).toBeNull();
  });

  it("never writes the key in the clear when safe storage is unavailable", () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "pitwall-account-"));
    const context = { userDataPath: dir, safeStorage: fakeSafeStorage(false) };
    expect(writeAccount(context, { email: "ana@example.com", gateway: "g", key: "brv_secret" })).toEqual({ persisted: false });
    expect(() => readFileSync(path.join(dir, "pitwall-account.json"))).toThrow();
    expect(readAccount(context)?.key).toBe("brv_secret");
    clearAccount(context);
    expect(readAccount(context)).toBeNull();
  });
});

describe("the gateway address", () => {
  it("is the gateway the build names, unless the environment names another", () => {
    expect(gatewayUrl({}, "https://gateway.example.com/")).toBe("https://gateway.example.com");
    expect(gatewayUrl({}, "")).toBe("");
    expect(gatewayUrl({ BRAVELI_GATEWAY_URL: "http://127.0.0.1:8787/" })).toBe("http://127.0.0.1:8787");
    expect(gatewayUrl({ BRAVELI_GATEWAY_URL: "not a url" })).toBe("");
    expect(isLocalGateway("http://localhost:8787")).toBe(true);
    expect(isLocalGateway("https://gateway.example.com")).toBe(false);
  });
});

describe("gateway requests", () => {
  it("send the key as a bearer token and return the answer", async () => {
    const seen: Array<[string, RequestInit]> = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      seen.push([url, init]);
      return new Response(JSON.stringify({ email: "ana@example.com" }), { status: 200 });
    };
    const reply = await gatewayRequest("http://localhost:8787", "/v1/account", { key: "brv_k", fetchImpl });
    expect(reply).toMatchObject({ ok: true, data: { email: "ana@example.com" } });
    expect((seen[0][1].headers as Record<string, string>).authorization).toBe("Bearer brv_k");
  });

  it("turn refusals and outages into words, without throwing", async () => {
    const refused = await gatewayRequest("http://g", "/v1/auth/start", {
      method: "POST",
      body: {},
      fetchImpl: async () => new Response(JSON.stringify({ error: { code: "slow_down", message: "Wait 20 seconds", retry_after: 20 } }), { status: 429 }),
    });
    expect(refused).toMatchObject({ ok: false, status: 429, code: "slow_down", message: "Wait 20 seconds", retryAfter: 20 });
    const down = await gatewayRequest("http://g", "/v1/account", { fetchImpl: async () => { throw new Error("offline"); } });
    expect(down).toMatchObject({ ok: false, code: "unreachable" });
    expect(await gatewayRequest("", "/v1/account")).toMatchObject({ ok: false, code: "not_available" });
  });
});

describe("a Codex launch on credits", () => {
  it("gets a provider of its own, with the key only in the environment", () => {
    const launch = withCreditsProvider(
      { command: "codex", args: ["-c", "check_for_update_on_startup=false", "--model", "deepseek-chat"], display: "codex" },
      { gateway: "http://localhost:8787", key: "brv_secret" },
    );
    expect(launch.args).toContain("model_provider=pitwall");
    expect(launch.args.join(" ")).toContain('base_url="http://localhost:8787/v1"');
    expect(launch.args.join(" ")).toContain('wire_api="responses"');
    expect(launch.args.join(" ")).not.toContain("brv_secret");
    expect(launch.display).not.toContain("brv_secret");
    expect(launch.env).toEqual({ PITWALL_KEY: "brv_secret" });
  });
});

describe("reading the gateway's refusals off a CLI's screen", () => {
  it("knows each one", () => {
    expect(readCreditsScreen("error: This period's included usage and overage cap are used up.")).toBe("exhausted");
    expect(readCreditsScreen("This Pitwall account has no active plan, so model usage is not available.")).toBe("no-plan");
    expect(readCreditsScreen("This Pitwall key is not valid or has been revoked.")).toBe("signed-out");
    expect(readCreditsScreen("Thinking…")).toBeNull();
  });
});
