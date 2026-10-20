import { describe, expect, it } from "vitest";
import type { AgentSession } from "../data";
import { broadcastEligibleSessions, needsResumeToReceive, councilRecipients } from "./sessionBroadcast";

const session = (id: string, status: AgentSession["status"]) => ({ id, status }) as AgentSession;

describe("broadcastEligibleSessions", () => {
  it("reaches every session that can act on the message, finished ones included", () => {
    // The instruction worth sending to all of them at once usually follows the
    // work — "open a PR" — so the sessions that finished are the ones that need
    // it most.
    expect(broadcastEligibleSessions([
      session("starting", "starting"),
      session("running", "running"),
      session("waiting", "waiting"),
      session("completed", "completed"),
      session("failed", "failed"),
      session("disconnected", "disconnected"),
    ]).map((item) => item.id)).toEqual(["starting", "running", "waiting", "completed"]);
  });

  it("leaves out a session that stopped without finishing", () => {
    // An instruction that assumes completed work is the wrong thing to send it.
    expect(broadcastEligibleSessions([session("failed", "failed")])).toEqual([]);
  });
});

describe("needsResumeToReceive", () => {
  it("is true only where the CLI has already exited", () => {
    expect(needsResumeToReceive(session("a", "completed"))).toBe(true);
    expect(needsResumeToReceive(session("b", "running"))).toBe(false);
  });
});

describe("councilRecipients", () => {
  const sessions = [{ id: "s1" }, { id: "s2" }, { id: "s3" }];

  it("reaches everyone when that is what was asked", () => {
    expect(councilRecipients(sessions, "all", "s2").map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
  });

  // The point of the whole change: a conducted council parks the members who
  // are not on turn, and a correction they read three turns later is worse
  // than one they never got.
  it("reaches only the member on turn", () => {
    expect(councilRecipients(sessions, "current", "s2").map((s) => s.id)).toEqual(["s2"]);
  });

  it("falls back to everyone when nobody holds the turn", () => {
    expect(councilRecipients(sessions, "current", undefined).map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
  });

  // A run whose member on turn has been closed must not swallow the message.
  it("falls back to everyone when the member on turn is no longer a session", () => {
    expect(councilRecipients(sessions, "current", "gone").map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
  });

  it("does not hand back the array it was given", () => {
    const result = councilRecipients(sessions, "all", undefined);
    expect(result).not.toBe(sessions);
  });
});
