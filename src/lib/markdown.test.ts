import { describe, expect, it } from "vitest";
import { parseBlocks, parseInline, reflowFlattenedMarkdown, trackerHtmlToMarkdown } from "./markdown";

describe("parseInline", () => {
  it("renders the bold and code an agent actually writes", () => {
    // Straight from a session that rendered raw: the asterisks and backticks
    // were visible in the pane while the terminal showed them formatted.
    expect(parseInline("**Pushed:** `96eb85cec..b2909afb6` is now OPEN.")).toEqual([
      { kind: "bold", text: "Pushed:" },
      { kind: "text", text: " " },
      { kind: "code", text: "96eb85cec..b2909afb6" },
      { kind: "text", text: " is now OPEN." },
    ]);
  });

  it("leaves markup inside a code span alone", () => {
    // Backticks win, so an asterisk in a command is not emphasis.
    expect(parseInline("run `git log --oneline **HEAD**`")).toEqual([
      { kind: "text", text: "run " },
      { kind: "code", text: "git log --oneline **HEAD**" },
    ]);
  });

  it("reads links", () => {
    expect(parseInline("see [PR #5057](https://github.com/manualco/web-app/pull/5057)")).toEqual([
      { kind: "text", text: "see " },
      { kind: "link", text: "PR #5057", href: "https://github.com/manualco/web-app/pull/5057" },
    ]);
  });

  it("passes plain prose through as one run", () => {
    expect(parseInline("nothing special here")).toEqual([{ kind: "text", text: "nothing special here" }]);
  });

  it("does not treat a lone asterisk as emphasis", () => {
    expect(parseInline("2 * 3 is 6")).toEqual([{ kind: "text", text: "2 * 3 is 6" }]);
  });
});

describe("parseBlocks", () => {
  it("keeps a fenced block as code rather than as prose", () => {
    const blocks = parseBlocks("The PR's file list is now:\n\n```\ncheckbox-check.svg   (+3/-0)\nSurveyCheckboxMultiple.tsx   (+93/-48)\n```\n\nThat asset is unused.");
    expect(blocks.map((block) => block.kind)).toEqual(["paragraph", "code", "paragraph"]);
    expect(blocks[1]).toMatchObject({
      kind: "code",
      text: "checkbox-check.svg   (+3/-0)\nSurveyCheckboxMultiple.tsx   (+93/-48)",
    });
  });

  it("keeps the language on a fence", () => {
    expect(parseBlocks("```ts\nconst a = 1;\n```")[0]).toMatchObject({ kind: "code", language: "ts" });
  });

  it("shows the code of a message that was cut off mid-fence", () => {
    // A truncated tool result or a stream that stopped: the code should still
    // render rather than the rest of the message becoming one paragraph.
    expect(parseBlocks("here it is:\n```\nnpm test")).toMatchObject([
      { kind: "paragraph" },
      { kind: "code", text: "npm test" },
    ]);
  });

  it("reads bulleted and numbered lists", () => {
    const blocks = parseBlocks("Open items:\n- checkbox still unfixed\n- registry is empty\n\nSteps:\n1. rework it\n2. run the tests");
    expect(blocks.map((block) => block.kind)).toEqual(["paragraph", "list", "paragraph", "list"]);
    expect(blocks[1]).toMatchObject({ ordered: false });
    expect(blocks[3]).toMatchObject({ ordered: true });
    expect((blocks[1] as { items: unknown[] }).items).toHaveLength(2);
  });

  it("does not run a bulleted list into a numbered one", () => {
    const blocks = parseBlocks("- one\n1. two");
    expect(blocks.map((block) => block.kind)).toEqual(["list", "list"]);
  });

  it("keeps paragraphs separate", () => {
    const blocks = parseBlocks("first thought\n\nsecond thought");
    expect(blocks).toHaveLength(2);
  });

  it("says nothing about nothing", () => {
    expect(parseBlocks("")).toEqual([]);
    expect(parseBlocks("   \n\n  ")).toEqual([]);
  });
});

