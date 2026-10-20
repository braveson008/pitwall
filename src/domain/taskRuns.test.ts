import { beforeEach, describe, expect, it, vi } from "vitest";
import { outcomeFor, readOutcomes, readTaskRuns, upsertRun, writeOutcomes, writeTaskRuns } from "./taskRuns";
import type { TaskRun } from "./contracts";

function fakeStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  };
}

const run = (over: Partial<TaskRun> = {}): TaskRun => ({
  id: "r1",
  taskId: "t1",
  projectId: "p1",
  stage: "implementing",
  riskLevel: "normal",
  attempts: [],
  reports: [],
  fixContracts: [],
  qaRounds: 0,
  createdAt: "2026-08-29T10:00:00.000Z",
  updatedAt: "2026-08-29T10:00:00.000Z",
  ...over,
});

const attempt = (model: string) => ({
  id: "a1",
  contractId: "c1",
  provider: "" as const,
  model,
  role: "implementation" as const,
  sessionId: "s1",
  startedAt: "2026-08-29T10:00:00.000Z",
});

beforeEach(() => {
  vi.stubGlobal("window", { localStorage: fakeStorage() });
});

describe("storing runs", () => {
  it("round-trips a run", () => {
    writeTaskRuns([run()]);
    expect(readTaskRuns()).toHaveLength(1);
  });

  it("survives storage that cannot be read", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("denied");
        },
      },
    });
    // An unreadable history is an empty one, not a crash on boot.
    expect(readTaskRuns()).toEqual([]);
    expect(readOutcomes()).toEqual([]);
  });

  it("ignores entries that are not runs", () => {
    window.localStorage.setItem("braveli-task-runs", JSON.stringify([{ nonsense: true }, run()]));
    expect(readTaskRuns()).toHaveLength(1);
  });

  it("never drops a run that is still moving", () => {
    const settled = Array.from({ length: 60 }, (_, index) =>
      run({ id: `s${index}`, stage: "passed", updatedAt: `2026-08-01T00:${String(index).padStart(2, "0")}:00.000Z` }));
    writeTaskRuns([...settled, run({ id: "live", stage: "implementing", updatedAt: "2020-01-01T00:00:00.000Z" })]);
    const stored = readTaskRuns();
    // The live one is the oldest by date and must still be there.
    expect(stored.some((item) => item.id === "live")).toBe(true);
    expect(stored.filter((item) => item.stage === "passed")).toHaveLength(50);
  });

  it("replaces a run rather than adding a second copy", () => {
    const runs = upsertRun([run()], run({ stage: "passed" }));
    expect(runs).toHaveLength(1);
    expect(runs[0].stage).toBe("passed");
  });
});

describe("the evidence a run leaves", () => {
  it("says nothing until the run has settled", () => {
    expect(outcomeFor(run({ attempts: [attempt("qwen")] }))).toBeNull();
  });

  it("says nothing when nothing was ever attempted", () => {
    expect(outcomeFor(run({ stage: "passed" }))).toBeNull();
  });

  it("credits the model that made the first attempt", () => {
    // That is the choice being judged; a fix by a stronger model afterwards
    // is not evidence that the first choice was right.
    const outcome = outcomeFor(run({
      stage: "passed",
      attempts: [attempt("qwen3-coder:30b"), attempt("opus")],
    }));
    expect(outcome?.model).toBe("qwen3-coder:30b");
    expect(outcome?.passed).toBe(true);
  });

  it("counts a run that needed no fix round as one round", () => {
    const outcome = outcomeFor(run({ stage: "passed", qaRounds: 0, attempts: [attempt("qwen")] }));
    // firstTimeRate treats rounds <= 1 as a first-time pass.
    expect(outcome?.rounds).toBe(1);
  });

  it("records a blocked run as a failure, not as silence", () => {
    const outcome = outcomeFor(run({ stage: "blocked", attempts: [attempt("qwen")] }));
    expect(outcome?.passed).toBe(false);
  });

  it("round-trips outcomes", () => {
    const outcome = outcomeFor(run({ stage: "passed", attempts: [attempt("qwen")] }))!;
    writeOutcomes([outcome]);
    expect(readOutcomes()).toHaveLength(1);
  });
});
