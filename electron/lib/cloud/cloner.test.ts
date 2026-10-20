import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import cloner from "./cloner.cjs";

const { checkoutProject, planCheckout, remoteOf, safeRemoteUrl } = cloner;

const temp = (name: string) => fs.mkdtempSync(path.join(os.tmpdir(), `pitwall-${name}-`));

function remoteRepo() {
  const root = temp("remote");
  const bare = path.join(root, "shop.git");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare]);
  const work = path.join(root, "work");
  execFileSync("git", ["clone", "-q", bare, work]);
  fs.writeFileSync(path.join(work, "README.md"), "# shop\n");
  execFileSync("git", ["-C", work, "add", "."]);
  execFileSync("git", ["-C", work, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
  execFileSync("git", ["-C", work, "push", "-q", "origin", "main"]);
  return pathToFileURL(bare).href;
}

describe("cloner", () => {
  it("clones a project into the projects folder", async () => {
    const url = remoteRepo();
    const projectsRoot = temp("projects");
    const result = await checkoutProject({ name: "shop", remoteUrl: url }, { projectsRoot, knownPaths: [] });
    expect(result).toEqual({ ok: true, action: "clone", path: path.join(projectsRoot, "shop") });
    expect(fs.readFileSync(path.join(projectsRoot, "shop", "README.md"), "utf8").replace(/\r\n/g, "\n")).toBe("# shop\n");
  });

  it("adopts a checkout of the same repository that is already on this computer", async () => {
    const url = remoteRepo();
    const elsewhere = path.join(temp("elsewhere"), "my-shop");
    execFileSync("git", ["clone", "-q", url, elsewhere]);
    const projectsRoot = temp("projects");
    const plan = await planCheckout({ name: "shop", remoteUrl: url }, { projectsRoot, knownPaths: [path.join(path.dirname(elsewhere), "other")] });
    expect(plan).toEqual({ action: "adopt", path: elsewhere });
    const result = await checkoutProject({ name: "shop", remoteUrl: url }, { projectsRoot, knownPaths: [path.join(path.dirname(elsewhere), "other")] });
    expect(result).toEqual({ ok: true, action: "adopt", path: elsewhere });
    expect(fs.readdirSync(projectsRoot)).toEqual([]);
  });

  it("finds a checkout in the usual places people keep code, not just the projects folder", async () => {
    const url = remoteRepo();
    const home = temp("home");
    const existing = path.join(home, "code", "my-shop");
    fs.mkdirSync(path.dirname(existing), { recursive: true });
    execFileSync("git", ["clone", "-q", url, existing]);
    const projectsRoot = path.join(home, "Projects");
    expect(await planCheckout({ name: "shop", remoteUrl: url }, { projectsRoot, knownPaths: [], home })).toEqual({ action: "adopt", path: existing });
  });

  it("picks a free folder name when the obvious one is taken by something else", async () => {
    const url = remoteRepo();
    const projectsRoot = temp("projects");
    fs.mkdirSync(path.join(projectsRoot, "shop"));
    fs.writeFileSync(path.join(projectsRoot, "shop", "unrelated.txt"), "x");
    expect(await planCheckout({ name: "shop", remoteUrl: url }, { projectsRoot, knownPaths: [] })).toEqual({ action: "clone", path: path.join(projectsRoot, "shop-2") });
  });

  it("clones with the git settings it is given, such as the project's sign-in", async () => {
    const url = remoteRepo();
    const projectsRoot = temp("projects");
    // Only reachable when the given settings are used: a stand-in for an injected credential helper.
    const env = { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: `url.${url}.insteadOf`, GIT_CONFIG_VALUE_0: "https://example.invalid/acme/shop.git" };
    const result = await checkoutProject({ name: "shop", remoteUrl: "https://example.invalid/acme/shop.git" }, { projectsRoot, knownPaths: [], home: temp("home"), env });
    expect(result).toMatchObject({ ok: true, action: "clone" });
  });

  it("says what is needed when the repository can't be reached", async () => {
    const projectsRoot = temp("projects");
    const result = await checkoutProject({ name: "gone", remoteUrl: "file:///nonexistent/gone.git" }, { projectsRoot, knownPaths: [] });
    expect(result).toMatchObject({ ok: false, code: "not-found", message: expect.stringMatching(/couldn't find/i) });
    expect(fs.existsSync(path.join(projectsRoot, "gone"))).toBe(false);
  });

  it("refuses a project with no remote, and never stores credentials from a remote URL", async () => {
    expect(await planCheckout({ name: "x", remoteUrl: "" }, { projectsRoot: temp("projects"), knownPaths: [] })).toEqual({ action: "needs-remote" });
    expect(safeRemoteUrl("https://user:ghp_secret@github.com/o/r.git")).toBe("https://github.com/o/r.git");
    expect(safeRemoteUrl("git@github.com:o/r.git")).toBe("git@github.com:o/r.git");
    expect(safeRemoteUrl("/local/path.git")).toBe("");
  });

  it("reads a checkout's remote", async () => {
    const url = remoteRepo();
    const checkout = path.join(temp("read"), "shop");
    execFileSync("git", ["clone", "-q", url, checkout]);
    expect(await remoteOf(checkout)).toBe(url);
    expect(await remoteOf(temp("plain"))).toBe("");
  });
});
