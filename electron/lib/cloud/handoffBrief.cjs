"use strict";
/**
 * What a fresh agent session is told when the conversation from another
 * computer can't be resumed here: the task, how far it got, the last turns,
 * and what has changed so far. Kept under 6000 characters so it can still be
 * passed on a Windows command line.
 */
const MAX_BRIEF = 5800;
const MAX_TURNS = 12;
const MAX_TURN_CHARS = 700;

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part && (part.type === "text" || part.type === "input_text" || part.type === "output_text") && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

/** The last user and assistant turns of a conversation file, oldest first. */
function messagesFromTranscript(cli, text) {
  const turns = [];
  for (const line of String(text || "").split("\n")) {
    if (!line.trim()) continue;
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    let role = null;
    let body = "";
    if (cli === "claude" && (value.type === "user" || value.type === "assistant") && !value.isSidechain) {
      role = value.message?.role || value.type;
      body = textOf(value.message?.content);
    } else if (cli === "codex" && value.type === "response_item" && value.payload?.type === "message") {
      role = value.payload.role;
      body = textOf(value.payload.content);
    } else if (typeof value.role === "string" && (typeof value.content === "string" || Array.isArray(value.content))) {
      role = value.role;
      body = textOf(value.content);
    }
    if ((role === "user" || role === "assistant") && body.trim() && !body.startsWith("<")) turns.push({ role, text: body.trim() });
  }
  return turns.slice(-MAX_TURNS);
}

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function buildHandoffBrief({ task, messages = [], diffStat = "", reviewComments = [], device = "another computer", at = null }) {
  const head = [
    `You are continuing work that was started on ${device}${at ? ` (last saved ${at})` : ""}. Its conversation couldn't be brought to this computer, so here is where it stands.`,
    task?.title ? `Task: ${task.title}` : "",
    task?.description ? `What it asks: ${clip(task.description, 900)}` : "",
    diffStat ? `Changed so far (uncommitted changes are already in this checkout):\n${clip(diffStat, 900)}` : "",
    reviewComments.length ? `Open review comments:\n${reviewComments.slice(0, 6).map((comment) => `- ${clip(comment, 200)}`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
  const tail = "Pick up from here: check the current state of the files first, then carry on with the task.";
  const turns = messages.map((turn) => `${turn.role === "user" ? "Person" : "Agent"}: ${clip(turn.text.replace(/\s+\n/g, "\n"), MAX_TURN_CHARS)}`);
  // Newest turns matter most: drop from the oldest end until it fits.
  while (turns.length && head.length + tail.length + turns.join("\n\n").length + 40 > MAX_BRIEF) turns.shift();
  const brief = [head, turns.length ? `The last part of the conversation:\n\n${turns.join("\n\n")}` : "", tail].filter(Boolean).join("\n\n");
  return clip(brief, MAX_BRIEF);
}

module.exports = { MAX_BRIEF, buildHandoffBrief, messagesFromTranscript };
