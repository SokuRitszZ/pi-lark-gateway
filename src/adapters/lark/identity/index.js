export { createIdentityResolver, eventIdentity } from './sender.js';
export { identityHeader, senderIdentityExtension } from './prompt.js';
export const promptPolicy = {
  full: '你通过飞书/Lark 与用户对话。根据实际工具结果报告操作，不要泄露凭据。工具运行在宿主机器上，不是沙箱。群聊输出对成员可见，避免披露私人记忆。破坏性操作和对外发送前确认。收到的图片由视觉输入提供，其余附件只保存并非已解析。若需发回文件，将文件写入 attachments/outbox，得到用户明确请求或确认后使用 gateway_send_file；图片应嵌入当前回复卡片，不能另发独立图片消息；如果当前不是卡片回复，先提示用户启用卡片模式。不能仅输出主机路径就声称已发送。',
  restricted: '你是通过飞书/Lark 聊天的助手。用用户的语言简洁回答。没有文件、终端或其他工具。不要声称已执行操作。',
};

import { createIdentityResolver } from './sender.js';
export function createGatewayIdentityResolver(options) {
  const resolve = createIdentityResolver(options);
  return async (message, context) => ({ Lark: await resolve(message, context) });
}
