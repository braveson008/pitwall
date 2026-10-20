const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  buildChangeset,
  normalisePath,
  parseNameStatus,
  parseNumstat,
} = require("../electron/lib/gitChangeset.cjs");

describe("parseNumstat", () => {
  it("reads additions and deletions", () => {
    const stats = parseNumstat("12\t3\tsrc/app.ts\n0\t8\tsrc/old.ts\n");
    assert.deepEqual(stats.get("src/app.ts"), { binary: false, additions: 12, deletions: 3 });
    assert.deepEqual(stats.get("src/old.ts"), { binary: false, additions: 0, deletions: 8 });
  });

  it("marks a binary file rather than calling it zero lines", () => {
    const stats = parseNumstat("-\t-\tassets/logo.png\n");
    assert.equal(stats.get("assets/logo.png").binary, true);
    assert.equal(stats.get("assets/logo.png").additions, null);
  });

  it("ignores blank lines", () => {
    assert.equal(parseNumstat("\n\n").size, 0);
    assert.equal(parseNumstat(null).size, 0);
  });

  it("keeps paths containing spaces", () => {
    const stats = parseNumstat("1\t1\tsrc/my file.ts\n");
    assert.ok(stats.has("src/my file.ts"));
  });
});

describe("normalisePath", () => {
  it("reduces a braced rename to its destination", () => {
    assert.equal(normalisePath("src/{old => new}/file.ts"), "src/new/file.ts");
  });

  it("reduces a bare rename to its destination", () => {
    assert.equal(normalisePath("old.ts => new.ts"), "new.ts");
  });

  it("leaves an ordinary path alone", () => {
    assert.equal(normalisePath("src/app.ts"), "src/app.ts");
  });
});

describe("parseNameStatus", () => {
  it("names each kind of change", () => {
    const entries = parseNameStatus("A\tsrc/new.ts\nM\tsrc/app.ts\nD\tsrc/gone.ts\n");
    assert.deepEqual(entries.map((e) => e.status), ["added", "modified", "deleted"]);
  });

  it("records where a rename came from", () => {
    const [entry] = parseNameStatus("R096\tsrc/old.ts\tsrc/new.ts\n");
    assert.equal(entry.status, "renamed");
    assert.equal(entry.from, "src/old.ts");
    assert.equal(entry.path, "src/new.ts");
  });

  it("skips a rename with no destination rather than inventing one", () => {
    assert.equal(parseNameStatus("R100\tsrc/old.ts\n").length, 0);
  });
});

describe("buildChangeset", () => {
  it("joins the two listings and totals them", () => {
    const result = buildChangeset(
      "M\tsrc/app.ts\nA\tsrc/new.ts\n",
      "12\t3\tsrc/app.ts\n40\t0\tsrc/new.ts\n",
    );
    assert.equal(result.files.length, 2);
    assert.equal(result.additions, 52);
    assert.equal(result.deletions, 3);
  });

  it("puts the biggest change first, so a reviewer starts where the work is", () => {
    const result = buildChangeset(
      "M\ta.ts\nM\tb.ts\n",
      "1\t1\ta.ts\n90\t10\tb.ts\n",
    );
    assert.equal(result.files[0].path, "b.ts");
  });

  it("matches a rename across the two listings", () => {
    const result = buildChangeset(
      "R100\tsrc/old.ts\tsrc/new.ts\n",
      "0\t0\tsrc/{old => new}.ts\n",
    );
    assert.equal(result.files[0].path, "src/new.ts");
    assert.equal(result.files[0].from, "src/old.ts");
    assert.equal(result.files[0].status, "renamed");
  });

  it("counts a binary file as zero lines without claiming it is unchanged", () => {
    const result = buildChangeset("M\tlogo.png\n", "-\t-\tlogo.png\n");
    assert.equal(result.files[0].binary, true);
    assert.equal(result.additions, 0);
  });

  it("survives an empty changeset", () => {
    const result = buildChangeset("", "");
    assert.deepEqual(result, { files: [], untrackedFiles: [], additions: 0, deletions: 0 });
  });
});

describe("buildChangeset reports only what git tracks", () => {
  it("leaves the untracked bucket for the caller to fill", () => {
    const result = buildChangeset("M\tsrc/app.ts\n", "10\t2\tsrc/app.ts\n");
    assert.deepEqual(result.untrackedFiles, []);
    assert.deepEqual(result.files.map((f) => f.path), ["src/app.ts"]);
  });

  it("counts only tracked changes, since only those reach a pull request", () => {
    const result = buildChangeset("M\tsrc/app.ts\n", "10\t2\tsrc/app.ts\n");
    assert.equal(result.additions, 10);
    assert.equal(result.deletions, 2);
  });

  it("has no opinion about which directory a file is in", () => {
    // The old rule singled out .pitwall. Whether a file counts is now decided
    // by git, not by its name.
    const result = buildChangeset(
      "A\t.pitwall/council/a/thread.md\nA\tgraphify-out/.graphify_root\n",
      "357\t0\t.pitwall/council/a/thread.md\n1\t0\tgraphify-out/.graphify_root\n",
    );
    assert.equal(result.files.length, 2);
  });
});
