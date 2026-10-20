export const DEV_PREVIEW_MARKER = "BRAVELI_DEV_PREVIEW";
export const MOBILE_PREVIEW_MARKER = "BRAVELI_MOBILE_PREVIEW";

export interface DevPreview {
  url: string;
  target: "web" | "mobile";
}

const LOCAL_PREVIEW_URL = /(?:https?|exp):\/\/(?:localhost|127\.0\.0\.1|\[::1\]|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(?::\d+)?(?:\/[^\s\u001b]*)?/gi;

function cleanPreviewUrl(url: string) {
  return url.replace(/[\])},.;'\"]+$/, "");
}

/**
 * Finds the task environment an agent left running.
 *
 * A structured marker wins over incidental URLs from test output. The generic
 * fallback keeps older sessions useful, while the host allow-list prevents
 * untrusted task or terminal text from opening arbitrary external pages.
 */
export function findLatestDevPreview(lines: string[]): DevPreview | null {
  const output = lines.join("\n");
  const marked = output
    .split(/\r?\n/)
    .flatMap((line) => {
      const target = line.includes(MOBILE_PREVIEW_MARKER)
        ? "mobile" as const
        : line.includes(DEV_PREVIEW_MARKER)
          ? "web" as const
          : null;
      if (!target) return [];
      return (line.match(LOCAL_PREVIEW_URL) ?? []).map((url) => ({ url: cleanPreviewUrl(url), target }));
    });
  if (marked.length) return marked.at(-1) ?? null;

  const url = (output.match(LOCAL_PREVIEW_URL) ?? []).map(cleanPreviewUrl).at(-1);
  return url ? { url, target: "web" } : null;
}

export function findLatestDevPreviewUrl(lines: string[]) {
  return findLatestDevPreview(lines)?.url ?? "";
}
