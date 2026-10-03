import { createMedia as createCoreMedia, createMediaTool as createCoreMediaTool, mediaError } from '../../../core/media/index.js';
export { extractAttachments } from './content.js';

export function createMedia({ transport, ...options }) {
  return createCoreMedia({ ...options, transport: {
    download: (...args) => transport.download(...args),
    async deliver(message, { bytes, name, image }, { signal, uuid, allowed, appendImage }) {
      if (image && bytes.length > 10 * 1024 * 1024) throw mediaError('MEDIA_IMAGE_TOO_LARGE');
      if (image && typeof appendImage !== 'function') throw mediaError('MEDIA_CARD_REQUIRED');
      const key = image ? await transport.uploadImage(bytes, { signal }) : await transport.uploadFile(bytes, name, { signal });
      if (!allowed()) throw mediaError('MEDIA_SEND_DENIED');
      const id = image ? await appendImage({ key, name }, { isActive: allowed })
        : await transport.send(message, 'file', { file_key: key }, { signal, uuid });
      return { messageId: id, name, kind: image ? 'image' : 'file', ...(image ? { delivery: 'inline_card' } : {}) };
    },
  } });
}

export function createMediaTool(workspace, getTurn, send) {
  return createCoreMediaTool(workspace, getTurn, send, {
    label: '发送飞书附件',
    description: '将本会话 attachments/inbox 或 attachments/outbox 中的文件发送到当前飞书会话。用户必须明确请求或确认发送；群聊成员均可见。图片默认嵌入本轮已有回复卡片，不另发图片消息；非卡片模式须先启用卡片模式。其余（包括音视频）作为文件附件。禁止凭据、私人会话记录、任意主机路径或其他接收人；网络结果不确定时先请用户检查，勿自动重试。',
    asFileDescription: '仅用户明确要求普通文件附件时使用；会发送独立文件消息，而不是卡片内图片',
  });
}
