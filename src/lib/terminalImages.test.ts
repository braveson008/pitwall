import { describe, expect, it } from "vitest";
import { formatTerminalImagePaths, isImageFile, quoteTerminalPath } from "./terminalImages";

describe("terminal image helpers", () => {
  it("quotes paths so spaces and apostrophes survive terminal parsing", () => {
    expect(quoteTerminalPath("/tmp/My image.png")).toBe("'/tmp/My image.png'");
    expect(quoteTerminalPath("/tmp/team's-shot.png")).toBe("'/tmp/team'\\''s-shot.png'");
  });

  it("formats multiple selected image paths without submitting the prompt", () => {
    expect(formatTerminalImagePaths(["/tmp/a.png", "/tmp/b.webp"])).toBe("'/tmp/a.png' '/tmp/b.webp'");
  });

  it("recognizes images by MIME type or supported extension", () => {
    expect(isImageFile(new File([], "capture", { type: "image/png" }))).toBe(true);
    expect(isImageFile(new File([], "capture.HEIC"))).toBe(true);
    expect(isImageFile(new File([], "notes.txt", { type: "text/plain" }))).toBe(false);
  });

  it("double-quotes a Windows path, as Windows Terminal does when a file is dropped on it", () => {
    expect(quoteTerminalPath("C:\\Users\\Nika O'Neil\\AppData\\shot 1.png")).toBe('"C:\\Users\\Nika O\'Neil\\AppData\\shot 1.png"');
    expect(quoteTerminalPath("\\\\server\\share\\a.png")).toBe('"\\\\server\\share\\a.png"');
  });
});
