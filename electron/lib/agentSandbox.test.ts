import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// @ts-expect-error - CommonJS module without types
import { createAgentSandbox, sandboxKey } from "./agentSandbox.cjs";

let directory: string;
let home: string;
const newSandbox = () => createAgentSandbox({ directory, homeDirectory: home });

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "braveli-sandbox-"));
  home = mkdtempSync(join(tmpdir(), "braveli-home-"));
  writeFileSync(join(home, ".gitconfig"), "[pull]\n\trebase = true\n");
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

describe("environment", () => {
  it("isolates GitHub only for a project whose token is being injected", () => {
    const sandbox = newSandbox();
    // A connected account: the agent is authenticated by GH_TOKEN, so an empty
    // config directory isolates it rather than signing it out.
    expect(sandbox.environment({ projectId: "p1", isolateGitHub: true }).GH_CONFIG_DIR)
      .toBe(join(directory, "p1", "gh"));
    // None: left exactly as it was, because an empty directory with no token is
    // a signed-out agent, which is worse than a shared one.
    expect(sandbox.environment({ projectId: "p2", isolateGitHub: false }).GH_CONFIG_DIR).toBeUndefined();
  });

  it("gives every project a git global that only includes the real one", () => {
    const sandbox = newSandbox();
    const environment = sandbox.environment({ projectId: "p1" });
    expect(environment.GIT_CONFIG_GLOBAL).toBe(join(directory, "p1", "git", "config"));
    const written = readFileSync(environment.GIT_CONFIG_GLOBAL, "utf8");
    expect(written).toContain("[include]");
    // Git reads a quoted value with backslash escapes, so a Windows path is
    // written with its backslashes doubled.
    const included = /path = "(.*)"/.exec(written)?.[1]?.replace(/\\\\/g, "\\");
    expect(included).toBe(join(home, ".gitconfig"));
    // Nothing else: the sandbox states no policy of its own.
    expect(written).not.toContain("[user]");
  });

  it("keeps two projects apart", () => {
    const sandbox = newSandbox();
    const one = sandbox.environment({ projectId: "p1", isolateGitHub: true });
    const two = sandbox.environment({ projectId: "p2", isolateGitHub: true });
    expect(one.GH_CONFIG_DIR).not.toBe(two.GH_CONFIG_DIR);
    expect(one.GIT_CONFIG_GLOBAL).not.toBe(two.GIT_CONFIG_GLOBAL);
  });

  it("does not rewrite a config an agent has already added to", () => {
    const sandbox = newSandbox();
    const first = sandbox.environment({ projectId: "p1" });
    writeFileSync(first.GIT_CONFIG_GLOBAL, `${readFileSync(first.GIT_CONFIG_GLOBAL, "utf8")}[user]\n\temail = set@by.agent\n`);
    sandbox.environment({ projectId: "p1" });
    expect(readFileSync(first.GIT_CONFIG_GLOBAL, "utf8")).toContain("set@by.agent");
  });

  it("falls back to the path when a project has no id", () => {
    const sandbox = newSandbox();
    const byPath = sandbox.environment({ projectPath: "/tmp/somewhere" });
    expect(byPath.GIT_CONFIG_GLOBAL).toBe(join(directory, sandboxKey({ projectPath: "/tmp/somewhere" }), "git", "config"));
    // And nothing at all to key on is not a crash.
    expect(sandbox.environment({})).toEqual({});
  });

  it("cannot be talked out of its own directory by a project id", () => {
    const sandbox = newSandbox();
    const escape = sandbox.environment({ projectId: "../../../../etc/evil" });
    expect(escape.GIT_CONFIG_GLOBAL.startsWith(directory)).toBe(true);
    expect(escape.GIT_CONFIG_GLOBAL).not.toContain("..");
  });
});

