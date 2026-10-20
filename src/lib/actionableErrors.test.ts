import { describe, expect, it } from "vitest";
import { actionableError } from "./actionableErrors";

describe("actionableError", () => {
  it("turns missing commands into a recovery step", () => {
    expect(actionableError("spawn kimi ENOENT", "agent")).toContain("Install it");
  });

  it("distinguishes cancelled OAuth from a generic failure", () => {
    expect(actionableError("OAuth authentication was not completed", "oauth")).toContain("cancelled");
  });

  it("keeps useful provider errors", () => {
    expect(actionableError("Server rejected invalid scope", "mcp")).toBe("Server rejected invalid scope");
  });
});
