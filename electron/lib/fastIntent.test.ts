import { describe, expect, it } from "vitest";
import {
  matchFastIntent,
  matchSlotIntent,
  cleanSlot,
  isFastPathEligible,
  contentTokens,
  similarity,
} from "./fastIntent.cjs";
import { createCapabilityCatalog } from "./capabilityCatalog.cjs";

/** The real catalog, with the side effects stubbed out — the matcher only ever
 * reads ids, risk, params and examples, so nothing here can act. */
const stub: any = new Proxy({}, { get: () => async () => ({}) });
const catalog: any[] = createCapabilityCatalog({
  git: stub,
  project: stub,
  tests: stub,
  os: stub,
  memory: stub,
  screen: stub,
  tracker: stub,
  callRenderer: () => async () => ({}),
  answer: stub,
});

/** `registry.list()` shape, which is what routeIntent passes in. */
const capabilities = catalog.map((capability) => ({
  id: capability.id,
  title: capability.title,
  description: capability.description,
  examples: capability.examples || [],
  risk: capability.risk,
  params: capability.params || { type: "object", properties: {} },
}));

const byId = (id: string) => capabilities.find((capability) => capability.id === id)!;

describe("contentTokens", () => {
  it("reduces phrasings of the same request to the same tokens", () => {
    expect(contentTokens("What's changed?")).toEqual(["changed"]);
    expect(contentTokens("what has changed")).toEqual(["changed"]);
  });

  it("drops apostrophes rather than expanding them", () => {
    expect(contentTokens("what's on my screen")).toEqual(["screen"]);
  });
});

describe("similarity", () => {
  it("is 1 for the same content words and 0 with nothing in common", () => {
    expect(similarity(["run", "tests"], ["run", "tests"])).toBe(1);
    expect(similarity(["run", "tests"], ["push"])).toBe(0);
  });

  it("penalises extra words the matcher is not entitled to interpret", () => {
    expect(similarity(["run", "tests"], ["run", "tests", "login", "watch", "mode"])).toBeLessThan(0.6);
  });
});

describe("isFastPathEligible", () => {
  it("refuses destructive capabilities", () => {
    expect(byId("git.discard_changes").risk).toBe("destructive");
    expect(isFastPathEligible(byId("git.discard_changes"))).toBe(false);
    expect(isFastPathEligible(byId("session.delete"))).toBe(false);
  });

  it("refuses capabilities that need parameters", () => {
    expect(isFastPathEligible(byId("git.commit"))).toBe(false);
    expect(isFastPathEligible(byId("project.switch"))).toBe(false);
    expect(isFastPathEligible(byId("os.launch_app"))).toBe(false);
  });

  it("accepts parameterless, non-destructive capabilities", () => {
    expect(isFastPathEligible(byId("git.status"))).toBe(true);
    expect(isFastPathEligible(byId("tests.run"))).toBe(true);
  });
});

describe("matchFastIntent", () => {
  it("routes the common commands without a model", () => {
    const cases: [string, string][] = [
      ["what's changed", "git.status"],
      ["git status", "git.status"],
      ["what did I change", "git.diff"],
      ["show me the diff", "git.diff"],
      ["run the tests", "tests.run"],
      ["push this", "git.push"],
      ["list my projects", "project.list"],
      ["what's on my screen", "context.describe_screen"],
    ];
    for (const [spoken, expected] of cases) {
      expect(matchFastIntent(spoken, capabilities)?.capabilityId, spoken).toBe(expected);
    }
  });

  it("never resolves a destructive request locally", () => {
    // These must reach the model, which is what puts them behind spoken
    // confirmation with a real question rather than a guessed one.
    expect(matchFastIntent("discard my changes", capabilities)).toBeNull();
    expect(matchFastIntent("reset the working tree", capabilities)).toBeNull();
    expect(matchFastIntent("delete this session", capabilities)).toBeNull();
  });

  it("never invents a parameter that was not spoken", () => {
    // Copying a span the user said is not guessing, so "commit this saying X"
    // resolves locally (see the slot tests below). Producing an X that was
    // never said is the guess this refuses — the model writes that one from
    // the diff.
    expect(matchFastIntent("commit this", capabilities)).toBeNull();
    expect(matchFastIntent("make a branch", capabilities)).toBeNull();
    expect(matchFastIntent("switch project", capabilities)).toBeNull();
  });

  it("abstains on real language instead of guessing", () => {
    expect(matchFastIntent("why is the login page throwing a null reference", capabilities)).toBeNull();
    expect(matchFastIntent("run the tests but only the ones touching the parser", capabilities)).toBeNull();
  });

  it("abstains when there is nothing but filler", () => {
    expect(matchFastIntent("do it", capabilities)).toBeNull();
    expect(matchFastIntent("please", capabilities)).toBeNull();
    expect(matchFastIntent("", capabilities)).toBeNull();
  });

  it("abstains when two capabilities describe the utterance equally well", () => {
    const ambiguous = [
      { id: "a.one", risk: "safe", params: {}, examples: ["run the thing"] },
      { id: "a.two", risk: "safe", params: {}, examples: ["run the thing"] },
    ];
    expect(matchFastIntent("run the thing", ambiguous)).toBeNull();
  });

  it("returns no parameters and no preamble, so nothing is invented", () => {
    const match = matchFastIntent("what's changed", capabilities);
    expect(match).toMatchObject({ capabilityId: "git.status", params: {}, say: "" });
    expect(match.confidence).toBeGreaterThanOrEqual(0.6);
  });
});

// ------------------------------------------------------------- filled slots

