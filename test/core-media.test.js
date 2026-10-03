import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMedia } from '../src/core/media/index.js';

test('generic media can deliver an image without Lark cards, preserving authorization and path safety', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-core-media-'));
  try {
    await fs.mkdir(path.join(workspace, 'attachments/outbox'), { recursive: true });
    await fs.writeFile(path.join(workspace, 'attachments/outbox/image.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
    let allowed = true, deliveries = 0;
    const media = createMedia({ base: workspace, getDirectory: () => workspace, canSend: () => allowed,
      transport: { async deliver(_message, file, context) {
        assert.equal(file.image, true); assert.equal(context.allowed(), true);
        deliveries++; return { messageId: 'fake-image', kind: 'image' };
      } },
    });
    const message = { key: 'test' };
    assert.equal((await media.send(message, workspace, { path: 'attachments/outbox/image.png' })).messageId, 'fake-image');
    allowed = false;
    await assert.rejects(media.send(message, workspace, { path: 'attachments/outbox/image.png' }), { code: 'MEDIA_SEND_DENIED' });
    allowed = true;
    await assert.rejects(media.send(message, workspace, { path: '../secret' }));
    assert.equal(deliveries, 1);
  } finally { await fs.rm(workspace, { recursive: true, force: true }); }
});
