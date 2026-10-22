const IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp|heic|heif|bmp|tiff?|svg)$/i;

export function isImageFile(file: File) {
  return file.type.startsWith("image/") || IMAGE_EXTENSION.test(file.name);
}

export function quoteTerminalPath(filePath: string) {
  // A Windows path cannot hold a double quote, and double quotes are what Windows Terminal writes for a dropped file.
  if (/^(?:[A-Za-z]:\\|\\\\)/.test(filePath)) return `"${filePath}"`;
  return `'${filePath.replace(/'/g, `'\\''`)}'`;
}

export function formatTerminalImagePaths(filePaths: string[]) {
  return filePaths.filter(Boolean).map(quoteTerminalPath).join(" ");
}
