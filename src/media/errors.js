const messages = {
  MEDIA_TOO_MANY: '单条消息最多处理 4 个附件，请分开发送。',
  MEDIA_TOO_LARGE: '附件超过网关限制：单文件及单条消息附件合计最多 30 MiB，请压缩或分开发送。',
  MEDIA_EMPTY: '附件为空，未处理。',
  MEDIA_DOWNLOAD_FAILED: '附件下载失败。请检查消息资源下载权限、机器人是否能访问该文件，以及文件是否已撤回或受保密限制。',
  MEDIA_IMAGE_TOO_LARGE: '卡片图片上传最多 10 MiB，请压缩图片；不会自动改成独立文件消息发送。',
  MEDIA_CARD_REQUIRED: '图片只能嵌入当前回复卡片。请将当前会话 replyMode 设为 card 后重试；不会另发图片消息。',
  MEDIA_SEND_FAILED: '附件上传或发送未确认成功。请检查权限与当前聊天记录；不要自动重试，以免重复发送。',
  MEDIA_PATH_DENIED: '只能发送当前会话 attachments/inbox 或 attachments/outbox 中的普通文件；禁止链接、目录及其他主机路径。',
  MEDIA_STORAGE_FULL: '网关附件收件箱已达到 512 MiB 配额，请管理员检查并清理不再需要的附件后重试。',
  MEDIA_SEND_DENIED: '当前会话未开启附件发送工具、权限已撤销或本轮已结束，不能发送。',
  MEDIA_SEND_LIMIT: '本轮最多发送 4 个附件，请下一轮继续。',
  IMAGE_INPUT_INVALID: '图片数据不完整或格式不受支持，已保留原始会话记录，请联系管理员检查。',
  VISION_UNSUPPORTED: '已收到图片，但当前模型未声明支持图片输入。请配置支持视觉的模型后重发，不能仅靠开通飞书权限识图。',
};
export const mediaErrorText = code => messages[code];
export const mediaError = code => Object.assign(new Error(messages[code] || '附件处理失败。'), { code });
