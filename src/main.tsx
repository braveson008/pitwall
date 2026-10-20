import React from "react";
import ReactDOM from "react-dom/client";
// The faces the interface font picker offers. Bundled, because a desktop app
// that waits on a CDN for its own typeface is one that flickers.
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/open-sans/400.css";
import "@fontsource/open-sans/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "@fontsource/jetbrains-mono/700.css";
import "@fontsource/lilex/400.css";
import "@fontsource/lilex/500.css";
import "@fontsource/lilex/600.css";
import "@fontsource/lilex/700.css";
import { App } from "./App";
import { guardBackdropClicks } from "./lib/backdropClicks";
import "./styles.css";
import "./styles/workspace.css";
import "./styles/shell.css";
import "./styles/council.css";
import "./styles/desktop.css";
import "./styles/desktop/home.css";
import "./styles/desktop/work.css";
import "./styles/desktop/app.css";
import "./styles/desktop/projects.css";
import "./styles/desktop/session.css";
import "./styles/desktop/council.css";
import "./styles/desktop/settings.css";
import "./styles/desktop/dialogs.css";
// Last, so the three terminal themes replace the tokens set above.
import "./styles/themes.css";

// A browser has no main process, so the UI is unreachable without one. `?mock`
// stands in with fixed data — development only, and dynamically imported so it
// never reaches a release bundle.
if (import.meta.env.DEV && new URLSearchParams(location.search).has("mock")) {
  const { installMockBridge } = await import("./dev/mockBridge");
  installMockBridge();
}

// Written to the same log as main-process stalls, so a freeze can be placed on
// one side of the IPC boundary or the other.
if (window.braveli?.reportLongTask && typeof PerformanceObserver !== "undefined") {
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration >= 200) window.braveli?.reportLongTask?.(entry.duration);
      }
    }).observe({ type: "longtask", buffered: true });
  } catch {
    // An engine without long-task timing simply records nothing.
  }
}

guardBackdropClicks();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
