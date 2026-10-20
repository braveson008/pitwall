const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomBytes } = require("node:crypto");

const MAX_IMAGE_COUNT = 12;
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".heic",
  ".heif",
  ".bmp",
  ".tif",
  ".tiff",
  ".svg",
]);
const MIME_EXTENSIONS = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/gif", ".gif"],
  ["image/webp", ".webp"],
  ["image/heic", ".heic"],
  ["image/heif", ".heif"],
  ["image/bmp", ".bmp"],
  ["image/tiff", ".tiff"],
  ["image/svg+xml", ".svg"],
]);

function attachmentDirectory(rootDirectory, sessionId) {
  const rawId = String(sessionId || "session");
  const readableId = rawId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 64) || "session";
  const hash = createHash("sha256").update(rawId).digest("hex").slice(0, 10);
  return path.join(path.resolve(rootDirectory), `${readableId}-${hash}`);
}

function supportedExtension(fileName) {
  const extension = path.extname(String(fileName || "")).toLowerCase();
  return IMAGE_EXTENSIONS.has(extension) ? extension : "";
}

function safeFileName(fileName, extension) {
  const original = path.basename(String(fileName || `image${extension}`));
  const originalExtension = supportedExtension(original);
  const stem = path.basename(original, originalExtension || path.extname(original))
    .replace(/[^a-zA-Z0-9._ -]/g, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 96) || "image";
  return `${stem}${originalExtension || extension}`;
}

async function ensureAttachmentDirectory(rootDirectory, sessionId) {
  const directory = attachmentDirectory(rootDirectory, sessionId);
  await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.promises.chmod(directory, 0o700).catch(() => {});
  return directory;
}

function uniqueDestination(directory, fileName) {
  return path.join(directory, `${Date.now()}-${randomBytes(4).toString("hex")}-${fileName}`);
}

function attachmentResult(paths, failed) {
  if (paths.length === 0 && failed > 0) {
    return { ok: false, paths, error: "The selected image could not be copied into Pitwall." };
  }
  if (failed > 0) {
    return { ok: true, paths, error: `${failed} image${failed === 1 ? "" : "s"} could not be attached.` };
  }
  return { ok: true, paths };
}

async function stageTerminalImagePaths({ rootDirectory, sessionId, paths }) {
  const sources = Array.isArray(paths) ? paths.slice(0, MAX_IMAGE_COUNT) : [];
  if (sources.length === 0) return { ok: true, paths: [] };

  const directory = await ensureAttachmentDirectory(rootDirectory, sessionId);
  const staged = [];
  let failed = Math.max(0, (Array.isArray(paths) ? paths.length : 0) - sources.length);

  for (const sourceValue of sources) {
    try {
      const source = path.resolve(String(sourceValue || ""));
      const extension = supportedExtension(source);
      if (!extension) throw new Error("Unsupported image type");
      const stats = await fs.promises.stat(source);
      if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_IMAGE_BYTES) {
        throw new Error("Invalid image file");
      }
      const destination = uniqueDestination(directory, safeFileName(source, extension));
      await fs.promises.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
      await fs.promises.chmod(destination, 0o600).catch(() => {});
      staged.push(destination);
    } catch {
      failed += 1;
    }
  }

  return attachmentResult(staged, failed);
}

function imageBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return Buffer.from(value);
  return null;
}

async function stageTerminalImageData({ rootDirectory, sessionId, images }) {
  const candidates = Array.isArray(images) ? images.slice(0, MAX_IMAGE_COUNT) : [];
  if (candidates.length === 0) return { ok: true, paths: [] };

  const directory = await ensureAttachmentDirectory(rootDirectory, sessionId);
  const staged = [];
  let failed = Math.max(0, (Array.isArray(images) ? images.length : 0) - candidates.length);

  for (const image of candidates) {
    try {
      const mimeType = String(image?.type || "").toLowerCase();
      const extension = supportedExtension(image?.name) || MIME_EXTENSIONS.get(mimeType) || "";
      const data = imageBuffer(image?.data);
      if (!mimeType.startsWith("image/") || !extension || !data || data.length <= 0 || data.length > MAX_IMAGE_BYTES) {
        throw new Error("Invalid clipboard image");
      }
      const destination = uniqueDestination(directory, safeFileName(image?.name, extension));
      await fs.promises.writeFile(destination, data, { flag: "wx", mode: 0o600 });
      staged.push(destination);
    } catch {
      failed += 1;
    }
  }

  return attachmentResult(staged, failed);
}

module.exports = {
  MAX_IMAGE_BYTES,
  attachmentDirectory,
  stageTerminalImageData,
  stageTerminalImagePaths,
};
