export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

export function mimeByPath(path: string): string {
  if (path.endsWith('.gif')) return 'image/gif';
  if (path.endsWith('.webp')) return 'image/webp';
  throw new Error(`Неподдерживаемый тип файла: ${path}`);
}

export const toDataUrl = (bytes: Uint8Array, mime: string) => `data:${mime};base64,${bytesToBase64(bytes)}`;
