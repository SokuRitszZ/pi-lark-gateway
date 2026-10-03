import { MAX_ATTACHMENTS } from '../../../core/media/index.js';
// Opaque Lark resource keys; URLs and filesystem paths are never accepted.
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
