/// <reference types="vitest/config" />
import { configDefaults } from "vitest/config";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative asset paths so the built index.html works when the packaged app
  // loads it over file:// (absolute "/assets/..." resolves to the filesystem root).
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      // @xterm/headless@6 ships a package.json whose `module` field points at
      // lib/xterm.mjs, a path that is not in the tarball — the build is in
      // lib-headless/. Rollup follows `module` first and fails to resolve the
      // package at all, so the entry is named explicitly.
      "@xterm/headless": "@xterm/headless/lib-headless/xterm-headless.mjs",
    },
  },
  build: {
    rollupOptions: {
      output: {
        // The terminal runtime is large but isolated from most of the shell.
        // Stable vendor chunks keep navigation and project surfaces cached
        // independently while preserving Electron's relative file:// paths.
        manualChunks(id) {
          if (id.includes("node_modules/@xterm/")) return "terminal-vendor";
          if (id.includes("node_modules/lucide-react/")) return "icons-vendor";
          if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/")) return "react-vendor";
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    watch: {
      // Never watch build output — packaging into release/ while dev runs made
      // Vite reload the app into the packaged bundle's files (garbled screen).
      ignored: ["**/release/**", "**/dist/**", "**/.claude/**"],
    },
  },
  test: {
    // Agent worktrees are full copies of the repo; their tests are not ours.
    exclude: [...configDefaults.exclude, "**/.claude/**"],
  },
});
