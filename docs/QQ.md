# QQ 接入指南（首版：文本，待真实账号联调）

QQ 代码直接位于 **pi-lark-gateway 的 release/1.1.0**，不是另一个仓库。
`src/adapters/qq/` 对接官方 `@tencent-connect/qqbot-nodejs@1.0.4`；
`src/qq-gateway/` 负责配置、组合与生命周期，共用 `src/core/`。
Lark 的配置、命令及会话路径不变，两者可以使用不同账号同时运行。

## 表情回应实验与处理提示

官方出处：[发表表情表态](https://bot.q.qq.com/wiki/develop/api/openapi/reaction/put_message_reaction.html)。文档定义 `PUT /channels/{channel_id}/messages/{message_id}/reactions/{type}/{id}`，`channel_id` 是子频道 ID，成功为 HTTP 204。没有证据证明群/私聊的 openid 可替代它。

按用户要求提供隔离的假设验证开关：`"experimentalChannelReactions": true`。默认关闭；开启后，每个进程对**私聊和群聊各一条**已通过白名单与去重检查的新消息尝试频道路径，使用原生目标 ID 作为实验候选路径参数，绝不修改身份模型或将其宣称为有效频道 ID。PUT 请求限时 3 秒、不重试；错误只记录安全的 HTTP 状态码，不阻断正常回复。`qq_reaction_probe_*_accepted` 仅代表 API 接受，仍需客户端确认贴图效果；失败也可能源于权限、消息或参数问题，不能据此断言平台绝不支持。

另有可选 `"processingFeedback": true`：私聊用官方正在输入提示（30 秒），群聊另发一条“⏳ 正在处理”。这不是原消息上的表情。默认关闭；若实验开关同时开启，优先实验，不再另发群提示。提示发送失败仍继续回答，不自动重试。

修改配置后用 `pi-gateway qq restart` 加载，再从已授权的私聊与群各发一条消息，通过 `pi-gateway qq logs` 查看实验结果。当前实现已离线验证；未默认对真实账号执行实验。

## Markdown 回复与工具

默认通过官方 SDK 的 `sendMarkdown` 发送最终回复（`msg_type=2`），适用于 C2C 和群 @，保留原生回复目标及消息 ID。可使用简洁 Markdown 排版；不是飞书式可更新卡片，暂不提供按钮、流式编辑或工具进度卡片。

配置 `"replyFormat": "text"` 可切回纯文本；省略该字段默认 Markdown。为避免网络结果不确定时重复发送，Markdown 失败不会自动补发纯文本；遇到账号能力限制时请手动改格式并重启。

工具与格式独立：`"tools": "all"` 允许所有已在白名单中的私聊/群成员使用宿主机 Pi 工具、扩展与 Skills（不是沙箱）；默认仍为 `none`。修改后安全重启 QQ 生效。不要把全工具能力开放给不可信用户。

## 启动后返回终端与查看失败原因

统一入口 `pi-gateway qq start` 在 macOS / Linux 默认后台运行；使用 `status` 看状态、`logs` 看安全诊断码、`stop` 请求安全退出，`restart` 等待旧后台退出后重新启动。调试时使用 `pi-gateway qq start --foreground`。自定义配置的这些命令均沿用同一个 `--config`。

已有前台实例不会自动迁移：先在原终端 Ctrl+C 停止，再启动后台实例。旧 `pi-qq-gateway start` 和 `node bin/pi-qq-gateway.js start` 保持前台行为。后台运行不等于开机自启，具体行为见 [CLI 运行管理](CLI.md#后台运行与诊断)。

已修复一类稳定复现的 `处理失败（UNKNOWN）`：QQ 的最终回复器不提供流式 `event` 方法，共用消息层现在仅在该方法存在时转发模型进度事件。旧的运行中进程需要安全停止后重新启动才能加载修复。

QQ 消息通道（WebSocket/Webhook）与模型请求是两条独立连接。QQ 收到消息不代表模型出口正常。独立 CLI 现与飞书入口共用显式 Undici 环境代理初始化，读取 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`；仅 Node 的 `--use-env-proxy` 在当前 SDK 依赖组合中不足以保证模型 fetch 走代理。后台进程继承启动终端环境，修改环境或代码后需安全停止再启动；不需要把 QQ WebSocket 改成 Webhook。Pi 扩展模式保留宿主的网络设置，不主动覆盖全局代理。

历史前台错误若未重定向到文件，不能从新日志补回；排查时需提供回复中的错误码，不要发送密钥或完整私人聊天记录。

## 遇到 `empty_allowlist`：继续初始化白名单

这个错误表示配置文件已有，但还没有确认授权任何 QQ 身份，**不是需要放开安全检查**。

```bash
pi-gateway qq authorize
# 若之前使用自定义配置，沿用同一路径：
pi-gateway qq authorize --config /path/to/config.json
```

此入口复用已有 AppID、密钥及模型设置，不需要重新填写。连接就绪后，从自己的 QQ 私聊机器人或在测试群 @；发送后回车，空格勾选身份，再确认授权。完成后执行 `pi-gateway qq start`（同样沿用自定义 `--config`）。

菜单现在区分「初始化配置 / 接入向导」和「初始化 / 补充白名单」。没有配置时先运行 `pi-gateway qq setup`；`init` 只生成模板，不代表初始化完成。跳过身份采集、没收到消息或拒绝授权时，向导明确提示暂不能启动。未收到消息要先检查 QQ 后台权限及 Webhook HTTPS 回调。

## 推荐：统一入口与接入向导

源码安装后直接运行 `npm run gateway`（或 `node bin/pi-gateway.js`），选择 QQ → 接入向导。
安装到 PATH 后命令名为 **`pi-gateway`**；旧命令保留兼容，npm 包名仍是 pi-lark-gateway。

```bash
pi-gateway               # 菜单选择 Lark / QQ，再选择配置或启动
pi-gateway setup         # 选择平台并接入
pi-gateway qq start      # 配好后直接启动
```

QQ 向导会依次询问 AppID、隐藏输入 AppSecret、连接方式和模型（尽量沿用本机 Pi 默认模型），
然后保存私有配置；可直接连接发现测试身份，在你发送测试消息后选择候选并确认白名单。
不需要再手工运行 init → 编辑密钥 → discover → 抄 OpenID → 改 JSON。
方向键选择平台与连接方式；密码遮蔽显示，输入就地校验；连接阶段显示进度。
发送测试消息后按回车，使用空格多选身份，再确认授权。候选身份不会在输入过程中打断终端显示。
陌生候选不会自动授权，重配前需确认，工具仍默认关闭。Ctrl+C / Esc 可取消。

AppSecret 保存到配置目录下独立 `credentials-*.json`（0600），不是加密存储；
`config.json` 只保存文件名。启动时无需反复设置环境变量；若设置了 `QQBOT_APP_SECRET`，它优先。
不要把整个配置目录提交到 Git。重配会保留旧凭据文件，不自动删除。

QQ 平台机器人创建、测试范围、权限及回调设置仍需在后台完成。
选择 WebSocket 可省公网回调，但必须确认后台开放；Webhook 仍需公网 HTTPS。
下面为手动配置和故障排查的完整说明，也适用于自动化部署。

## 已实现与边界

- QQ 消息列表私聊（C2C）和群内 @；不支持频道 / 频道私信。
- Webhook（默认，验签）和 WebSocket（需平台为你的账号开放）。
- 文本输入、单条最终 Markdown 回复；3500 UTF-8 字节以上明确截断，不做多条自动补发。
- 用户白名单；群必须同时匹配 group_openid 与 member_openid。
- C2C 按用户隔离，群按“群 + 成员”隔离上下文。群回复仍对所有群成员可见。
- `PIGateway.QQ` 当前轮可信身份，保留原生 ID；不与 Lark open_id 混用。
- `tools:none` 默认关闭工具、Skills、扩展和本地上下文。`tools:all` 必须由本地配置显式启用。
- CLI，以及只在本机 Pi 中手动启动的 `/qq start|stop|status` 扩展。

**尚未实现**：附件下载/视觉/音视频解析、QQ 文件发送工具、流式输出、卡片审批、
远程停止/插话、跨成员共享话题。附件不会下载；模型会收到“附件未解析”的提示。

本版本是代码和自动测试已验证的首版，不是已完成真实 QQ 账号验收的生产发布。

## 1. 准备 QQ 官方机器人

1. 打开 [QQ 开放平台](https://q.qq.com/)，完成开发者登记并创建官方机器人。
2. 在机器人开发设置获取 **AppID / AppSecret**。AppSecret 仅通过本地向导保存为私有文件或注入服务端环境变量，
   不要发到群里、写进源码、截图或提交到 Git。
3. 按后台可用能力配置测试账号与测试群，将机器人加到对应测试场景。
4. 订阅 `C2C_MESSAGE_CREATE` 和 `GROUP_AT_MESSAGE_CREATE`。
5. 如果后台要求 IP 白名单，填写服务器调用 QQ API 时的**公网出口 IP**，不是本机局域网地址，
   也不是 Webhook 的腾讯来源 IP。模型网络和 QQ 网络都须可达。
6. Webhook 场景需要公网 HTTPS 地址与有效证书；后台选择**事件回调**，不要填进网页 OAuth 回调配置。

参考：[官方接入指南](https://bot.q.qq.com/wiki/)、
[事件与消息文档](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/overview.html)。
平台准入、沙箱范围、发送额度和审核要求以你当前开发者后台为准。
SDK 1.0.4 仍默认旧 API 域名；本适配器显式使用 `https://api.bot.qq.com`。

## 2. 安装源码与模型授权

Node.js **>=22.21.0**，需要 Git 与 npm。以下不依赖某个 npm beta 已发布：

```bash
git clone --branch release/1.1.0 https://github.com/SokuRitszZ/pi-lark-gateway.git
cd pi-lark-gateway
npm ci --ignore-scripts
node bin/pi-qq-gateway.js init
```

默认生成 `~/.config/pi-qq-gateway/config.json`（0600，不覆盖现有文件）。
模型授权复用运行该进程的操作系统用户的 `~/.pi/agent/`。先用已安装的 Pi
完成模型登录并确认正常对话；在配置中填实际 `provider` / `id`。
**QQ AppSecret 和模型 API key 是两类凭据，不能混用。**

初始配置如下，先填写 AppID 和模型；白名单在第 4 步补齐：

```json
{
  "appId": "你的AppID",
  "transport": "webhook",
  "webhook": { "host": "127.0.0.1", "port": 8080, "path": "/qq/callback" },
  "model": { "provider": "你的模型provider", "id": "你的模型ID" },
  "tools": "none",
  "replyFormat": "markdown",
  "answerTimeoutMs": 90000,
  "access": { "c2cUsers": [], "groups": {} }
}
```

将密钥通过你的密码管理器或服务环境注入 `QQBOT_APP_SECRET`。
交互终端 Bash 可使用不回显的读取方式（不要把真实密钥直接写入命令历史）：

```bash
read -r -s -p 'QQ AppSecret: ' QQBOT_APP_SECRET; echo
export QQBOT_APP_SECRET
```

可用 `PI_QQ_CONFIG=/绝对路径/config.json` 或 CLI `--config /绝对路径/config.json`
选择独立配置。程序不自动读取 `.env`，配置修改需要停掉 QQ 再重新启动。

## 3. Webhook：公网 HTTPS 转发至本机

默认仅监听回环地址。使用 Caddy / Nginx / 可信隧道，把公网 HTTPS 指定路径
转发至 `http://127.0.0.1:8080`，保留原始请求体和签名头，不要先 JSON 解析再重新编码。
以 Caddy 为例，替换为解析到服务器的真实域名：

```caddy
qqbot.example.com {
  @qq path /qq/callback
  reverse_proxy @qq 127.0.0.1:8080
  respond "Not Found" 404
}
```

QQ 后台事件回调 URL 填 `https://qqbot.example.com/qq/callback`。
先按下一步启动 `discover`，使回调服务在线，再保存/验证回调地址。
如果代理与程序不在同一宿主机，不要照抄回环配置；需单独设计受限网络转发。

程序通过 QQ SDK 验证 Ed25519 签名及回调 challenge，另有限制：1 MiB 请求体、
10 秒请求超时、事件签名时间戳最大偏差 5 分钟。服务器须正确同步时钟。
SDK 收到事件后及时 ACK，模型生成不阻塞回调确认。

**WebSocket 备选**：仅在后台确认支持时，将 `transport` 改为 `websocket`。
这时不需要公网回调；不能仅凭 SDK 有接口就断言你的账号可用。
QQ SDK 的代理行为与 Lark 不同，本版没有承诺 HTTP_PROXY 自动代理 WebSocket。

## 4. 获取自己的 QQ OpenID 并设置白名单

普通 QQ 号不是 API 使用的 OpenID。不要从 QQ 号猜测，也不要复用 Lark ID。

```bash
node bin/pi-qq-gateway.js discover
```

`discover` 只连接 QQ 并在**本地终端**打印事件中提取的 ID：不启用模型、不执行工具、
不回复用户，不打印消息正文。配置白名单可以暂时为空。

1. 从测试账号给机器人私聊，查看 `QQ.sender.user_openid`。
2. 在测试群 @ 机器人，查看 `QQ.group_openid` 和 `QQ.sender.member_openid`。
3. Ctrl+C 停止发现模式，分别填入配置：

```json
"access": {
  "c2cUsers": ["私聊user_openid"],
  "groups": { "群group_openid": ["这个群允许的member_openid"] }
}
```

C2C 用户 ID 与群成员 ID 不保证相同。初版不提供 `*` 或自动授权；未知用户不触发模型。
发现模式应仅在你控制的测试范围运行，用完及时关闭，本地终端输出也应妥善保管。

## 5. 正式启动（二选一）

### 独立 CLI

```bash
node bin/pi-qq-gateway.js check
node bin/pi-qq-gateway.js start
# 或 npm run start:qq
```

`check` 只验证本地配置和环境变量存在，不验证 QQ 或模型联网。
看到 `qq_gateway_ready` 表示传输已启动；Webhook 模式仅表示本地服务器已监听，
仍需后台回调验证与一次真实消息收发。

### Pi 扩展

在同一个已设置 `QQBOT_APP_SECRET` 的环境中启动 Pi：

```bash
pi -e ./src/qq-gateway/extension.js
```

然后在**本机 Pi 界面**输入：

```text
/qq start
/qq status
/qq stop
```

也可 `pi install /绝对路径/pi-lark-gateway` 持久安装资源，然后重新加载 Pi。
扩展工厂仅注册命令，不自动联网；切换会话、reload 或退出时关闭 QQ gateway，
需在新会话再次 `/qq start`。QQ 使用独立会话池、配置中的模型和系统用户的模型凭据，
不会把本机 Pi 当前对话或 prompt 直接转给 QQ，也不会自动继承本机 `/model` 的选择。

**同一个 AppID 只运行一个 QQ 实例**：CLI、发现模式和扩展不要同时开启。
状态目录为 `~/.local/share/pi-qq-gateway/<AppID>/`，含会话和排他锁 `runtime.lock`。
发生强制退出残留锁时，先核对锁内 PID 并确认对应实例已经停止，再手动清理锁；
不要删除仍在运行进程的锁。不同 OS 用户/主机的实例需由部署者额外保证不重复运行。

## 6. 验收与运维限制

- 白名单用户私聊得到文本回答；非白名单不触发模型。
- 群 @ 需要群和成员两项匹配；同群两名成员的上下文互相隔离。
- 连续重复投递不重复生成；只有最终一次发送，网络结果不明时不补发错误消息。
- 验证错误或旧时间戳的 Webhook 被拒绝，配置与日志不泄露 AppSecret。
- 默认每分钟最多处理 30 个有效结构事件、最多 10 个活跃会话；同会话忙时丢弃新请求并记录 `qq_busy`，请等回复后重发。
- 生成超时可配置 1–120 秒，建议 90 秒。超过本地 120 秒回复期限不再发送。
  平台实际回复窗口、内容长度/链接限制、消息额度可能更严格，API 拒绝时以后台规则排查。
- 超长回复会明确截断，要求模型分段继续。无占位消息、流式或主动推送，以减少额度消耗。
- 去重为进程内内存策略，重启不保证去重；不自动重放未完成任务。
- 会话归档、并发和错误脱敏复用 core。SIGINT/SIGTERM 会关接入、取消模型、收尾并释放锁。
- `tools:all` 等于授予所有白名单用户宿主机上的 Pi 工具/扩展/Skills 能力，**不是沙箱**。
  仅可信操作员在受控环境启用；群聊成员仍能看到回复。首轮验收请保持 `tools:none`。

本版本自动测试覆盖配置、隔离、白名单、共享 core 身份注入、去重/发送失败、SDK
验签 challenge/事件、重放年龄、请求体限制、启动失败释放资源及扩展关闭竞态。
真实 QQ 凭据、平台准入、网络和模型调用须部署时另行验收。
