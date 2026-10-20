import { describe, expect, it } from "vitest";
import { bestMatch, normalize, scoreCandidate } from "./voiceMatch";

const files = [
  "src/App.tsx",
  "src/components/AppShell.tsx",
  "src/main.tsx",
  "electron/main.cjs",
  "package.json",
  "src/lib/councilRelay.ts",
];

const pick = (query: string) => bestMatch(query, files, (file) => file);

describe("voiceMatch", () => {
  it("normalizes spoken punctuation away", () => {
    expect(normalize("App.tsx!")).toBe("app tsx");
    expect(normalize("  the   Main-Process  ")).toBe("the main process");
  });

  it("finds a file from how it is said out loud", () => {
    expect(pick("App.tsx")).toBe("src/App.tsx");
    expect(pick("app tsx")).toBe("src/App.tsx");
    expect(pick("the package json")).toBe("package.json");
    expect(pick("council relay")).toBe("src/lib/councilRelay.ts");
  });

  it("prefers the basename over a longer path that also contains the words", () => {
    expect(pick("app shell")).toBe("src/components/AppShell.tsx");
  });

  it("refuses to guess when nothing matches", () => {
    expect(pick("the database migration")).toBeNull();
    expect(pick("")).toBeNull();
    expect(bestMatch("anything", [], (file: string) => file)).toBeNull();
  });

  it("refuses to guess between two equally good candidates", () => {
    // Switching to the wrong project is not a recoverable mistake, so a tie
    // must produce a question rather than a coin flip.
    const projects = [{ name: "api-server" }, { name: "api-worker" }];
    expect(bestMatch("api", projects, (project) => project.name)).toBeNull();
  });

  it("still resolves a tie-break when one candidate is clearly better", () => {
    const projects = [{ name: "pitwall" }, { name: "pitwall-website" }];
    expect(bestMatch("pitwall", projects, (project) => project.name)?.name).toBe("pitwall");
  });

  it("scores a basename hit far above an incidental word hit", () => {
    expect(scoreCandidate("main", "electron/main.cjs")).toBeGreaterThan(scoreCandidate("main", "src/domain/types.ts"));
    expect(scoreCandidate("nothing", "src/App.tsx")).toBe(0);
  });

  it("asks rather than guessing between two files with the same name", () => {
    // "open main" is genuinely ambiguous between electron/main.cjs and
    // src/main.tsx, and picking one silently is how voice loses trust.
    expect(pick("main")).toBeNull();
  });
});
