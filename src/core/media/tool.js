import { createHash } from 'node:crypto';
import { mediaError, mediaErrorText } from './errors.js';

// No caller-supplied recipient. AsyncLocalStorage supplies the current turn only.
export function createMediaTool(workspace, getTurn, send, presentation = {}) {
  return {
    name: 'gateway_send_file', label: presentation.label || '发送附件',
    description: presentation.description || '将本会话附件发送到当前会话。用户必须明确请求或确认。禁止凭据、私人记录及其他接收人；结果不确定时勿自动重试。',
    parameters: { type: 'object', properties: {
      path: { type: 'string', description: '本会话附件路径，例如 attachments/outbox/result.png' },
      asFile: { type: 'boolean', description: presentation.asFileDescription || '仅用户明确要求作为普通文件发送时使用' },
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
