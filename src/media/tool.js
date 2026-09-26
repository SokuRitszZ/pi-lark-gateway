import { createHash } from 'node:crypto';
import { mediaError, mediaErrorText } from './errors.js';

// No caller-supplied recipient. AsyncLocalStorage supplies the current turn only.
export function createMediaTool(workspace, getTurn, send) {
  return {
    name: 'gateway_send_file', label: '发送飞书附件',
    description: '将本会话 attachments/inbox 或 attachments/outbox 中的文件发送到当前飞书会话。用户必须明确请求或确认发送；群聊成员均可见。图片默认嵌入本轮已有回复卡片，不另发图片消息；非卡片模式须先启用卡片模式。其余（包括音视频）作为文件附件。禁止凭据、私人会话记录、任意主机路径或其他接收人；网络结果不确定时先请用户检查，勿自动重试。',
    parameters: { type: 'object', properties: {
      path: { type: 'string', description: '本会话附件路径，例如 attachments/outbox/result.png' },
      asFile: { type: 'boolean', description: '仅用户明确要求普通文件附件时使用；会发送独立文件消息，而不是卡片内图片' },
    }, required: ['path'], additionalProperties: false },
    async execute(callId, params, signal) {
      const turn = getTurn();
      if (!turn?.active || turn.tools !== 'all' || !turn.message) throw mediaError('MEDIA_SEND_DENIED');
      turn.mediaCalls ||= new Map();
      if (turn.mediaCalls.has(callId)) return turn.mediaCalls.get(callId);
      if (turn.mediaCalls.size >= 4) throw mediaError('MEDIA_SEND_LIMIT');
      const work = (turn.mediaQueue || Promise.resolve()).then(async () => {
        if (!turn.active || signal?.aborted) throw mediaError('MEDIA_SEND_DENIED');
        const uuid = createHash('sha256').update(`${turn.message.id}:${callId}`).digest('hex').slice(0, 32);
        try {
          const result = await send(turn.message, workspace, params, { signal, uuid, isActive: () => turn.active, appendImage: turn.appendImage });
          return { content: [{ type: 'text', text: JSON.stringify({ sent: true, ...result }) }], details: {} };
        } catch (error) { throw new Error(mediaErrorText(error.code) || mediaErrorText('MEDIA_SEND_FAILED')); }
      });
      turn.mediaCalls.set(callId, work);
      turn.mediaQueue = work.catch(() => {});
      return work;
    },
  };
}
