// Application (tenant) permissions only. No user OAuth or tenant-wide extras.
export const PERMISSIONS = Object.freeze([
  { scope: 'im:message.p2p_msg:readonly', level: '基础', purpose: '接收用户发给机器人的私聊消息' },
  { scope: 'im:message.group_at_msg:readonly', level: '基础', purpose: '接收群聊中用户 @ 机器人的消息' },
  { scope: 'im:message:send_as_bot', level: '基础', purpose: '机器人发送/回复消息、发送审批卡片、编辑文本及更新卡片' },
  { scope: 'im:message.reactions:write_only', level: '增强', purpose: '添加和撤回处理中表情；缺少时不阻断回复' },
  { scope: 'im:chat:read', level: '增强', purpose: '读取审批卡片中的群名称；缺少时使用群 ID' },
  { scope: 'cardkit:card:write', level: '增强', purpose: '原生打字机卡片；缺少时降级为整卡更新' },
  { scope: 'im:message:readonly', level: '增强', purpose: '下载用户消息内的图片、文件及音视频；不主动检索历史消息' },
  { scope: 'im:resource:upload', level: '增强', purpose: '上传待发送的图片与文件；模型发送工具仅在 tools:all 时开放' },
  { scope: 'im:message.group_msg', level: '按需敏感', purpose: '仅在需要接收非 @ 群消息时申请；还需显式调整群触发策略' },
].map(Object.freeze));

export function permissionsJson() {
  return { scopes: { tenant: PERMISSIONS.filter(item => item.level !== '按需敏感').map(item => item.scope), user: [] } };
}

export function permissionsGuide(appId) {
  const link = typeof appId === 'string' && /^cli_[A-Za-z0-9]+$/.test(appId)
    ? `https://open.feishu.cn/app/${appId}/auth` : 'https://open.feishu.cn/app';
  return [
    '飞书应用权限与事件检查清单（应用身份，不是用户 OAuth）：',
    `权限管理：${link}`,
    '基础权限（默认私聊 + 群 @ 回复）：',
    ...PERMISSIONS.filter(item => item.level === '基础').map(item => `  ${item.scope} — ${item.purpose}`),
    '增强功能权限（按需开通；缺少对应功能不可用或降级）：',
    ...PERMISSIONS.filter(item => item.level === '增强').map(item => `  ${item.scope} — ${item.purpose}`),
    '按需敏感权限（默认不要申请）：',
    ...PERMISSIONS.filter(item => item.level === '按需敏感').map(item => `  ${item.scope} — ${item.purpose}`),
    '另需完成以下配置（不是 scope）：',
    '  1. 开启机器人能力；事件与回调都选择“使用长连接接收”。',
    '  2. 事件订阅：im.message.receive_v1（接收消息）。',
    '  3. 回调订阅：card.action.trigger（新版卡片交互：审批、停止、打断）。',
    '  4. 保存配置、创建并发布版本，按租户要求完成管理员审批与可用范围配置。',
    '  5. 将机器人加入测试群；用 owner 私聊及群 @ 验证收发、表情、卡片按钮。',
    '说明：send_as_bot 已覆盖当前发送/编辑接口，不必重复申请 im:message:update；',
    '已有 im:message 可覆盖部分发送/编辑/表情接口，但不替代接收事件权限，不建议为此扩大授权。',
    '获取机器人自身信息和 card.action.trigger 无额外 scope；网关使用 open_id，不需通讯录/user_id 权限。',
    '附件接收需 im:message:readonly（或接口接受的历史读取权限）；仅有 im:resource 不能替代消息资源下载权限。',
    '上传也接受已有 im:resource；无需重复申请。图片识别还需视觉模型，音视频仅作为文件，不自动转写。',
    '无需为网关基础能力申请文档、云盘或日历权限；额外工具按具体用途另行授权。',
    '本流程只提供清单，不申请或变更权限；凭据已保存不等于权限已开通或服务已在线。',
    '完整说明与官方依据：docs/PERMISSIONS.md；可用 setup --permissions-json 输出推荐权限 JSON。',
  ].join('\n');
}
