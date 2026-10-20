import { useCallback, useEffect, useRef, useState } from "react";
import type { AddMcpInput } from "../components/AddMcpModal";
import { getProviderById } from "../domain/providers";
import type { BraveliProviderId } from "../domain/types";
import { splitArgs, splitLines } from "../lib/format";
import { actionableError } from "../lib/actionableErrors";

function providerLabel(id: BraveliProviderId) {
  return getProviderById(id)?.displayName ?? String(id);
}

/**
 * Owns MCP-server state for the active project: which provider is selected, the
 * discovered servers per provider, and add/remove/recheck against the real CLIs.
 * The parent supplies the project + an activity sink; everything else lives here.
 */
export function useMcp({
  projectPath,
  projectId,
  onActivity,
}: {
  projectPath: string;
  projectId: string;
  onActivity: (message: string) => void;
}) {
  const [mcpProvider, setMcpProvider] = useState<BraveliProviderId>("claude");
  // Cache keyed by project so switching projects keeps each one's servers.
  const [mcpCache, setMcpCache] = useState<Record<string, Partial<Record<BraveliProviderId, McpListResult>>>>({});
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpBusy, setMcpBusy] = useState("");
  const [mcpAuthBusy, setMcpAuthBusy] = useState("");
  /** The sign-in page the running sign-in printed, to open in any browser. */
  const [mcpAuthUrl, setMcpAuthUrl] = useState("");
  useEffect(() => window.braveli?.onMcpAuthUrl?.((event) => {
    if (event.name === mcpAuthBusyRef.current) setMcpAuthUrl(event.url);
  }), []);
  const mcpAuthBusyRef = useRef("");
  mcpAuthBusyRef.current = mcpAuthBusy;
  const [mcpNotice, setMcpNotice] = useState("");
  const [mcpNoticeTone, setMcpNoticeTone] = useState<"neutral" | "success" | "error">("neutral");

  function clearMcpNotice() {
    setMcpNotice("");
    setMcpNoticeTone("neutral");
  }

  const mcpByProvider = mcpCache[projectId] ?? {};

  const refreshMcp = useCallback(
    async (provider: BraveliProviderId) => {
      if (!projectPath || !window.braveli?.listMcpServers) return;
      setMcpLoading(true);
      try {
        const result = await window.braveli.listMcpServers({ provider, projectId, projectPath });
        setMcpCache((current) => ({ ...current, [projectId]: { ...(current[projectId] ?? {}), [provider]: result } }));
      } catch (error) {
        setMcpCache((current) => ({
          ...current,
          [projectId]: {
            ...(current[projectId] ?? {}),
            [provider]: {
              ok: false,
              provider,
              installed: false,
              supported: false,
              servers: [],
              error: actionableError(error, "mcp"),
            },
          },
        }));
      } finally {
        setMcpLoading(false);
      }
    },
    [projectPath, projectId],
  );

  // Refresh the current tab when the project or provider changes. The cache
  // persists, so switching back shows the previous result instantly (no flash)
  // while this refetch updates it in the background.
  useEffect(() => {
    if (!projectPath) return;
    refreshMcp(mcpProvider);
  }, [projectPath, projectId, mcpProvider, refreshMcp]);

  async function addMcp(input: AddMcpInput): Promise<{ ok: boolean; message?: string }> {
    if (!projectPath || !window.braveli?.addMcpServer) {
      return { ok: false, message: "Open a project first." };
    }
    const name = input.name.trim();
    try {
      const result = await window.braveli.addMcpServer({
        provider: mcpProvider,
        projectPath,
        projectId,
        name,
        transport: input.transport,
        target: input.target.trim(),
        args: input.transport === "stdio" ? splitArgs(input.args) : [],
        env: input.transport === "stdio" ? splitLines(input.env) : [],
        headers: input.transport === "stdio" ? [] : splitLines(input.headers),
        scope: mcpProvider === "claude" || mcpProvider === "gemini" ? input.scope : undefined,
        auth: input.auth,
      });

      if (result.ok) {
        onActivity(`Added MCP server "${name}" to ${providerLabel(mcpProvider)}`);
        await refreshMcp(mcpProvider);
        if (input.auth === "oauth" && ["claude", "codex", "kimi"].includes(mcpProvider)) {
          const authResult = await connectMcpAuth({
            name,
            target: input.target.trim(),
            transport: input.transport.toUpperCase(),
            status: "needs-auth",
            statusText: "Needs authentication",
          });
          if (!authResult.ok) return { ok: false, message: authResult.message };
        }
        return { ok: true };
      }
      return { ok: false, message: actionableError(result.error || result.message, "mcp") };
    } catch (error) {
      return { ok: false, message: actionableError(error, "mcp") };
    }
  }

  async function removeMcp(server: McpServerInfo) {
    if (!projectPath || !window.braveli?.removeMcpServer) return;
    setMcpBusy(server.name);
    clearMcpNotice();
    try {
      const result = await window.braveli.removeMcpServer({
        provider: mcpProvider,
        projectPath,
        projectId,
        name: server.name,
        scope: mcpProvider === "claude" ? "local" : undefined,
      });

      if (result.ok) {
        onActivity(`Removed MCP server "${server.name}" from ${providerLabel(mcpProvider)}`);
        await refreshMcp(mcpProvider);
      } else {
        setMcpNotice(actionableError(result.error || result.message, "mcp"));
        setMcpNoticeTone("error");
      }
    } catch (error) {
      setMcpNotice(actionableError(error, "mcp"));
      setMcpNoticeTone("error");
    } finally {
      setMcpBusy("");
    }
  }

  async function connectMcpAuth(server: McpServerInfo) {
    if (!projectPath || !window.braveli?.connectMcpAuth) {
      return { ok: false, message: "Open a project first." };
    }
    setMcpAuthBusy(server.name);
    mcpAuthBusyRef.current = server.name;
    setMcpAuthUrl("");
    clearMcpNotice();
    try {
      const result = await window.braveli.connectMcpAuth({
        projectId,
        projectPath,
        provider: mcpProvider,
        name: server.name,
        target: server.target,
        transport: server.transport,
      });
      if (result.cancelled) {
        setMcpNotice("Sign-in cancelled.");
        setMcpNoticeTone("neutral");
        return { ok: false, message: "Sign-in cancelled." };
      }
      setMcpNotice(result.ok
        ? result.message || "Authentication connected."
        : actionableError(result.error || result.message || "OAuth authentication was not completed.", "oauth"));
      setMcpNoticeTone(result.ok ? "success" : "error");
      if (result.ok) {
        onActivity(`Connected MCP server "${server.name}" to this project`);
        await refreshMcp(mcpProvider);
      }
      return { ok: result.ok, message: result.message || result.error };
    } catch (error) {
      const message = actionableError(error, "oauth");
      setMcpNotice(message);
      setMcpNoticeTone("error");
      return { ok: false, message };
    } finally {
      setMcpAuthBusy("");
      setMcpAuthUrl("");
    }
  }

  /** Stops a sign-in that is waiting on the browser. */
  async function cancelMcpAuth(server: McpServerInfo) {
    if (!projectPath) return;
    await window.braveli?.cancelMcpAuth?.({ projectPath, provider: mcpProvider, name: server.name });
  }

  async function forgetMcpAuth(server: McpServerInfo) {
    if (!projectPath || !window.braveli?.forgetMcpAuth) return { ok: false, message: "Open a project first." };
    setMcpAuthBusy(server.name);
    clearMcpNotice();
    try {
      const result = await window.braveli.forgetMcpAuth({
        projectId,
        projectPath,
        provider: mcpProvider,
        name: server.name,
      });
      setMcpNotice(result.ok
        ? result.message || "Project authentication removed."
        : actionableError(result.error || result.message, "oauth"));
      setMcpNoticeTone(result.ok ? "success" : "error");
      if (result.ok) {
        onActivity(`Removed project authentication for MCP server "${server.name}"`);
        await refreshMcp(mcpProvider);
      }
      return { ok: result.ok, message: result.message || result.error };
    } catch (error) {
      const message = actionableError(error, "oauth");
      setMcpNotice(message);
      setMcpNoticeTone("error");
      return { ok: false, message };
    } finally {
      setMcpAuthBusy("");
    }
  }

  return {
    mcpProvider,
    setMcpProvider,
    mcpByProvider,
    mcpLoading,
    mcpBusy,
    mcpAuthBusy,
    mcpNotice,
    mcpNoticeTone,
    clearMcpNotice,
    refreshMcp,
    addMcp,
    removeMcp,
    connectMcpAuth,
    cancelMcpAuth,
    mcpAuthUrl,
    forgetMcpAuth,
  };
}
