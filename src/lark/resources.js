import { withResourceSignal } from './resource-context.js';

// SDK binary APIs have different return shapes from ordinary JSON endpoints.
const failure = code => Object.assign(new Error(code), { code });
function waitFor(work, signal, disposeLate = () => {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const abort = () => { settled = true; reject(signal.reason); };
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(work).then(value => {
      signal.removeEventListener('abort', abort);
      if (settled) { disposeLate(value); return; }
      settled = true; resolve(value);
    }, error => { signal.removeEventListener('abort', abort); if (!settled) { settled = true; reject(error); } });
  });
}
const deadline = signal => signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000);
export function createResources(client, sendResourceReply) {
  async function upload(method, data, field, signal) {
    const bounded = deadline(signal); bounded.throwIfAborted();
    try {
      const result = await waitFor(withResourceSignal(bounded, () => method({ data })), bounded);
      if (result?.code !== undefined && result.code !== 0) throw failure('MEDIA_SEND_FAILED');
      const key = result?.data?.[field] || result?.[field];
      if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(key)) throw failure('MEDIA_SEND_FAILED');
      return key;
    } catch { throw failure('MEDIA_SEND_FAILED'); }
  }
  return {
    async download(message, attachment, { signal, maxBytes }) {
      const bounded = deadline(signal); bounded.throwIfAborted();
      let stream, stop;
      try {
        const response = await waitFor(withResourceSignal(bounded, () => client.im.v1.messageResource.get({
          path: { message_id: message.id, file_key: attachment.key }, params: { type: attachment.kind === 'image' ? 'image' : 'file' },
        })), bounded, late => { try { late.getReadableStream().destroy(); } catch {} });
        stream = response.getReadableStream();
        stop = () => stream.destroy();
        bounded.addEventListener('abort', stop, { once: true }); bounded.throwIfAborted();
        const declared = Number(response.headers?.['content-length']);
        if (Number.isFinite(declared) && declared > maxBytes) throw failure('MEDIA_TOO_LARGE');
        const chunks = []; let size = 0;
        for await (const chunk of stream) {
          bounded.throwIfAborted();
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += bytes.length;
          if (size > maxBytes) throw failure('MEDIA_TOO_LARGE');
          chunks.push(bytes);
        }
        bounded.throwIfAborted();
        if (!size) throw failure('MEDIA_EMPTY');
        const bytes = Buffer.concat(chunks, size);
        // Some platform failures arrive as HTTP 200 JSON rather than a rejected request.
        // Real file responses with Content-Disposition are not interpreted as API JSON.
        if (size <= 65536 && /application\/json/i.test(response.headers?.['content-type'] || '') && !response.headers?.['content-disposition']) {
          let body;
          try { body = JSON.parse(bytes.toString('utf8')); } catch {}
          if (Number.isInteger(body?.code) && body.code !== 0 && typeof body.msg === 'string') throw failure('MEDIA_DOWNLOAD_FAILED');
        }
        return bytes;
      } catch (error) {
        if (['MEDIA_TOO_LARGE', 'MEDIA_EMPTY'].includes(error.code)) throw error;
        throw failure('MEDIA_DOWNLOAD_FAILED');
      } finally { if (stop) bounded.removeEventListener('abort', stop); stream?.destroy(); }
    },
    uploadImage: (bytes, { signal } = {}) => upload(data => client.im.v1.image.create(data), { image_type: 'message', image: bytes }, 'image_key', signal),
    uploadFile: (bytes, name, { signal } = {}) => upload(data => client.im.v1.file.create(data), { file_type: 'stream', file_name: name, file: bytes }, 'file_key', signal),
    async send(message, type, content, { signal, uuid } = {}) {
      const bounded = deadline(signal); bounded.throwIfAborted();
      try { return await waitFor(withResourceSignal(bounded, () => sendResourceReply(message, type, content, { uuid })), bounded); }
      catch { throw failure('MEDIA_SEND_FAILED'); }
    },
  };
}