describe("headings and images", () => {
  it("reads a heading as its own block, at its level", () => {
    const blocks = parseBlocks("# Acceptance Criteria\ntext after");
    expect(blocks[0]).toMatchObject({ kind: "heading", level: 1 });
    expect(blocks[1].kind).toBe("paragraph");
  });

  it("does not mistake a hash inside prose for a heading", () => {
    expect(parseBlocks("issue #268 landed").map((b) => b.kind)).toEqual(["paragraph"]);
  });

  it("keeps an image as an image, not a link with a stray bang", () => {
    // Tracker images carry signed URLs hundreds of characters long; spilling
    // one into the prose is what made a description unreadable.
    const [inline] = parseInline("![](https://uploads.linear.app/a/b?signature=eyJhbGciOi)");
    expect(inline).toMatchObject({ kind: "image", alt: "", href: "https://uploads.linear.app/a/b?signature=eyJhbGciOi" });
  });

  it("keeps the alt text when there is one", () => {
    expect(parseInline("![chart](https://x/y.png)")[0]).toMatchObject({ kind: "image", alt: "chart" });
  });

  it("still reads an ordinary link", () => {
    expect(parseInline("[docs](https://x/y)")[0]).toMatchObject({ kind: "link", text: "docs" });
  });

  it("drops bullet runs that carry no content", () => {
    // "* * * *" is a flattened list, not four empty items.
    expect(parseBlocks("# Criteria\n* * * *\n* real item").filter((b) => b.kind === "list"))
      .toEqual([{ kind: "list", ordered: false, items: [[{ kind: "text", text: "real item" }]] }]);
  });
});

describe("reflowFlattenedMarkdown", () => {
  it("leaves text that already has line breaks untouched", () => {
    const source = "# Title\nbody text";
    expect(reflowFlattenedMarkdown(source)).toBe(source);
  });

  it("breaks before headings buried mid-sentence", () => {
    // Exactly the shape a collapsed tracker description arrives in.
    const out = reflowFlattenedMarkdown("story text here # Background / Context the lab provides");
    expect(out.split("\n")).toEqual(["story text here", "# Background / Context the lab provides"]);
  });

  it("breaks list markers out of the paragraph", () => {
    const out = reflowFlattenedMarkdown("# Tracking Criteria * Trigger: opens results * Event Name: view");
    expect(out.split("\n")).toEqual(["# Tracking Criteria", "* Trigger: opens results", "* Event Name: view"]);
  });

  it("puts table rows on their own lines", () => {
    const out = reflowFlattenedMarkdown("| 6518227 | HCT: 59.300 | | 6518228 | HCT_ADJ: 56.394 |");
    expect(out.split("\n").length).toBe(2);
  });

  it("does not break prose that merely mentions a hash or an asterisk", () => {
    expect(reflowFlattenedMarkdown("landed in #268 and a 5 * 3 grid")).toBe("landed in #268 and a 5 * 3 grid");
  });

  it("parses into real blocks once reflowed", () => {
    const blocks = parseBlocks(reflowFlattenedMarkdown("intro # Acceptance Criteria * one * two"));
    expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "heading", "list"]);
  });
});

