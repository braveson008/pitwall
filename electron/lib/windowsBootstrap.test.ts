import { describe, expect, it } from "vitest";
// @ts-expect-error - CommonJS module without types
import { applyWindowsDefaults, hideByDefault, normalisePathKey } from "./windowsBootstrap.cjs";

describe("windowsBootstrap", () => {
  it("leaves a Mac alone", () => {
    const env = { Path: "x" };
    expect(applyWindowsDefaults("darwin", env)).toBe(false);
    expect(env).toEqual({ Path: "x" });
  });

  it("renames Windows' Path so a spread with PATH replaces it", () => {
    const env: Record<string, string> = { Path: "C:\\Windows", Other: "1" };
    normalisePathKey(env);
    expect(env).toEqual({ Other: "1", PATH: "C:\\Windows" });
    expect({ ...env, PATH: "C:\\extra;C:\\Windows" }).toEqual({ Other: "1", PATH: "C:\\extra;C:\\Windows" });
  });

  it("hides console windows unless a caller asks otherwise", () => {
    expect(hideByDefault(undefined)).toEqual({ windowsHide: true });
    expect(hideByDefault({ cwd: "C:\\" })).toEqual({ cwd: "C:\\", windowsHide: true });
    expect(hideByDefault({ windowsHide: false })).toEqual({ windowsHide: false });
  });
});
