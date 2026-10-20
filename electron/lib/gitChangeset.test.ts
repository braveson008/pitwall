import { describe, expect, it } from "vitest";
import { nearestForkPoint, forkCandidates, livingTrunk } from "./gitChangeset.cjs";

describe("nearestForkPoint", () => {
  // The exact shape of the bug: a back-office repository that develops on `dev`
  // and keeps `main` for releases. Pitwall had recorded `main` when the project
  // was added, so a task that touched three files was reviewed as six hundred
  // and thirty-nine — every commit `main` had missed in three months.
  it("prefers the branch this one actually forked from, not the recorded one", () => {
    const picked = nearestForkPoint([
      { ref: "main", mergeBase: "eae105c6", at: 1_750_000_000 }, // three months back
      { ref: "dev", mergeBase: "abd2d3b5", at: 1_756_000_000 }, // six hours back
    ]);
    expect(picked).toMatchObject({ ref: "dev", mergeBase: "abd2d3b5" });
  });

  it("keeps the recorded branch when it is the one the work came from", () => {
    const picked = nearestForkPoint([
      { ref: "main", mergeBase: "aaa", at: 1_756_000_000 },
      { ref: "dev", mergeBase: "bbb", at: 1_700_000_000 },
    ]);
    expect(picked?.ref).toBe("main");
  });

  // The recorded branch is asked first, so equal evidence should leave the
  // project's own answer standing rather than overturn it on a coin toss.
  it("breaks a tie towards the caller's stated preference", () => {
    const picked = nearestForkPoint([
      { ref: "main", mergeBase: "aaa", at: 1_756_000_000 },
      { ref: "origin/main", mergeBase: "aaa", at: 1_756_000_000 },
    ]);
    expect(picked?.ref).toBe("main");
  });

  it("says nothing when no candidate shares any history", () => {
    expect(nearestForkPoint([])).toBeNull();
    expect(nearestForkPoint([{ ref: "main", mergeBase: "", at: 1 }])).toBeNull();
    expect(nearestForkPoint([{ ref: "main", mergeBase: "aaa", at: Number.NaN }])).toBeNull();
    expect(nearestForkPoint(null as never)).toBeNull();
  });
});

describe("forkCandidates", () => {
  it("asks the recorded branch first, then the conventional ones", () => {
    const candidates = forkCandidates("dev", ["main", "dev", "origin/main", "feature/x"]);
    expect(candidates[0]).toBe("dev");
    expect(candidates).toContain("main");
    expect(candidates).toContain("origin/main");
  });

  // `git merge-base` on a ref that does not exist is an error rather than an
  // empty answer, and there is no sense running five of them on a repository
  // with one branch.
  it("never asks about a branch the repository does not have", () => {
    expect(forkCandidates("main", ["main"])).toEqual(["main"]);
    expect(forkCandidates("main", ["main", "feature/x"])).toEqual(["main"]);
  });

  it("does not offer the same branch twice", () => {
    const candidates = forkCandidates("main", ["main", "dev", "origin/dev"]);
    expect(new Set(candidates).size).toBe(candidates.length);
  });

  // A project saved before the field existed still has to be reviewable.
  it("works with nothing recorded at all", () => {
    expect(forkCandidates("", ["dev", "trunk"])).toEqual(["dev", "trunk"]);
    expect(forkCandidates(undefined as never, [])).toEqual([]);
  });

  // 325 branches on the repository this was found in; asking all of them would
  // be 325 subprocesses per task card.
  it("stays small however many branches the repository has", () => {
    const many = Array.from({ length: 325 }, (_, index) => `feature/${index}`).concat(["main", "dev"]);
    expect(forkCandidates("main", many).length).toBeLessThanOrEqual(6);
  });
});

describe("livingTrunk", () => {
  const DAY = 86_400;
  const NOW = 1_756_200_000;

  // The repository that prompted this. Its recorded default, its `origin/HEAD`
  // and its GitHub default all say `main`; every commit for three months went
  // to `dev`. Pitwall cut acme-2581 from `main` and the branch had to be reset
  // onto `origin/dev` by hand.
  it("starts work on the trunk that is still moving, not the one that is named", () => {
    const picked = livingTrunk([
      { ref: "main", at: NOW - 28 * DAY },
      { ref: "origin/main", at: NOW - 159 * DAY },
      { ref: "dev", at: NOW - 0.25 * DAY },
      { ref: "origin/dev", at: NOW - 0.25 * DAY },
    ]);
    expect(picked?.ref).toBe("dev");
  });

  // The ordinary case, which must not change: one trunk, actively developed.
  it("leaves a conventional repository alone", () => {
    expect(livingTrunk([{ ref: "main", at: NOW }])?.ref).toBe("main");
    expect(livingTrunk([{ ref: "main", at: NOW }, { ref: "origin/main", at: NOW - DAY }])?.ref).toBe("main");
  });

  // A stale `develop` left over from a git-flow the team abandoned should not
  // pull new work back onto it.
  it("is not misled by an abandoned branch that happens to be trunk-shaped", () => {
    const picked = livingTrunk([
      { ref: "main", at: NOW },
      { ref: "develop", at: NOW - 400 * DAY },
    ]);
    expect(picked?.ref).toBe("main");
  });

  it("keeps the caller's preference when nothing separates the candidates", () => {
    // `main` is asked first because the project named it.
    expect(livingTrunk([{ ref: "main", at: NOW }, { ref: "dev", at: NOW }])?.ref).toBe("main");
  });

  it("says nothing rather than guessing when it has no dates", () => {
    expect(livingTrunk([])).toBeNull();
    expect(livingTrunk([{ ref: "main", at: Number.NaN }])).toBeNull();
    expect(livingTrunk(null as never)).toBeNull();
  });
});
