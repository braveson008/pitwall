import { describe, expect, it } from "vitest";
import {
  clearProjectNotification,
  recordProjectNotification,
  type ProjectNotifications,
} from "./projectNotifications";

describe("project completion notifications", () => {
  it("counts unread completions independently by project", () => {
    const first = recordProjectNotification({}, "project-a", {
      agent: "Codex",
      sessionName: "Implement task",
      lastAt: "2026-07-22T10:00:00.000Z",
    });
    const second = recordProjectNotification(first, "project-a", {
      agent: "Gemini",
      sessionName: "Review task",
      lastAt: "2026-07-22T10:01:00.000Z",
    });

    expect(second["project-a"]).toEqual({
      agent: "Gemini",
      sessionName: "Review task",
      lastAt: "2026-07-22T10:01:00.000Z",
      count: 2,
    });
  });

  it("clears only the selected project's unread state", () => {
    const notifications: ProjectNotifications = {
      "project-a": { agent: "Claude", sessionName: "A", lastAt: "now", count: 1 },
      "project-b": { agent: "Kimi", sessionName: "B", lastAt: "now", count: 2 },
    };

    expect(clearProjectNotification(notifications, "project-a")).toEqual({
      "project-b": notifications["project-b"],
    });
    expect(notifications["project-a"].count).toBe(1);
  });

  it("caps a compact sidebar badge at 99", () => {
    const notifications: ProjectNotifications = {
      "project-a": { agent: "Grok", sessionName: "Task", lastAt: "now", count: 99 },
    };
    expect(recordProjectNotification(notifications, "project-a", {
      agent: "Grok",
      sessionName: "Task",
      lastAt: "later",
    })["project-a"].count).toBe(99);
  });
});
