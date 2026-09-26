# 飞书应用权限清单

本清单按当前 gateway 实际调用的接口和订阅的事件整理。使用**应用身份**（tenant_access_token），不是用户 OAuth。扫码创建应用、保存 App Secret、开通权限、发布应用和配置可用范围是不同步骤；setup 保存成功不代表后续步骤已完成。

## 1. 默认基础权限：私聊 + 群 @ + 回复

在 [飞书开发者后台](https://open.feishu.cn/app) 进入应用的「权限管理」，按 scope 搜索。setup 完成后会打印该应用的直达链接：`https://open.feishu.cn/app/<App ID>/auth`。

| Scope | 用途 | 缺少时 |
|---|---|---|
| `im:message.p2p_msg:readonly` | 接收用户发给机器人的单聊消息 | 收不到私聊；仅做群机器人时可不申请 |
| `im:message.group_at_msg:readonly` | 接收用户在群中 @ 机器人的消息 | 收不到群 @；仅做私聊机器人时可不申请 |
| `im:message:send_as_bot` | 发送/回复消息、向 owner 发送审批卡片、编辑文本及更新卡片 | 无法可靠发送和更新回复 |

`im:message:send_as_bot` 是当前发送、回复、编辑消息与更新消息卡片 API 的可选授权之一，因此**不必再重复申请 `im:message:update`**。已有更宽的 `im:message` 可覆盖部分发送、编辑、表情接口，但并不替代接收事件所需权限；不建议仅为启动本项目扩大为该权限，也不要未经核对就撤销旧应用已有权限。

## 2. 增强权限：推荐开通，缺少可降级

| Scope | 功能 | 缺少时的行为 |
|---|---|---|
| `im:message.reactions:write_only` | 收到消息添加处理中表情、结束后撤回自己的表情 | 表情失败不阻断回复；无需额外申请读取表情权限或订阅表情事件 |
| `im:chat:read` | 获取群名称，辅助 owner 识别审批申请来源 | 审批卡片继续使用群 ID；无需群成员列表或群管理权限 |
| `cardkit:card:write` | 创建/更新 CardKit 实体、组件、流式配置，提供原生打字机效果 | 自动退回原来的整卡更新；普通文本模式不使用该能力 |

群信息 API 也接受历史权限 `im:chat:readonly` 或更宽的 `im:chat`，无需同时申请；新用户优先选择 `im:chat:read`。基础审批卡片、停止/打断按钮并不要求 CardKit 权限，它们依赖消息发送/更新权限及下文的卡片回调配置。

## 3. 敏感权限：仅按需申请

| Scope | 何时需要 |
|---|---|
| `im:message.group_msg` | 确实需要机器人接收群内非 @ 用户消息，例如 `trigger: all`，或使用 `allowTextPatterns` 匹配非 @ 消息 |

此权限扩大可接收的群消息范围，**不包含在推荐导入 JSON 中**。仅开通权限不会自动放开网关：仍需明确调整群触发策略，白名单、审批、拉黑和拒绝规则继续生效。默认每条群消息需 @，不需要此敏感权限。

网关目前忽略其他机器人发送的消息，无需申请包含机器人消息的 `include_bot` 权限。文档中的较宽或历史替代权限不意味着必须全部开通。

## 4. 必须配置的能力、事件与回调（不是 scope）

1. 在应用能力中开启**机器人**。
2. 在「事件与回调」中选择**使用长连接接收**。本项目使用 WebSocket，不需要搭建公网 webhook。
3. 在**事件配置/事件订阅**中添加 `im.message.receive_v1`（接收消息）。接收范围仍由上述私聊/群聊权限决定。
4. 在**回调配置/回调订阅**中添加新版 `card.action.trigger`（卡片回传交互）。它用于 owner 审批以及回复卡片的停止/打断按钮；该回调本身无额外 scope。
5. 保存后创建并发布应用版本，按租户要求完成管理员审批，配置应用可用范围。**仅在权限页点击申请不一定立即生效。**
6. 确保 owner 在可用范围内、能与机器人私聊；将机器人加入目标群，再做 owner 私聊、群 @、审批卡片按钮、表情及打字机验收。

开通 `cardkit:card:write` 不能代替 `card.action.trigger` 回调订阅。长连接成功或 `doctor` 通过，也不证明权限、可用范围和所有回调已正确配置。

## 5. 当前不需要的权限

- 获取机器人自身信息 `GET /open-apis/bot/v3/info` 不需要额外 API scope，但仍需应用凭据与机器人能力。
- 网关使用 `open_id`，无需为接收敏感的 `user_id` 字段额外申请 `contact:user.employee_id:readonly`，也不需要全通讯录读取权限。
- 无需消息历史检索、成员管理、撤回消息、资源下载或图片上传权限。当前仅处理文字/富文本，不因接收到附件就自动下载。
- 无需文档、云盘、日历、邮件、任务、多维表格等业务权限。这些不是 gateway 的启动依赖；若另行启用相关 Pi 工具/扩展，再按具体用途和身份单独授权。
- `/restart` 在网关内执行，仅需已有消息接收/回复权限和 owner/管理员授权，没有单独的飞书重启 scope。

## 6. 在安装引导中查看及导出

```bash
pi-lark-gateway setup --permissions
pi-lark-gateway setup --permissions-json
# 源码安装：
npm run setup -- --permissions
npm run --silent setup -- --permissions-json
```

这两个命令不联网、不读取或覆盖配置，也不申请权限；现有用户可直接运行，无需重新扫码或录入密钥。推荐 JSON 包含基础 3 项和增强 3 项，使用 `scopes.tenant`，`scopes.user` 为空；不包含非 @ 群消息敏感权限。可将 JSON 用于控制台权限批量导入，仍须人工核对、发布并完成租户审批。

扫码和手动配置在保存凭据后都会显示同一份权限清单、当前应用权限链接、事件/回调订阅和发布检查步骤。程序不会自动修改已有应用权限、机器人访问策略或工具开关。

## 官方依据与代码对应

- [接收消息事件及权限范围](https://open.feishu.cn/document/server-docs/im-v1/message/events/receive)：`src/gateway/index.js` 注册事件，`src/gateway/route.js` 做准入。
- [发送消息](https://open.feishu.cn/document/server-docs/im-v1/message/create)、[回复消息](https://open.feishu.cn/document/server-docs/im-v1/message/reply)、[编辑消息](https://open.feishu.cn/document/server-docs/im-v1/message/update)、[更新消息卡片](https://open.feishu.cn/document/server-docs/im-v1/message-card/patch)：`src/lark/messages.js`、`src/lark/cards.js`。
- [添加表情](https://open.feishu.cn/document/server-docs/im-v1/message-reaction/create)、[删除表情](https://open.feishu.cn/document/server-docs/im-v1/message-reaction/delete)：`src/lark/reactions.js`。
- [获取群信息](https://open.feishu.cn/document/server-docs/group/chat/get-2)、[获取机器人信息](https://open.feishu.cn/document/client-docs/bot-v3/obtain-bot-info)：`src/lark/metadata.js`。
- [流式更新文本](https://open.feishu.cn/document/cardkit-v1/card-element/content)：`src/lark/card-stream.js`（同一 `cardkit:card:write` 覆盖相关创建/更新接口）。
- [卡片回传交互](https://open.feishu.cn/document/feishu-cards/card-callback-communication)：`src/approvals/` 与 `src/controls/`。

飞书权限名称、替代 scope 和租户审批策略可能变化；以对应接口/事件的最新官方说明及本租户控制台为准，不要把同一 API 的“任一权限即可”误当作必须全部申请。
