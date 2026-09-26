export const MAX_ATTACHMENTS = 4;
export const MAX_BYTES = 30 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Resource keys are opaque platform identifiers, never URLs or filesystem paths.
export function extractAttachments(type, body) {
  const result = [];
  const add = (kind, key, name) => {
    if (result.length > MAX_ATTACHMENTS) return;
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(key)) return;
    if (!result.some(item => item.key === key && item.kind === kind)) result.push({ kind, key, name: typeof name === 'string' ? name : '' });
  };
  if (type === 'image') add('image', body.image_key);
  if (['file', 'audio', 'media', 'video'].includes(type)) add(type === 'media' ? 'video' : type, body.file_key, body.file_name);
  if (type === 'post') {
    const post = body.content ? body : body.zh_cn || body.en_us;
    for (const row of Array.isArray(post?.content) ? post.content : []) {
      for (const item of Array.isArray(row) ? row : []) {
        if (item?.tag === 'img') add('image', item.image_key);
        if (item?.tag === 'media') add('video', item.file_key);
      }
    }
  }
  return result;
}

export function imageType(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 6 && /GIF8[79]a/.test(bytes.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

export function safeName(value, fallback = 'attachment.bin') {
  let name = String(value || fallback).replaceAll('\\', '/').split('/').at(-1).normalize('NFC').replace(/[\x00-\x1f\x7f]/g, '_');
  const chars = Array.from(name).slice(0, 160);
  while (Buffer.byteLength(chars.join('')) > 160) chars.pop();
  name = chars.join('');
  return !name || /^\.+$/.test(name) ? fallback : name;
}
