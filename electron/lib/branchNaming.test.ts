import { describe, expect, it } from "vitest";
import naming from "./branchNaming.cjs";

const { conventionalBranchName, isBranchRuleRejection, parseRemoteHeads } = naming;

describe("branch names a repository accepts", () => {
  it("recognises a refused branch name", () => {
    expect(isBranchRuleRejection("remote: error: GH013: Repository rule violations found for refs/heads/acme-2687.")).toBe(true);
    expect(isBranchRuleRejection("remote: Invalid username or token.")).toBe(false);
  });

  it("follows the prefix and casing most ticket branches use", () => {
    const remoteBranches = ["dev", "main", "feature/ACME-2687-customer-vip-tag", "feature/ACME-2600-stream-crud", "fix/ACME-2511-promo", "release/1.2"];
    expect(conventionalBranchName({ remoteBranches, ticket: "acme-2687", title: "BO: Display VIP Tag conditionally on Customer Details Modal." }))
      .toBe("feature/ACME-2687-bo-display-vip-tag-conditionally");
  });

  it("keeps lower-case keys where the repository does", () => {
    expect(conventionalBranchName({ remoteBranches: ["bugfix/shop-1840-scroll", "bugfix/shop-1900-x"], ticket: "SHOP-1967", title: "JSON picker value" }))
      .toBe("bugfix/shop-1967-json-picker-value");
  });

  it("never retries with the prefix the repository just refused", () => {
    const remoteBranches = ["web-1106", "ret-156", "uni-23", "med-1021", "feat/WEB-225", "fix/web-961-review-followups"];
    expect(conventionalBranchName({ remoteBranches, rejected: "web-1107", ticket: "WEB-1107", title: "Onboarding redirect" }))
      .toMatch(/^(feat|fix)\//);
  });

  it("learns from the ticket's own project before the rest of the repository", () => {
    const remoteBranches = ["fix/UNI-1", "fix/UNI-2", "fix/UNI-3", "feature/web-815-review-fixes", "feature/web-961-under-30s"];
    expect(conventionalBranchName({ remoteBranches, rejected: "web-1106", ticket: "WEB-1106", title: "Onboarding redirect" }))
      .toBe("feature/web-1106-onboarding-redirect");
  });

  it("falls back to the commonest folder, then feature/", () => {
    expect(conventionalBranchName({ remoteBranches: ["chore/deps", "chore/ci", "main"], ticket: "", title: "Add VIP tag" })).toBe("chore/add-vip-tag");
    expect(conventionalBranchName({ remoteBranches: ["main"], ticket: "T-1", title: "Fix it" })).toBe("feature/T-1-fix-it");
  });

  it("reads ls-remote output", () => {
    expect(parseRemoteHeads("abc\trefs/heads/main\ndef\trefs/heads/feature/X-1-a\n")).toEqual(["main", "feature/X-1-a"]);
  });
});
