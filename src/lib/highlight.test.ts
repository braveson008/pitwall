import { describe, expect, it } from "vitest";
import { INITIAL_STATE, highlightLine, languageFromPath, type Language } from "./highlight";

const kinds = (line: string, language: Language = "ts") =>
  highlightLine(line, language, INITIAL_STATE).tokens.map((t) => `${t.kind}:${t.text}`);

const text = (line: string, language: Language = "ts") =>
  highlightLine(line, language, INITIAL_STATE).tokens.map((t) => t.text).join("");

describe("languageFromPath", () => {
  it("reads the extension", () => {
    expect(languageFromPath("src/app.tsx")).toBe("ts");
    expect(languageFromPath("src/styles.css")).toBe("css");
    expect(languageFromPath("package.json")).toBe("json");
    expect(languageFromPath("index.html")).toBe("markup");
    expect(languageFromPath("scripts/deploy.sh")).toBe("shell");
  });

  it("knows files that have no extension", () => {
    expect(languageFromPath("Dockerfile")).toBe("shell");
    expect(languageFromPath("path/to/Makefile")).toBe("shell");
  });

  it("falls back rather than guessing", () => {
    expect(languageFromPath("LICENSE")).toBe("plain");
    expect(languageFromPath("data.parquet")).toBe("plain");
  });
});

describe("highlightLine", () => {
  it("never loses or reorders a character", () => {
    const samples = [
      `const x = "a\\"b" + \`t\${y}\` // trailing`,
      `if (a >= 1_000 && b !== 0x1F) { return [1, 2]; }`,
      `export type Foo<T> = { bar?: string };`,
    ];
    for (const sample of samples) expect(text(sample)).toBe(sample);
  });

  it("marks keywords, strings, numbers and comments", () => {
    const out = kinds(`const total = 42; // done`);
    expect(out).toContain("keyword:const");
    expect(out).toContain("number:42");
    expect(out).toContain("comment:// done");
  });

  it("does not colour a keyword that is only part of a word", () => {
    const out = highlightLine("constant = 1", "ts", INITIAL_STATE).tokens;
    expect(out[0]).toMatchObject({ kind: "plain" });
    expect(out[0].text.startsWith("constant")).toBe(true);
    expect(kinds("myClass()")).toContain("function:myClass");
  });

  it("treats a capitalised name as a type and a called name as a function", () => {
    const out = kinds("const a = new Widget(); render();");
    expect(out).toContain("type:Widget");
    expect(out).toContain("function:render");
  });

  it("keeps an escaped quote inside the string", () => {
    expect(kinds(`const s = "a\\"b";`)).toContain(`string:"a\\"b"`);
  });
});

describe("state carried between lines", () => {
  it("keeps a block comment open across lines, which is the whole point", () => {
    const first = highlightLine("/* explaining", "ts", INITIAL_STATE);
    expect(first.state.comment).toBe(true);

    const middle = highlightLine("   still the comment", "ts", first.state);
    expect(middle.tokens.every((t) => t.kind === "comment")).toBe(true);
    expect(middle.state.comment).toBe(true);

    const last = highlightLine(" done */ const x = 1;", "ts", middle.state);
    expect(last.state.comment).toBe(false);
    expect(last.tokens.map((t) => `${t.kind}:${t.text}`)).toContain("keyword:const");
  });

  it("closes a block comment that opens and closes on one line", () => {
    expect(highlightLine("/* here */ const x = 1;", "ts", INITIAL_STATE).state.comment).toBe(false);
  });

  it("keeps a template literal open across lines", () => {
    const first = highlightLine("const q = `SELECT", "ts", INITIAL_STATE);
    expect(first.state.template).toBe(true);

    const second = highlightLine("  FROM users`;", "ts", first.state);
    expect(second.state.template).toBe(false);
    expect(second.tokens[0].kind).toBe("string");
  });

  it("does not leak state out of a single-line template", () => {
    expect(highlightLine("const a = `x`;", "ts", INITIAL_STATE).state.template).toBe(false);
  });
});

describe("other languages", () => {
  it("marks css properties and custom properties", () => {
    expect(kinds("  color: red;", "css")).toContain("property:color");
    expect(kinds("  --accent: #fff;", "css")).toContain("property:--accent");
  });

  it("marks json literals but not its keys as keywords", () => {
    const out = kinds('{ "enabled": true }', "json");
    expect(out).toContain("keyword:true");
    expect(out).toContain('string:"enabled"');
  });

  it("marks markup tags, attributes and values", () => {
    const out = kinds('<link rel="stylesheet">', "markup");
    expect(out).toContain("tag:<link");
    expect(out).toContain("attribute:rel");
    expect(out).toContain('string:"stylesheet"');
  });

  it("marks shell comments and variables", () => {
    const out = kinds('export PATH="$HOME/bin" # note', "shell");
    expect(out).toContain("keyword:export");
    expect(out).toContain("comment:# note");
  });

  it("leaves an unknown language entirely alone", () => {
    const line = "whatever this is";
    expect(kinds(line, "plain")).toEqual([`plain:${line}`]);
  });

  it("does not lose characters in any language", () => {
    const cases: Array<[string, Language]> = [
      ["  --accent: #fff;", "css"],
      ['{ "a": [1, true] }', "json"],
      ['<a href="/x">go</a>', "markup"],
      ['echo "$HOME" # hi', "shell"],
    ];
    for (const [line, language] of cases) expect(text(line, language)).toBe(line);
  });

  it("handles an empty line", () => {
    expect(text("")).toBe("");
  });
});
