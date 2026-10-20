import { describe, expect, it } from "vitest";
import { hermesStatusDetail } from "./HermesPanel";

describe("hermesStatusDetail", () => {
  it("does not call an installed Hermes that only needs signing in uninstalled", () => {
    expect(hermesStatusDetail({ kind: "not-set-up", installed: true }, "alpha")).toBe(
      "Hermes is installed but not signed in, so finished work comes straight to you without a review.",
    );
  });

  it("says it is not installed when it is not", () => {
    expect(hermesStatusDetail({ kind: "not-set-up", installed: false }, "alpha")).toBe(
      "Hermes is not installed, so finished work comes straight to you without a review.",
    );
  });

  it("names the project it is switched off for", () => {
    expect(hermesStatusDetail({ kind: "off" }, "alpha")).toBe("Switched off for alpha: its finished work comes straight to you.");
  });
});
