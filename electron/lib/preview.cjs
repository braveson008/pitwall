/**
 * Normalises what the user typed into a URL safe to hand to the OS.
 *
 * A bare "localhost:5173" is what people type and is not a URL; anything that
 * is not HTTP(S) or Expo's explicit exp:// preview scheme must not reach the OS.
 */
function normalizePreviewUrl(value) {
  const input = String(value || "").trim();
  if (!input) throw new Error("Enter a preview URL");

  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `http://${input}`;
  const parsed = new URL(withProtocol);
  if (!["http:", "https:", "exp:"].includes(parsed.protocol)) {
    throw new Error("Preview supports HTTP, HTTPS, and Expo URLs only");
  }
  return parsed.toString();
}

module.exports = { normalizePreviewUrl };
