import { describe, expect, it } from "vitest";
import { mergeTaskSummaryComponents, parseTaskSummary, TASK_SUMMARY_MARKER } from "./taskSummary";

describe("parseTaskSummary", () => {
  it("reads the final structured task handoff and strips terminal color", () => {
    const output = `noise\n\u001b[32m${TASK_SUMMARY_MARKER} {"what":"Fixed task import","how":"Carried provider identity through IPC.","components":["src/App.tsx","electron/main.cjs"]}\u001b[0m`;
    expect(parseTaskSummary(output)).toEqual({
      what: "Fixed task import",
      how: "Carried provider identity through IPC.",
      components: ["src/App.tsx", "electron/main.cjs"],
      source: "agent",
    });
  });

  it("rejects malformed and incomplete summaries", () => {
    expect(parseTaskSummary(`${TASK_SUMMARY_MARKER} nope`)).toBeNull();
    expect(parseTaskSummary(`${TASK_SUMMARY_MARKER} {"what":"Only half"}`)).toBeNull();
  });

  it("merges authoritative changed files without duplicates", () => {
    expect(mergeTaskSummaryComponents({ what: "What", how: "How", components: ["src/App.tsx"], source: "agent" }, ["src/App.tsx", "src/styles.css"]).components).toEqual(["src/App.tsx", "src/styles.css"]);
  });
});
