import { createRoot } from "react-dom/client";
import { AgentMarketplace } from "../../src/components/AgentMarketplace";
import "../../src/styles.css";
import "../../src/styles/workspace.css";

// A theme switch, so the preview can be judged in both without a rebuild.
const theme = new URLSearchParams(location.search).get("theme") ?? "dark";
document.documentElement.dataset.theme = theme;

const noop = () => {};

createRoot(document.getElementById("root")!).render(
  <div style={{ height: "100vh", overflow: "auto", padding: "22px 24px", maxWidth: 1080, margin: "0 auto" }}>
    <AgentMarketplace
      installedCommands={{ qwen: true, continue: true }}
      liveModels={{}}
      drivableCommands={new Set(["opencode", "crush", "amp"])}
      localModelCount={0}
      onInstall={noop}
      onAgentReady={noop}
    />
  </div>,
);
