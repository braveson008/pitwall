import { describe, expect, it } from "vitest";
import { checkLabel, formatAge, getLanguageForFile, getTaskStatusLabel, splitArgs, splitLines } from "./format";
import type { ValidationResult } from "../domain/contracts";

describe("format helpers", () => {
  it("splitLines trims and drops empty lines", () => {
    expect(splitLines("a\n\n b \n")).toEqual(["a", "b"]);
    expect(splitLines("")).toEqual([]);
  });

  it("splitArgs splits on any whitespace", () => {
    expect(splitArgs("-y  foo   bar")).toEqual(["-y", "foo", "bar"]);
    expect(splitArgs("")).toEqual([]);
  });

  it("getLanguageForFile maps known extensions and falls back to plaintext", () => {
    expect(getLanguageForFile("a.tsx")).toBe("typescript");
    expect(getLanguageForFile("a.py")).toBe("python");
    expect(getLanguageForFile("a.yaml")).toBe("yaml");
    expect(getLanguageForFile("a.bin")).toBe("plaintext");
  });

  it("getTaskStatusLabel humanizes hyphenated statuses", () => {
    expect(getTaskStatusLabel("review")).toBe("review");
    expect(getTaskStatusLabel("in-review" as never)).toBe("in review");
  });
});

describe("formatAge", () => {
  const from = new Date("2026-09-15T12:00:00Z").getTime();

  it("counts minutes, then hours, then days", () => {
    expect(formatAge("2026-09-15T11:55:00Z", from)).toBe("5m");
    expect(formatAge("2026-09-15T10:00:00Z", from)).toBe("2h");
    expect(formatAge("2026-09-12T12:00:00Z", from)).toBe("3d");
  });

  it("is a dash for anything unreadable, never NaN on the row", () => {
    expect(formatAge("", from)).toBe("\u2014");
    expect(formatAge("not a date", from)).toBe("\u2014");
  });

  it("does not render a negative age from a clock skew", () => {
    expect(formatAge("2026-09-15T12:30:00Z", from)).toBe("0m");
  });
});

describe("checkLabel", () => {
  const result = (ok: boolean): ValidationResult => ({ ok, checks: [], ranAt: "2026-09-15T12:00:00Z" });

  it("says nothing ran when nothing ran", () => {
    expect(checkLabel(undefined)).toBe("\u2014");
  });

  it("reports pass and fail", () => {
    expect(checkLabel(result(true))).toBe("pass");
    expect(checkLabel(result(false))).toBe("fail");
  });
});
