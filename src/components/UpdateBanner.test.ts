import { describe, expect, it } from "vitest";
import { shouldOfferUpdate } from "./UpdateBanner";

const ready = { status: "ready", availableVersion: "0.2.32", progress: 100, message: "" } as UpdateState;

describe("update banner", () => {
  it("offers a downloaded update once per version", () => {
    expect(shouldOfferUpdate(ready, null)).toBe(true);
    expect(shouldOfferUpdate(ready, { version: "0.2.32", at: Date.now() })).toBe(false);
    expect(shouldOfferUpdate(ready, { version: "0.2.31", at: Date.now() })).toBe(true);
  });

  it("asks once more after three days of Later", () => {
    const fourDaysAgo = Date.now() - 4 * 24 * 60 * 60 * 1000;
    expect(shouldOfferUpdate(ready, { version: "0.2.32", at: fourDaysAgo })).toBe(true);
  });

  it("says nothing until the update is downloaded", () => {
    expect(shouldOfferUpdate({ ...ready, status: "downloading" } as UpdateState, null)).toBe(false);
    expect(shouldOfferUpdate(null, null)).toBe(false);
  });
});
