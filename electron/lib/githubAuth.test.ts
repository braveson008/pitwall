import { describe, expect, it } from "vitest";
import { resolveAccountActivation } from "./githubAuth.cjs";

const accounts = (over: Array<{ login: string; active: boolean }> = []) => over;

describe("resolveAccountActivation", () => {
  it("asks when the project has no account configured", () => {
    expect(resolveAccountActivation({ record: null, accounts: [] })).toEqual({
      action: "prompt", reason: "unconfigured",
    });
  });

  it("stands aside when the user refused", () => {
    expect(resolveAccountActivation({
      record: { login: "octo", hasToken: true, rejectedAt: "2026-09-01T00:00:00Z" },
      accounts: accounts([{ login: "octo", active: false }]),
    })).toEqual({ action: "none", reason: "rejected" });
  });

  it("scopes to the project's own account without touching the active one", () => {
    // The whole point. A stored token is supplied per command by
    // getEnvironment, and GH_TOKEN overrides the active account for both git
    // and gh — so nothing global has to change for this project to use its
    // own account, and nothing outside Pitwall is disturbed.
    expect(resolveAccountActivation({
      record: { login: "octo", hasToken: true, rejectedAt: null },
      accounts: accounts([{ login: "octo", active: false }]),
    })).toEqual({ action: "scoped", login: "octo" });
  });

  it("scopes the same way when the account happens to be active already", () => {
    expect(resolveAccountActivation({
      record: { login: "octo", hasToken: true, rejectedAt: null },
      accounts: accounts([{ login: "octo", active: true }]),
    })).toEqual({ action: "scoped", login: "octo" });
  });

  it("never asks gh to switch accounts", () => {
    // Switching is machine-wide: it changes which account every terminal and
    // every other project uses, and the failure it causes elsewhere reads as
    // "Repository not found", which points at the wrong thing entirely.
    for (const active of [true, false]) {
      const decision = resolveAccountActivation({
        record: { login: "octo", hasToken: true, rejectedAt: null },
        accounts: accounts([{ login: "octo", active }]),
      });
      expect(decision.action).not.toBe("switch");
    }
  });

  it("logs in when the token is known but gh has no such account", () => {
    expect(resolveAccountActivation({
      record: { login: "octo", hasToken: true, rejectedAt: null },
      accounts: accounts([{ login: "someone-else", active: true }]),
    })).toEqual({ action: "login", login: "octo" });
  });

  it("asks again when the record is unusable", () => {
    expect(resolveAccountActivation({
      record: { login: "", hasToken: false, rejectedAt: null },
      accounts: [],
    })).toEqual({ action: "prompt", reason: "unusable" });
  });
});
