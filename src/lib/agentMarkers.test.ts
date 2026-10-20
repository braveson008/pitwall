import { describe, expect, it } from "vitest";
import { extractAgentMarkers } from "./agentMarkers";

const SUMMARY = 'PITWALL_TASK_SUMMARY {"what":"Duplicate markers no longer both shown.","how":"Added dropSupersededMarkers to biomarkerUtils.","components":["a.ts","b.ts"]}';

describe("extractAgentMarkers", () => {
  it("returns ordinary prose untouched", () => {
    const text = "Rebased onto main and re-ran the suite.";
    expect(extractAgentMarkers(text)).toEqual({ prose: text, markers: [] });
  });

  it("lifts the summary out of the prose", () => {
    const { prose, markers } = extractAgentMarkers(`PR is open.\n\n${SUMMARY}`);
    expect(prose).toBe("PR is open.");
    expect(markers).toEqual([
      { kind: "summary", what: "Duplicate markers no longer both shown.", how: "Added dropSupersededMarkers to biomarkerUtils.", components: ["a.ts", "b.ts"] },
    ]);
  });

  it("keeps the reader's text when the summary is the only other line", () => {
    expect(extractAgentMarkers(SUMMARY).prose).toBe("");
  });

  it("lifts a preview marker as a link", () => {
    const { prose, markers } = extractAgentMarkers("Done.\nPITWALL_MOBILE_PREVIEW http://localhost:8692");
    expect(prose).toBe("Done.");
    expect(markers).toEqual([{ kind: "preview", label: "Mobile preview", url: "http://localhost:8692" }]);
  });

  it("lifts markers printed under the old name by a session an older version started", () => {
    const { prose, markers } = extractAgentMarkers(`Done.\n${SUMMARY.replace("PITWALL_", "BRAVELI_")}\nBRAVELI_DEV_PREVIEW http://localhost:5173`);
    expect(prose).toBe("Done.");
    expect(markers.map((marker) => marker.kind)).toEqual(["summary", "preview"]);
  });

  it("labels a web preview differently from a mobile one", () => {
    expect(extractAgentMarkers("PITWALL_DEV_PREVIEW http://localhost:5173").markers[0])
      .toMatchObject({ label: "Preview" });
  });

  it("drops a summary line it cannot parse rather than printing broken JSON", () => {
    // A truncated marker is noise to a reader however it failed.
    const { prose, markers } = extractAgentMarkers('Work done.\nPITWALL_TASK_SUMMARY {"what":"cut off');
    expect(prose).toBe("Work done.");
    expect(markers).toEqual([]);
  });

  it("handles both markers in one message", () => {
    const { markers } = extractAgentMarkers(`Done.\nPITWALL_DEV_PREVIEW http://x\n${SUMMARY}`);
    expect(markers.map((m) => m.kind)).toEqual(["preview", "summary"]);
  });
});
