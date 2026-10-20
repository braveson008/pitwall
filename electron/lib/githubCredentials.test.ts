import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createGitHubCredentialStore } = require("./githubCredentials.cjs");

/** Reversible stand-in: these tests are about the store's decisions, not crypto. */
const encryption = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(value, "utf8"),
  decryptString: (buffer: Buffer) => buffer.toString("utf8"),
};

let directory = "";
const newStore = () => createGitHubCredentialStore(join(directory, "credentials.json"), encryption);
const remember = (store: ReturnType<typeof newStore>, token = "live-token") =>
  store.remember({ projectId: "p1", projectPath: "/tmp/project", login: "someone", token });

beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "pitwall-credentials-")); });
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });

describe("getEnvironment", () => {
  it("supplies the token and a credential helper for a healthy record", () => {
    const store = newStore();
    remember(store);
    const environment = store.getEnvironment({ projectId: "p1" });
    expect(environment.GH_TOKEN).toBe("live-token");
    expect(environment.GIT_CONFIG_COUNT).toBe("3");
  });

  it("gives a GitLab project GitLab's variables, and asks GitLab about the token", async () => {
    const store = newStore();
    store.remember({ projectId: "p1", projectPath: "/tmp/project", host: "gitlab.example.com", kind: "gitlab", login: "dev", token: "glpat-x" });
    const environment = store.getEnvironment({ projectId: "p1" });
    expect(environment).toMatchObject({ GITLAB_TOKEN: "glpat-x", GITLAB_HOST: "gitlab.example.com" });
    expect(environment.GH_TOKEN).toBeUndefined();
    expect(store.getStatus({ projectId: "p1" }).kind).toBe("gitlab");

    let asked: { kind?: string; host?: string } = {};
    const status = await store.verify({ projectId: "p1" }, async (request: { kind: string; host: string }) => {
      asked = request;
      return { status: 401, ok: false, login: "" };
    });
    expect(asked).toMatchObject({ kind: "gitlab", host: "gitlab.example.com" });
    expect(status.rejectedReason).toMatch(/^GitLab rejected/);
  });

  it("treats a record saved before hosts were told apart as GitHub", () => {
    const store = newStore();
    remember(store);
    expect(store.getStatus({ projectId: "p1" }).kind).toBe("github");
  });

  it("supplies nothing once the host has refused the token", async () => {
    // The point of the whole mechanism: Pitwall injects GH_TOKEN, which
    // outranks the user's own gh login and the keychain, so continuing to hand
    // out a dead token breaks authentication that would otherwise work.
    const store = newStore();
    remember(store);
    await store.verify({ projectId: "p1" }, async () => ({ status: 401, ok: false, login: "" }));
    expect(store.getEnvironment({ projectId: "p1" })).toEqual({});
  });

  it("finds a record by project path when no id is given", () => {
    const store = newStore();
    remember(store);
    expect(store.getEnvironment({ projectPath: "/tmp/project" }).GH_TOKEN).toBe("live-token");
  });
});

