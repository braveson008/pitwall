import { describe, expect, it } from "vitest";
import worktrees from "./worktrees.cjs";

const { branchToRestore } = worktrees;

describe("branchToRestore", () => {
  const agent = { name: "feature/ACME-2687-customer-vip-tag", containsRequested: true, committedAt: 200, checkedOut: false };

  it("restores the branch the agent moved its work to", () => {
    expect(branchToRestore({ requested: "acme-2687", ticket: "ACME-2687", candidates: [agent] })).toBe("feature/ACME-2687-customer-vip-tag");
  });

  it("keeps Pitwall's branch when it holds work the other does not", () => {
    expect(branchToRestore({ requested: "acme-2687", ticket: "ACME-2687", candidates: [{ ...agent, containsRequested: false }] })).toBe("acme-2687");
  });

  it("ignores branches of another ticket, and ones checked out elsewhere", () => {
    expect(branchToRestore({ requested: "acme-2687", ticket: "ACME-2687", candidates: [{ ...agent, name: "feature/ACME-26870-x" }, { ...agent, name: "fix/ACME-268-y" }] })).toBe("acme-2687");
    expect(branchToRestore({ requested: "acme-2687", ticket: "ACME-2687", candidates: [{ ...agent, checkedOut: true }] })).toBe("acme-2687");
  });

  it("takes the most recently committed of several", () => {
    const older = { ...agent, name: "feature/ACME-2687-first-try", committedAt: 100 };
    expect(branchToRestore({ requested: "acme-2687", ticket: "ACME-2687", candidates: [older, agent] })).toBe("feature/ACME-2687-customer-vip-tag");
  });

  it("leaves a session without a ticket alone", () => {
    expect(branchToRestore({ requested: "claude/session-3", candidates: [{ ...agent, name: "feature/session-3" }] })).toBe("claude/session-3");
    expect(branchToRestore({ requested: "claude/session-3", ticket: "", candidates: [{ ...agent, name: "feature/session-3" }] })).toBe("claude/session-3");
  });
});

describe("branchSlug", () => {
  const { branchSlug } = worktrees;

  it("never ends or starts a folder name with a dot", () => {
    expect(branchSlug("release/v1.")).toBe("release-v1");
    expect(branchSlug(".hidden")).toBe("hidden");
    expect(branchSlug("...")).toBe("session");
  });

  it("steers clear of names Windows reserves", () => {
    expect(branchSlug("CON")).toBe("con-branch");
    expect(branchSlug("aux.fix")).toBe("aux.fix-branch");
    expect(branchSlug("com1")).toBe("com1-branch");
    expect(branchSlug("console")).toBe("console");
  });

  it("does not leave a trailing dot or dash after cutting a long name", () => {
    expect(branchSlug(`${"a".repeat(79)}.b`)).toBe("a".repeat(79));
  });
});

describe("retryWhileLocked", () => {
  const { retryWhileLocked } = worktrees;
  const wait = async () => {};

  it("tries again while a file is in use, then reports the outcome", async () => {
    const results = [
      { ok: false, stderr: "error: failed to delete 'C:/wt/x': Permission denied" },
      { ok: true, stderr: "" },
    ];
    let calls = 0;
    expect(await retryWhileLocked(async () => results[calls++], { wait })).toEqual({ ok: true, stderr: "" });
    expect(calls).toBe(2);
  });

  it("gives up after the last attempt", async () => {
    let calls = 0;
    const locked = { ok: false, stderr: "Directory not empty" };
    expect(await retryWhileLocked(async () => { calls += 1; return locked; }, { wait, attempts: 3 })).toBe(locked);
    expect(calls).toBe(3);
  });

  it("does not retry a refusal that waiting cannot fix", async () => {
    let calls = 0;
    const dirty = { ok: false, stderr: "fatal: 'x' contains modified or untracked files, use --force to delete it" };
    await retryWhileLocked(async () => { calls += 1; return dirty; }, { wait });
    expect(calls).toBe(1);
  });
});