describe("matchSlotIntent", () => {
  it("fills the parameter from the words the user actually said", () => {
    const cases: Array<[string, string, string, string]> = [
      ["commit this with message Fix the parser", "git.commit", "message", "Fix the parser"],
      ["remember that we use Postgres", "memory.remember", "note", "we use Postgres"],
      ["tell it to add tests for the router", "session.send", "message", "add tests for the router"],
      ["start a new branch called login fix", "git.create_branch", "name", "login fix"],
      ["switch to the frontend project", "project.switch", "name", "frontend"],
      ["launch VS Code", "os.launch_app", "name", "VS Code"],
      ["what did we decide about the database", "memory.recall", "query", "the database"],
    ];
    for (const [spoken, capabilityId, param, value] of cases) {
      const match = matchSlotIntent(spoken, capabilities);
      expect(match?.capabilityId, spoken).toBe(capabilityId);
      expect(match?.params[param], spoken).toBe(value);
    }
  });

  it("preserves the case and punctuation of what was dictated", () => {
    // A commit message lowercased into "fix the parser" is a different commit
    // message. The matcher runs on the original text for exactly this reason.
    const match = matchSlotIntent("commit this saying Fix the OAuth redirect, finally", capabilities);
    expect(match?.params.message).toBe("Fix the OAuth redirect, finally");
  });

  it("does not invent a commit message that was never given", () => {
    // "commit this" has no message — the model can write one from the diff.
    expect(matchSlotIntent("commit this", capabilities)).toBeNull();
    expect(matchSlotIntent("commit", capabilities)).toBeNull();
  });

  it("refuses the file-or-app ambiguity instead of coin-flipping", () => {
    // "open X" could be either. Only an actual filename or an unambiguous verb
    // resolves locally; the rest is the model's to decide.
    expect(matchSlotIntent("open Figma", capabilities)).toBeNull();
    expect(matchSlotIntent("open the thing", capabilities)).toBeNull();
    expect(matchSlotIntent("open App.tsx", capabilities)?.capabilityId).toBe("editor.open_file");
    expect(matchSlotIntent("open src/lib/foo.ts", capabilities)?.capabilityId).toBe("editor.open_file");
    expect(matchSlotIntent("launch Figma", capabilities)?.capabilityId).toBe("os.launch_app");
    expect(matchSlotIntent("open the Figma app", capabilities)?.capabilityId).toBe("os.launch_app");
  });

  it("never fills a slot for a destructive capability", () => {
    // The exclusion, not the pattern, is what makes this safe — same rule as
    // the exact matcher.
    const destructive = capabilities.map((capability) =>
      capability.id === "git.create_branch" ? { ...capability, risk: "destructive" } : capability,
    );
    expect(matchSlotIntent("start a branch called login fix", destructive)).toBeNull();
  });

  it("abstains when the captured span is only filler", () => {
    for (const spoken of ["remember that", "remember that it", "tell it to it", "switch to the"]) {
      expect(matchSlotIntent(spoken, capabilities), spoken).toBeNull();
    }
  });

  it("abstains when the capability is not on this council's registry", () => {
    expect(matchSlotIntent("remember that we use Postgres", [])).toBeNull();
  });
});

describe("cleanSlot", () => {
  it("strips the politeness people speak but do not mean", () => {
    expect(cleanSlot("add tests please")).toBe("add tests");
    expect(cleanSlot("fix the parser.")).toBe("fix the parser");
    expect(cleanSlot("  ship it, thanks  ")).toBe("ship it");
  });

  it("leaves meaningful punctuation inside the value alone", () => {
    expect(cleanSlot("fix the OAuth redirect, finally")).toBe("fix the OAuth redirect, finally");
    expect(cleanSlot("src/lib/foo.ts")).toBe("src/lib/foo.ts");
  });
});

describe("the fast path as a whole", () => {
  it("keeps sending destructive and open-ended requests to the model", () => {
    for (const spoken of [
      "discard my changes",
      "delete this session",
      "why is the login page throwing a null reference",
    ]) {
      expect(matchFastIntent(spoken, capabilities), spoken).toBeNull();
    }
  });

  it("now resolves the parameterised commands people actually use", () => {
    for (const spoken of [
      "commit this with message Fix the parser",
      "remember that we use Postgres",
      "open App.tsx",
      "switch to the frontend project",
      "tell it to add tests",
    ]) {
      expect(matchFastIntent(spoken, capabilities), spoken).not.toBeNull();
    }
  });
});

describe("picking up a tracker item", () => {
  it("resolves the plain form locally", () => {
    for (const [spoken, source] of [
      ["pick up my latest Linear ticket", "Linear"],
      ["grab my next Jira task", "Jira"],
      ["start on my most recent GitHub issue", "GitHub"],
      ["work on my last Asana item", "Asana"],
    ] as Array<[string, string]>) {
      const match = matchSlotIntent(spoken, capabilities);
      expect(match?.capabilityId, spoken).toBe("tracker.pick_task");
      expect(match?.params.source, spoken).toBe(source);
    }
  });

  it("defers anything that also names an agent, rather than dropping it", () => {
    // This layer fills one parameter. An utterance carrying two needs the
    // model, because silently losing "with Claude Code" would start the
    // session with the wrong agent.
    for (const spoken of [
      "pick up my latest Linear ticket with Claude Code",
      "grab my next Jira task and use Codex",
      "pick up the Linear ticket about the parser",
    ]) {
      expect(matchSlotIntent(spoken, capabilities), spoken).toBeNull();
    }
  });
});
