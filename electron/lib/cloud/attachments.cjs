"use strict";
/**
 * Images attached to tasks travel with them. A task refers to its images by
 * path under `terminal-attachments`; the path is synced as a token, and the
 * file itself as a record named by its place under that folder, so it lands
 * at the same relative place on the other computer and the token resolves.
 */
const fs = require("node:fs");
const path = require("node:path");

// Carried as base64 inside a record of at most 10 MB, so the file itself must be smaller.
const MAX_ATTACHMENT_BYTES = 7 * 1024 * 1024;
const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".pdf": "application/pdf" };

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : null;
}

/** @returns {{ records, skipped }} — skipped lists files too large to sync (by relative path) */
function attachmentRecords(tasks, attachmentsRoot, cache = null) {
  const records = [];
  const skipped = [];
  const seen = new Set();
  for (const task of tasks || []) {
    for (const image of Array.isArray(task?.images) ? task.images : []) {
      const relative = typeof image === "string" ? inside(attachmentsRoot, image) : null;
      if (!relative || seen.has(relative)) continue;
      seen.add(relative);
      let stat;
      try {
        stat = fs.statSync(image);
      } catch {
        continue;
      }
      const rel = relative.split(path.sep).join("/");
      if (stat.size > MAX_ATTACHMENT_BYTES) {
        skipped.push(rel);
        continue;
      }
      const stamp = `${stat.size}:${stat.mtimeMs}`;
      const cached = cache?.get(image);
      if (cached?.stamp === stamp) {
        records.push(cached.record);
        continue;
      }
      if (cache) cache.reads += 1;
      const record = {
        kind: "attachment",
        localId: rel,
        data: { rel, mime: MIME[path.extname(image).toLowerCase()] || "application/octet-stream", bytes: fs.readFileSync(image).toString("base64"), size: stat.size },
      };
      cache?.set(image, { stamp, record });
      records.push(record);
    }
  }
  return { records, skipped };
}

/** Attachments collected repeatedly: a file is read again only when its size or time changes. */
function createAttachmentCollector() {
  const cache = new Map();
  cache.reads = 0;
  return {
    collect: (tasks, attachmentsRoot) => attachmentRecords(tasks, attachmentsRoot, cache),
    reads: () => cache.reads,
  };
}

function applyAttachment(attachmentsRoot, data) {
  if (!data?.rel || typeof data.bytes !== "string") return null;
  const target = path.resolve(attachmentsRoot, ...data.rel.split("/"));
  if (!inside(attachmentsRoot, target)) return null;
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.writeFileSync(target, Buffer.from(data.bytes, "base64"), { mode: 0o600 });
  return target;
}

module.exports = { MAX_ATTACHMENT_BYTES, applyAttachment, attachmentRecords, createAttachmentCollector };
