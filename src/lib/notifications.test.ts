import { describe, expect, it } from "vitest";
import { addNotification, alreadyOnScreen, automationsTarget, jumpLabel, readNotifications, type AppNotification } from "./notifications";

const note = (id: string, extra: Partial<AppNotification> = {}): AppNotification => ({
  id, title: "Fix picker finished", body: "", tone: "info", at: 1, seen: false,
  target: { section: "work", projectId: "p", sessionId: "s1" }, ...extra,
});

describe("notifications", () => {
  it("keeps the newest first, one per thing, and no more than thirty", () => {
    let list: AppNotification[] = [];
    list = addNotification(list, note("a"));
    list = addNotification(list, note("b", { target: { section: "work", projectId: "p", sessionId: "s2" } }));
    list = addNotification(list, note("c"));
    expect(list.map((item) => item.id)).toEqual(["c", "b"]);
    for (let i = 0; i < 40; i += 1) list = addNotification(list, note(`n${i}`, { title: `t${i}` }));
    expect(list).toHaveLength(30);
  });

  it("stays quiet about the session you are looking at, and only that", () => {
    const target = { section: "work" as const, projectId: "p", sessionId: "s1" };
    expect(alreadyOnScreen(target, { focused: true, projectId: "p", section: "work", sessionId: "s1" })).toBe(true);
    expect(alreadyOnScreen(target, { focused: true, projectId: "p", section: "work", sessionId: "s2" })).toBe(false);
    expect(alreadyOnScreen(target, { focused: false, projectId: "p", section: "work", sessionId: "s1" })).toBe(false);
    expect(alreadyOnScreen(target, { focused: true, projectId: "q", section: "work", sessionId: "s1" })).toBe(false);
    expect(alreadyOnScreen({ section: "review", projectId: "p", taskId: "t" }, { focused: true, projectId: "p", section: "review", sessionId: "" })).toBe(true);
  });

  it("names the button after where it goes", () => {
    expect(jumpLabel({ section: "work", projectId: "p", sessionId: "s" })).toBe("Open session");
    expect(jumpLabel({ section: "review", projectId: "p", taskId: "t" })).toBe("Open review");
    expect(jumpLabel({ section: "watch", projectId: "p", findingId: "f" })).toBe("Open in Watches");
  });

  it("reads back what was stored, and survives what was not", () => {
    expect(readNotifications(JSON.stringify([note("a"), { id: 3 }]))).toHaveLength(1);
    expect(readNotifications("not json")).toEqual([]);
  });
});

describe("automationsTarget", () => {
  const finding = (id: string, projectId: string, updatedAt: number, state = "ready") => ({ id, projectId, state, updatedAt });
  const projects = ["a", "b", "c"];

  it("stays in this project when something waits here", () => {
    expect(automationsTarget([finding("x", "a", 1), finding("y", "b", 9)], "a", projects)).toEqual({ section: "watch", projectId: "a" });
  });

  it("opens the project with the newest waiting finding when none waits here", () => {
    expect(automationsTarget([finding("x", "b", 1), finding("y", "c", 9)], "a", projects)).toEqual({ section: "watch", projectId: "c", findingId: "y" });
  });

  it("ignores findings that are not ready or belong to a removed project", () => {
    const findings = [finding("x", "b", 9, "posted"), finding("y", "gone", 9)];
    expect(automationsTarget(findings, "a", projects)).toEqual({ section: "schedule", projectId: "a" });
  });
});
