import { describe, expect, it } from "vitest";
import auth from "./mcpAuthUrl.cjs";

const { findSignInUrl } = auth;

describe("findSignInUrl", () => {
  it("finds the authorize link among colours, the server address and a callback", () => {
    const output = [
      "\u001b[1mAuthenticating with atlassian\u001b[0m at https://mcp.atlassian.com/v2/mcp",
      "Listening on http://localhost:53142/callback",
      "If the browser does not open, visit:",
      "\u001b[36mhttps://auth.atlassian.com/authorize?response_type=code&client_id=abc&code_challenge=xyz&redirect_uri=http%3A%2F%2Flocalhost%3A53142%2Fcallback\u001b[39m",
    ].join("\r\n");
    expect(findSignInUrl(output, "https://mcp.atlassian.com/v2/mcp")).toBe(
      "https://auth.atlassian.com/authorize?response_type=code&client_id=abc&code_challenge=xyz&redirect_uri=http%3A%2F%2Flocalhost%3A53142%2Fcallback",
    );
  });

  it("puts back a link the terminal wrapped", () => {
    const output = "Open https://linear.app/oauth/authorize?client_id=abc&redirect\r\n_uri=http%3A%2F%2Flocalhost%3A9%2Fcb&state=1\r\nWaiting…";
    expect(findSignInUrl(output, "https://mcp.linear.app/sse")).toBe("https://linear.app/oauth/authorize?client_id=abc&redirect_uri=http%3A%2F%2Flocalhost%3A9%2Fcb&state=1");
  });

  it("offers nothing rather than a link that is not a sign-in", () => {
    expect(findSignInUrl("Connecting to https://mcp.atlassian.com/v2/mcp", "https://mcp.atlassian.com/v2/mcp")).toBe("");
    expect(findSignInUrl("", "")).toBe("");
  });
});
