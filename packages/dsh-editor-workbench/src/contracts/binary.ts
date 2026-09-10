/** Maximum payload size for `file.readBinary`, in bytes. */
export const FILE_READ_BINARY_MAX_BYTES = 20 * 1024 * 1024

/** Extension → MIME type for `file.readBinary`. Keys are lowercase, leading dot included. */
export const FILE_READ_BINARY_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
}
