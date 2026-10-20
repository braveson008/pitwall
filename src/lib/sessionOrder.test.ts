import { describe, expect, it } from "vitest";
import { applySessionOrder, moveSessionTo, nudgeSession, pruneSessionOrder } from "./sessionOrder";

const sessions = (...ids: string[]) => ids.map((id) => ({ id }));
const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

describe("applySessionOrder", () => {
  it("leaves the natural order alone until something has been arranged", () => {
    expect(ids(applySessionOrder(sessions("a", "b", "c"), []))).toEqual(["a", "b", "c"]);
  });

  it("puts sessions in the arranged order", () => {
    expect(ids(applySessionOrder(sessions("a", "b", "c"), ["c", "a", "b"]))).toEqual(["c", "a", "b"]);
  });

  it("appends sessions created since the last drag, in arrival order", () => {
    // Not interleaved: a new session appearing in the middle of an arranged
    // list is indistinguishable from the list rearranging itself.
    expect(ids(applySessionOrder(sessions("a", "b", "c", "d"), ["c", "a"]))).toEqual(["c", "a", "b", "d"]);
  });

  it("ignores ids for sessions that have been deleted", () => {
    expect(ids(applySessionOrder(sessions("a", "b"), ["gone", "b", "a"]))).toEqual(["b", "a"]);
  });

  it("does not mutate its input", () => {
    const input = sessions("a", "b");
    applySessionOrder(input, ["b", "a"]);
    expect(ids(input)).toEqual(["a", "b"]);
  });
});

describe("moveSessionTo", () => {
  it("moves a row down, accounting for the gap it leaves behind", () => {
    // Slot 3 is the gap between c and d. Lifting `a` closes the gap it was in,
    // so the row lands third, not fourth.
    expect(moveSessionTo(["a", "b", "c", "d"], "a", 3)).toEqual(["b", "c", "a", "d"]);
  });

  it("moves a row up", () => {
    expect(moveSessionTo(["a", "b", "c"], "c", 0)).toEqual(["c", "a", "b"]);
  });

  it("drops to the very end", () => {
    expect(moveSessionTo(["a", "b", "c"], "a", 3)).toEqual(["b", "c", "a"]);
  });

  it("treats both gaps touching a row as leaving it where it is", () => {
    expect(moveSessionTo(["a", "b", "c"], "b", 1)).toEqual(["a", "b", "c"]);
    expect(moveSessionTo(["a", "b", "c"], "b", 2)).toEqual(["a", "b", "c"]);
  });

  it("clamps a slot outside the list", () => {
    expect(moveSessionTo(["a", "b", "c"], "a", 99)).toEqual(["b", "c", "a"]);
    expect(moveSessionTo(["a", "b", "c"], "c", -4)).toEqual(["c", "a", "b"]);
  });

  it("ignores an id that is not in the list", () => {
    expect(moveSessionTo(["a", "b"], "ghost", 0)).toEqual(["a", "b"]);
  });

  it("never loses or duplicates a row", () => {
    const start = ["a", "b", "c", "d", "e"];
    for (const id of start) {
      for (let slot = -1; slot <= start.length + 1; slot += 1) {
        expect([...moveSessionTo(start, id, slot)].sort()).toEqual([...start].sort());
      }
    }
  });
});

describe("nudgeSession", () => {
  it("moves one position at a time", () => {
    expect(nudgeSession(["a", "b", "c"], "a", 1)).toEqual(["b", "a", "c"]);
    expect(nudgeSession(["a", "b", "c"], "c", -1)).toEqual(["a", "c", "b"]);
  });

  it("stops at the ends rather than wrapping", () => {
    expect(nudgeSession(["a", "b"], "a", -1)).toEqual(["a", "b"]);
    expect(nudgeSession(["a", "b"], "b", 1)).toEqual(["a", "b"]);
  });
});

describe("pruneSessionOrder", () => {
  it("drops ids whose sessions are gone", () => {
    expect(pruneSessionOrder(["a", "gone", "b"], sessions("a", "b"))).toEqual(["a", "b"]);
  });

  it("keeps the arranged order of the survivors", () => {
    expect(pruneSessionOrder(["c", "a", "b"], sessions("a", "b", "c"))).toEqual(["c", "a", "b"]);
  });
});
