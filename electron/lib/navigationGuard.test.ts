import { describe, expect, it } from "vitest";
import { isAppDocumentUrl, isExternallyOpenable } from "./navigationGuard.cjs";

const DIST = "/Applications/Pitwall.app/Contents/Resources/app.asar/dist";
// A Mac install, read as a Mac reads it on whichever machine runs the suite.
const packaged = { distRoot: DIST, platform: "darwin" };
const dev = { devServer: "http://127.0.0.1:5173" };

describe("isAppDocumentUrl — packaged", () => {
  it("accepts the app's own entry point", () => {
    expect(isAppDocumentUrl(`file://${DIST}/index.html`, packaged)).toBe(true);
  });

  it("accepts assets nested inside dist", () => {
    expect(isAppDocumentUrl(`file://${DIST}/assets/index-abc123.js`, packaged)).toBe(true);
  });

  // The reason this is path containment and not startsWith.
  it("rejects a sibling directory that shares the dist prefix", () => {
    expect(isAppDocumentUrl(`file://${DIST}-evil/index.html`, packaged)).toBe(false);
  });

  it("rejects traversal back out of dist", () => {
    expect(isAppDocumentUrl(`file://${DIST}/../../../../../etc/passwd`, packaged)).toBe(false);
  });

  it("rejects percent-encoded traversal", () => {
    expect(isAppDocumentUrl(`file://${DIST}/%2e%2e/%2e%2e/etc/passwd`, packaged)).toBe(false);
  });

  it("rejects remote origins", () => {
    expect(isAppDocumentUrl("https://example.com/", packaged)).toBe(false);
    expect(isAppDocumentUrl("http://127.0.0.1:3845/", packaged)).toBe(false);
  });

  it("rejects non-file schemes that could reach the bridge", () => {
    expect(isAppDocumentUrl("javascript:alert(1)", packaged)).toBe(false);
    expect(isAppDocumentUrl("data:text/html,<script>1</script>", packaged)).toBe(false);
  });

  it("rejects junk rather than throwing", () => {
    expect(isAppDocumentUrl("", packaged)).toBe(false);
    expect(isAppDocumentUrl("not a url", packaged)).toBe(false);
    expect(isAppDocumentUrl(undefined as unknown as string, packaged)).toBe(false);
  });

  it("rejects everything when no dist root is configured", () => {
    expect(isAppDocumentUrl(`file://${DIST}/index.html`, {})).toBe(false);
  });
});

describe("isAppDocumentUrl — dev server", () => {
  it("accepts the configured dev server", () => {
    expect(isAppDocumentUrl("http://127.0.0.1:5173/", dev)).toBe(true);
    expect(isAppDocumentUrl("http://127.0.0.1:5173/src/main.tsx", dev)).toBe(true);
  });

  it("rejects a different port or host", () => {
    expect(isAppDocumentUrl("http://127.0.0.1:5174/", dev)).toBe(false);
    expect(isAppDocumentUrl("http://evil.test/", dev)).toBe(false);
  });
});

describe("isExternallyOpenable", () => {
  it("allows http and https", () => {
    expect(isExternallyOpenable("https://figma.com")).toBe(true);
    expect(isExternallyOpenable("http://localhost:3000")).toBe(true);
  });

  // openExternal hands custom schemes to whichever app claims them, so a guard
  // that forwarded these would be worse than no guard.
  it("refuses file, javascript and custom schemes", () => {
    expect(isExternallyOpenable("file:///etc/passwd")).toBe(false);
    expect(isExternallyOpenable("javascript:alert(1)")).toBe(false);
    expect(isExternallyOpenable("ms-msdt:/id")).toBe(false);
    expect(isExternallyOpenable("")).toBe(false);
  });
});

describe("isAppDocumentUrl — packaged on Windows", () => {
  const distRoot = "C:\\Program Files\\Pitwall\\resources\\app.asar\\dist";
  it("accepts the app's own entry point, whose URL path starts /C:/", () => {
    expect(isAppDocumentUrl("file:///C:/Program%20Files/Pitwall/resources/app.asar/dist/index.html", { distRoot, platform: "win32" })).toBe(true);
  });
  it("still rejects a sibling folder and another drive", () => {
    expect(isAppDocumentUrl("file:///C:/Program%20Files/Pitwall/resources/app.asar/dist-evil/index.html", { distRoot, platform: "win32" })).toBe(false);
    expect(isAppDocumentUrl("file:///D:/dist/index.html", { distRoot, platform: "win32" })).toBe(false);
  });
});
