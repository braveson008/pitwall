import { describe, expect, it } from "vitest";
import { CARRY_CHARACTERS, emptyPreviewWatch, seedPreviewWatch, watchPreview } from "./previewWatch";
import { findLatestDevPreviewUrl } from "./devPreview";

const marker = (url: string) => `PITWALL_DEV_PREVIEW ${url}\r\n`;

describe("watchPreview", () => {
  it("finds a marked preview in newly arrived output", () => {
    const state = watchPreview(emptyPreviewWatch(), [marker("http://localhost:5173/")]);
    expect(state.preview?.url).toBe("http://localhost:5173/");
    expect(state.marked).toBe(true);
  });

  it("reassembles a marker split across two reads", () => {
    // The kernel splits PTY output wherever it likes, including mid-line.
    const whole = marker("http://localhost:4321/");
    const cut = Math.floor(whole.length / 2);
    let state = watchPreview(emptyPreviewWatch(), [whole.slice(0, cut)]);
    state = watchPreview(state, [whole.slice(cut)]);
    expect(state.preview?.url).toBe("http://localhost:4321/");
  });

  it("keeps the preview it has when new output carries none", () => {
    let state = watchPreview(emptyPreviewWatch(), [marker("http://localhost:3000/")]);
    state = watchPreview(state, ["ran 41 shell commands and read a file\r\n"]);
    expect(state.preview?.url).toBe("http://localhost:3000/");
  });

  it("takes the newest marked preview when the server moves", () => {
    let state = watchPreview(emptyPreviewWatch(), [marker("http://localhost:3000/")]);
    state = watchPreview(state, [marker("http://localhost:3001/")]);
    expect(state.preview?.url).toBe("http://localhost:3001/");
  });

  it("does not let a URL mentioned in passing displace an announced one", () => {
    let state = watchPreview(emptyPreviewWatch(), [marker("http://localhost:5173/")]);
    state = watchPreview(state, ["curl http://localhost:9999/health\r\n"]);
    expect(state.preview?.url).toBe("http://localhost:5173/");
  });

  it("still accepts a bare URL when nothing has been announced", () => {
    const state = watchPreview(emptyPreviewWatch(), ["Local:  http://localhost:5174/\r\n"]);
    expect(state.preview?.url).toBe("http://localhost:5174/");
    expect(state.marked).toBe(false);
  });

  it("returns the same object when there is nothing to read", () => {
    const state = watchPreview(emptyPreviewWatch(), [marker("http://localhost:5173/")]);
    expect(watchPreview(state, [])).toBe(state);
  });

  it("keeps only a bounded tail, however much output arrives", () => {
    let state = emptyPreviewWatch();
    for (let i = 0; i < 50; i += 1) state = watchPreview(state, ["x".repeat(5_000)]);
    expect(state.carry.length).toBeLessThanOrEqual(CARRY_CHARACTERS);
  });

  it("agrees with a full rescan of the same output", () => {
    // The incremental read must not change what the app reports.
    const output = [
      "starting the dev server\r\n",
      "Local:  http://localhost:4000/\r\n",
      marker("http://localhost:4100/"),
      "compiled successfully\r\n",
    ];
    let state = emptyPreviewWatch();
    for (const chunk of output) state = watchPreview(state, [chunk]);
    expect(state.preview?.url).toBe(findLatestDevPreviewUrl(output));
  });
});

describe("seedPreviewWatch", () => {
  it("recovers a preview from output restored off disk", () => {
    expect(seedPreviewWatch([marker("http://localhost:8080/")]).preview?.url).toBe("http://localhost:8080/");
  });

  it("holds nothing when restored output never had one", () => {
    expect(seedPreviewWatch(["nothing to see here\r\n"]).preview).toBeNull();
  });
});