describe("what git actually does with it", () => {
  /* The point of the file is what git makes of it, so git is asked. */
  const git = (args: string[], environment: Record<string, string>, cwd: string) =>
    execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...environment } }).trim();

  it("reads the real global through the include and writes only into the sandbox", () => {
    const sandbox = newSandbox();
    const environment = sandbox.environment({ projectId: "p1" });
    const repository = mkdtempSync(join(tmpdir(), "braveli-repo-"));
    git(["init", "-q", "."], {}, repository);

    // The user's own settings still apply.
    expect(git(["config", "--get", "pull.rebase"], environment, repository)).toBe("true");

    // An agent setting a global identity lands in the sandbox, not their file.
    git(["config", "--global", "user.email", "agent@rogue.test"], environment, repository);
    expect(readFileSync(environment.GIT_CONFIG_GLOBAL, "utf8")).toContain("agent@rogue.test");
    expect(readFileSync(join(home, ".gitconfig"), "utf8")).not.toContain("agent@rogue.test");

    // And a repository that states its own identity still wins.
    git(["config", "user.email", "real@project.test"], environment, repository);
    expect(git(["config", "user.email"], environment, repository)).toBe("real@project.test");
    rmSync(repository, { recursive: true, force: true });
  });

  it("survives a home directory with a space in it", () => {
    const spaced = mkdtempSync(join(tmpdir(), "braveli home "));
    writeFileSync(join(spaced, ".gitconfig"), "[pull]\n\trebase = true\n");
    const sandbox = createAgentSandbox({ directory, homeDirectory: spaced });
    const environment = sandbox.environment({ projectId: "p1" });
    const repository = mkdtempSync(join(tmpdir(), "braveli-repo-"));
    git(["init", "-q", "."], {}, repository);
    expect(git(["config", "--get", "pull.rebase"], environment, repository)).toBe("true");
    rmSync(repository, { recursive: true, force: true });
    rmSync(spaced, { recursive: true, force: true });
  });
});

describe("forget", () => {
  it("removes a project's sandbox and says so", () => {
    const sandbox = newSandbox();
    const environment = sandbox.environment({ projectId: "p1", isolateGitHub: true });
    expect(existsSync(environment.GIT_CONFIG_GLOBAL)).toBe(true);
    expect(sandbox.forget({ projectId: "p1" })).toBe(true);
    expect(existsSync(join(directory, "p1"))).toBe(false);
  });

  it("is quiet about a project that never had one", () => {
    expect(newSandbox().forget({ projectId: "never-existed" })).toBe(true);
    expect(newSandbox().forget({})).toBe(false);
  });

  it("takes down only the GitHub half when an account is disconnected", () => {
    const sandbox = newSandbox();
    const environment = sandbox.environment({ projectId: "p1", isolateGitHub: true });
    writeFileSync(environment.GIT_CONFIG_GLOBAL, `${readFileSync(environment.GIT_CONFIG_GLOBAL, "utf8")}[alias]\n\tlg = log --oneline\n`);
    expect(sandbox.forgetGitHub({ projectId: "p1" })).toBe(true);
    expect(existsSync(environment.GH_CONFIG_DIR)).toBe(false);
    // Whatever was set for the project is not GitHub's to take away.
    expect(readFileSync(environment.GIT_CONFIG_GLOBAL, "utf8")).toContain("lg = log --oneline");
  });

  it("leaves other projects alone", () => {
    const sandbox = newSandbox();
    sandbox.environment({ projectId: "p1" });
    const kept = sandbox.environment({ projectId: "p2" });
    sandbox.forget({ projectId: "p1" });
    expect(existsSync(kept.GIT_CONFIG_GLOBAL)).toBe(true);
  });
});

describe("gh", () => {
  it("hands gh a directory with nothing in it", () => {
    const sandbox = newSandbox();
    const environment = sandbox.environment({ projectId: "p1", isolateGitHub: true });
    // Empty is the whole point: there is no hosts file for `gh auth switch` to
    // rewrite, and no token written down anywhere.
    mkdirSync(environment.GH_CONFIG_DIR, { recursive: true });
    expect(existsSync(join(environment.GH_CONFIG_DIR, "hosts.yml"))).toBe(false);
  });
});