describe("reflow: headings that lost their end", () => {
  it("cuts a heading where a table cell starts", () => {
    const out = reflowFlattenedMarkdown("intro # Background The lab gives | 6518227 | HCT: 59.3 |");
    expect(out.split("\n")[1]).toBe("# Background The lab gives");
  });

  it("cuts a heading at the end of its first sentence", () => {
    const out = reflowFlattenedMarkdown("x # Context This is the title. And this is body prose.");
    expect(out.split("\n")[1]).toBe("# Context This is the title.");
    expect(out.split("\n")[2]).toBe("And this is body prose.");
  });

  it("cuts a heading that simply runs too long to be a title", () => {
    const out = reflowFlattenedMarkdown("x # one two three four five six seven eight nine");
    expect(out.split("\n")[1]).toBe("# one two three four five six");
  });

  it("leaves a short heading whole", () => {
    const out = reflowFlattenedMarkdown("x # Acceptance Criteria");
    expect(out.split("\n")[1]).toBe("# Acceptance Criteria");
  });

  it("removes a run of bare markers left by a flattened list", () => {
    const out = reflowFlattenedMarkdown("x # Acceptance Criteria * * * * # Tracking Criteria");
    expect(out).not.toContain("* *");
    expect(out.split("\n").filter(Boolean)).toEqual(["x", "# Acceptance Criteria", "# Tracking Criteria"]);
  });
});

describe("quotes and rules", () => {
  it("parses a quoted ticket line rather than leaving the marker in the prose", () => {
    const blocks = parseBlocks("> If HCT_ADJ exists, only show HCT_ADJ.");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("quote");
  });

  it("joins consecutive quoted lines into one quote", () => {
    const blocks = parseBlocks("> first\n> second\n\nafter");
    expect(blocks.filter((block) => block.kind === "quote")).toHaveLength(1);
    expect(blocks[blocks.length - 1].kind).toBe("paragraph");
  });

  it("parses a horizontal rule", () => {
    expect(parseBlocks("---").map((block) => block.kind)).toEqual(["rule"]);
    expect(parseBlocks("***").map((block) => block.kind)).toEqual(["rule"]);
    expect(parseBlocks("- - -").map((block) => block.kind)).toEqual(["rule"]);
  });

  it("does not mistake a list item for a rule", () => {
    expect(parseBlocks("- a real item").map((block) => block.kind)).toEqual(["list"]);
  });

  it("does not mistake bold text for a rule", () => {
    expect(parseBlocks("**bold**").map((block) => block.kind)).toEqual(["paragraph"]);
  });

  it("closes an open paragraph at a rule", () => {
    expect(parseBlocks("text\n\n---\n\nmore").map((block) => block.kind)).toEqual([
      "paragraph",
      "rule",
      "paragraph",
    ]);
  });
});

describe("trackerHtmlToMarkdown", () => {
  it("turns a Jira description into readable Markdown", () => {
    const html = '<p data-local-id="9a">Its unclear as to if the data is missing or if it&#039;s just taking a while to load in <br><br>See the attached video clip</p><p data-local-id="37">1111<br></p><figure data-type="media-single"><div data-type="media" data-media-type="file" data-id="5b7" data-alt="screen_recording.mov" data-width="1734"></div></figure>';
    expect(trackerHtmlToMarkdown(html)).toBe(
      "Its unclear as to if the data is missing or if it's just taking a while to load in\n\nSee the attached video clip\n\n1111\n\n[Attachment: screen_recording.mov]",
    );
  });

  it("keeps lists, headings, emphasis and web links", () => {
    const html = '<h2>Steps</h2><ol><li>Open <strong>Reports</strong></li><li>See <a href="https://example.com/x">the page</a></li></ol>';
    expect(trackerHtmlToMarkdown(html)).toBe("## Steps\n\n- Open **Reports**\n- See [the page](https://example.com/x)");
  });

  it("drops links that are not web links", () => {
    expect(trackerHtmlToMarkdown('<p><a href="javascript:alert(1)">click</a></p>')).toBe("click");
  });

  it("leaves Markdown and plain text alone", () => {
    const markdown = "# Title\n\nUse `a < b` and **bold** — 5 * 3";
    expect(trackerHtmlToMarkdown(markdown)).toBe(markdown);
  });

  it("does not turn escaped markup back into tags it then reads", () => {
    expect(trackerHtmlToMarkdown("<p>&lt;script&gt;x&lt;/script&gt;</p>")).toBe("<script>x</script>");
  });
});