describe("verify", () => {
  it("keeps a credential the host accepts, and adopts the login it reports", async () => {
    const store = newStore();
    remember(store);
    const status = await store.verify({ projectId: "p1" }, async () => ({ status: 200, ok: true, login: "octocat" }));
    expect(status.rejectedAt).toBeNull();
    expect(status.login).toBe("octocat");
  });

  it("condemns a credential the host refuses, and says why", async () => {
    const store = newStore();
    remember(store);
    const status = await store.verify({ projectId: "p1" }, async () => ({ status: 401, ok: false, login: "" }));
    expect(status.rejectedAt).toBeTruthy();
    expect(status.rejectedReason).toMatch(/rejected/i);
  });

  it("leaves a credential alone when the host cannot be reached", async () => {
    // Offline says nothing about the token. Condemning it here would log the
    // user out of every project the moment their network dropped.
    const store = newStore();
    remember(store);
    const status = await store.verify({ projectId: "p1" }, async () => null);
    expect(status.rejectedAt).toBeNull();
    expect(store.getEnvironment({ projectId: "p1" }).GH_TOKEN).toBe("live-token");
  });

  it("does not condemn on a server error or a rate limit", async () => {
    const store = newStore();
    remember(store);
    for (const status of [403, 500, 502]) {
      await store.verify({ projectId: "p1" }, async () => ({ status, ok: false, login: "" }));
      expect(store.getStatus({ projectId: "p1" }).rejectedAt).toBeNull();
    }
  });

  it("clears a past refusal when a new token is supplied", async () => {
    const store = newStore();
    remember(store);
    await store.verify({ projectId: "p1" }, async () => ({ status: 401, ok: false, login: "" }));
    expect(store.getEnvironment({ projectId: "p1" })).toEqual({});
    remember(store, "replacement-token");
    expect(store.getEnvironment({ projectId: "p1" }).GH_TOKEN).toBe("replacement-token");
  });

  it("survives a record written before refusals were tracked", async () => {
    const store = newStore();
    remember(store);
    const status = await store.verify({ projectId: "p1" }, async () => ({ status: 200, ok: true, login: "" }));
    expect(status.configured).toBe(true);
  });
});

describe("two records for one folder", () => {
  /* A project removed and added again gets a new id, so the same folder can
     hold more than one record. Every caller that knows only the path — the
     review screen among them — was handed whichever was written first. */
  it("replaces the record for a folder rather than keeping both", () => {
    const store = newStore();
    store.remember({ projectId: "old", projectPath: "/tmp/project", login: "someone", token: "stale-token" });
    store.remember({ projectId: "new", projectPath: "/tmp/project", login: "someone", token: "current-token" });
    expect(store.getEnvironment({ projectPath: "/tmp/project" }).GH_TOKEN).toBe("current-token");
    // The old id is gone, not merely outranked.
    expect(store.getStatus({ projectId: "old" }).configured).toBe(false);
  });

  it("prefers the most recently confirmed record when a folder has several", async () => {
    const store = newStore();
    store.remember({ projectId: "old", projectPath: "/tmp/project", login: "someone", token: "stale-token" });
    // Written straight into the file, the way a build before the replacement
    // above left them behind.
    const file = join(directory, "credentials.json");
    const state = JSON.parse(readFileSync(file, "utf8"));
    state.projects.newer = {
      ...state.projects.old,
      projectId: "newer",
      encryptedToken: encryption.encryptString("current-token").toString("base64"),
      updatedAt: "2030-01-01T00:00:00.000Z",
      verifiedAt: "2030-01-02T00:00:00.000Z",
    };
    state.projects.old.verifiedAt = "2020-01-01T00:00:00.000Z";
    state.projects.old.updatedAt = "2020-01-01T00:00:00.000Z";
    writeFileSync(file, JSON.stringify(state));

    const reopened = newStore();
    expect(reopened.getEnvironment({ projectPath: "/tmp/project" }).GH_TOKEN).toBe("current-token");
    expect(reopened.getStatus({ projectPath: "/tmp/project" }).configured).toBe(true);
  });

  it("passes over a refused record for a usable one", () => {
    const store = newStore();
    store.remember({ projectId: "good", projectPath: "/tmp/project", login: "someone", token: "current-token" });
    const file = join(directory, "credentials.json");
    const state = JSON.parse(readFileSync(file, "utf8"));
    state.projects.bad = {
      ...state.projects.good,
      projectId: "bad",
      encryptedToken: encryption.encryptString("dead-token").toString("base64"),
      // Newer, but refused — freshness must not outrank being usable.
      verifiedAt: "2031-01-01T00:00:00.000Z",
      rejectedAt: "2031-01-01T00:00:00.000Z",
    };
    writeFileSync(file, JSON.stringify(state));

    expect(newStore().getEnvironment({ projectPath: "/tmp/project" }).GH_TOKEN).toBe("current-token");
  });
});
