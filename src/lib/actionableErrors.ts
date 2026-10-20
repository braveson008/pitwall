export type ErrorContext = "agent" | "mcp" | "oauth" | "filesystem" | "general";

export function actionableError(error: unknown, context: ErrorContext = "general") {
  const raw = error instanceof Error ? error.message : String(error || "Unknown error");
  const message = raw.replace(/\s+/g, " ").trim();

  if (/not found|enoent|command not found/i.test(message)) {
    return context === "mcp"
      ? "The provider CLI is not installed or is not on PATH. Install it, then recheck MCP servers."
      : "The required CLI is not installed or is not on PATH. Install it, then retry.";
  }
  if (/oauth|authentication|authoriz|sign.?in|log.?in|unauthor/i.test(message)) {
    return /cancel|closed|not completed/i.test(message)
      ? "Authentication was cancelled or the browser callback did not finish. Start Connect again and keep Pitwall open."
      : "Authentication is required. Connect the account for this project, then retry.";
  }
  if (/timed? ?out|timeout|etimedout/i.test(message)) {
    return "The provider did not respond in time. Check the network and provider status, then retry.";
  }
  if (/eacces|permission denied|operation not permitted/i.test(message)) {
    return "Pitwall does not have permission to access this resource. Check file and macOS privacy permissions, then retry.";
  }
  if (/enotfound|econnrefused|network|fetch failed/i.test(message)) {
    return "The provider could not be reached. Check the server URL and network connection, then retry.";
  }
  return message || "The operation failed. Retry, then check the provider CLI output if it continues.";
}
