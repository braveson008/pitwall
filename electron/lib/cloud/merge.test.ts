import { describe, expect, it } from "vitest";
import merge from "./merge.cjs";

const { mergeRecords, stampClock, tombstone } = merge;
const T1 = "2026-10-12T10:00:00.000Z";
const T2 = "2026-10-12T10:01:00.000Z";
const T3 = "2026-10-12T10:02:00.000Z";

describe("stampClock", () => {
  it("stamps every field of a new record, and only changed fields after that", () => {
    const first = { data: { title: "a", status: "ready" }, clock: stampClock(null, { title: "a", status: "ready" }, T1) };
    expect(first.clock).toEqual({ title: T1, status: T1 });
    expect(stampClock(first, { title: "b", status: "ready", owner: "me" }, T2)).toEqual({ title: T2, status: T1, owner: T2 });
  });

  it("stamps a removed field so its removal can win", () => {
    const before = { data: { title: "a", note: "x" }, clock: { title: T1, note: T1 } };
    expect(stampClock(before, { title: "a" }, T2)).toEqual({ title: T1, note: T2 });
  });
});

describe("mergeRecords", () => {
  it("keeps edits to different fields from both sides", () => {
    const local = { data: { title: "Local title", status: "ready" }, clock: { title: T2, status: T1 } };
    const remote = { data: { title: "Old", status: "running" }, clock: { title: T1, status: T3 } };
    expect(mergeRecords(local, remote)).toEqual({ data: { title: "Local title", status: "running" }, clock: { title: T2, status: T3 } });
  });

  it("takes the newer value of the same field, and the remote one on a tie", () => {
    const local = { data: { title: "mine" }, clock: { title: T2 } };
    expect(mergeRecords(local, { data: { title: "theirs" }, clock: { title: T3 } }).data.title).toBe("theirs");
    expect(mergeRecords(local, { data: { title: "theirs" }, clock: { title: T1 } }).data.title).toBe("mine");
    expect(mergeRecords(local, { data: { title: "theirs" }, clock: { title: T2 } }).data.title).toBe("theirs");
  });

  it("drops a field whose newest change was its removal", () => {
    const local = { data: { title: "a" }, clock: { title: T1, note: T3 } };
    const remote = { data: { title: "a", note: "old note" }, clock: { title: T1, note: T2 } };
    expect(mergeRecords(local, remote).data).toEqual({ title: "a" });
  });

  it("unions lists of items by id, keeping the newer copy of each", () => {
    const local = { data: { records: [{ id: "1", text: "one", updatedAt: T2 }, { id: "2", text: "two" }] }, clock: { records: T2 } };
    const remote = { data: { records: [{ id: "1", text: "uno", updatedAt: T1 }, { id: "3", text: "three" }] }, clock: { records: T3 } };
    expect(mergeRecords(local, remote, { setFields: ["records"] }).data.records).toEqual([
      { id: "1", text: "one", updatedAt: T2 },
      { id: "2", text: "two" },
      { id: "3", text: "three" },
    ]);
  });

  it("lets a delete win over older edits, and a newer edit bring the record back", () => {
    const edited = { data: { title: "a" }, clock: { title: T2 } };
    expect(mergeRecords(edited, tombstone(T3))).toMatchObject({ deleted: true });
    expect(mergeRecords(tombstone(T1), edited)).toEqual({ data: { title: "a" }, clock: { title: T2 } });
  });
});
