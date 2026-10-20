import { describe, expect, it } from "vitest";
import { excerptBlocks, formatKnowledge } from "./knowledgeText";

const kinds = (source: string) => formatKnowledge(source).map((block) => block.type);

describe("knowledge record formatting", () => {
  it("turns leading YAML front matter into fields rather than fence lines", () => {
    const blocks = formatKnowledge("---\ntitle: AGENTS — AI assistant instructions\nstatus: active\n---\n\nBody text.");
    expect(blocks[0]).toEqual({
      type: "fields",
      fields: [
        { name: "title", value: "AGENTS — AI assistant instructions" },
        { name: "status", value: "active" },
      ],
    });
    expect(kinds("---\na: 1\n---\n\nBody.")).toEqual(["fields", "paragraph"]);
  });

  it("keeps a plain horizontal rule a rule when no fields follow it", () => {
    expect(kinds("Body first.\n\n---\n\nMore body.")).toEqual(["paragraph", "rule", "paragraph"]);
  });

  it("reads a fenced field block after a sentence, which is where excerpts usually put it", () => {
    const blocks = formatKnowledge(
      "Observed documentation at AGENTS.md.\n\n---\ntitle: AGENTS\nstatus: active\n---\n\n# Agent instructions",
    );
    expect(blocks.map((block) => block.type)).toEqual(["paragraph", "fields", "heading"]);
    expect(blocks[1].type === "fields" && blocks[1].fields).toEqual([
      { name: "title", value: "AGENTS" },
      { name: "status", value: "active" },
    ]);
  });

  it("leaves an unterminated fence as a rule instead of swallowing the record", () => {
    const blocks = formatKnowledge("---\ntitle: unfinished\n\nBody that never closes the block.");
    expect(blocks.map((block) => block.type)).toEqual(["rule", "paragraph", "paragraph"]);
    const last = blocks.at(-1);
    expect(last?.type === "paragraph" && last.spans).toEqual([{ text: "Body that never closes the block." }]);
  });

  it("promotes markdown headings and keeps their level", () => {
    const blocks = formatKnowledge("# Agent instructions\n\n## First steps");
    expect(blocks).toEqual([
      { type: "heading", level: 1, spans: [{ text: "Agent instructions" }] },
      { type: "heading", level: 2, spans: [{ text: "First steps" }] },
    ]);
  });

  it("groups consecutive bullets into one list and keeps ordered markers", () => {
    const blocks = formatKnowledge("- first\n- second\n\n1. one\n2. two");
    expect(blocks.map((block) => [block.type, "ordered" in block ? block.ordered : null])).toEqual([
      ["list", false],
      ["list", true],
    ]);
    expect(blocks[0].type === "list" && blocks[0].items).toHaveLength(2);
  });

  it("renders inline code and link text without their markup", () => {
    const [block] = formatKnowledge("If working under `apps/voy/`, read [`apps/voy/AGENTS.md`](./apps/voy/AGENTS.md).");
    expect(block.type === "paragraph" && block.spans).toEqual([
      { text: "If working under " },
      { text: "apps/voy/", code: true },
      { text: ", read " },
      { text: "apps/voy/AGENTS.md", code: true, href: "./apps/voy/AGENTS.md" },
      { text: "." },
    ]);
  });

  it("keeps a fenced code block verbatim, including its blank lines", () => {
    const blocks = formatKnowledge("Run it:\n\n```bash\nnpm run build\n\nnpm test\n```");
    expect(blocks[1]).toEqual({ type: "code", text: "npm run build\n\nnpm test" });
  });

  it("reads plain key/value lines as fields when a record is a run of them", () => {
    const [block] = formatKnowledge("Configured script in apps/nhs/package.json: pnpm run android\nWorking directory: apps/nhs");
    expect(block).toEqual({
      type: "fields",
      fields: [
        { name: "Configured script in apps/nhs/package.json", value: "pnpm run android" },
        { name: "Working directory", value: "apps/nhs" },
      ],
    });
  });

  it("does not mistake ordinary prose containing a colon for a field", () => {
    expect(kinds("Observed documentation at AGENTS.md: this is an excerpt, not a verified architectural conclusion.")).toEqual(["paragraph"]);
  });

  it("returns nothing for empty or whitespace-only content", () => {
    expect(formatKnowledge("   \n\n  ")).toEqual([]);
  });

  it("excerpts whole blocks so a heading is never cut from its body", () => {
    const blocks = formatKnowledge("# Title\n\n" + "word ".repeat(200) + "\n\n## Later section");
    const excerpt = excerptBlocks(blocks, 100);
    expect(excerpt.truncated).toBe(true);
    expect(excerpt.blocks.map((block) => block.type)).toEqual(["heading", "paragraph"]);
  });

  it("keeps a short record whole and reports no truncation", () => {
    const blocks = formatKnowledge("A short note.");
    expect(excerptBlocks(blocks, 500)).toEqual({ blocks, truncated: false });
  });
});
