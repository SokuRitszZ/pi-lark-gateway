# pi-lark-gateway

飞书官方 SDK WebSocket → pi SDK → 原地更新回复。Node >=22.21。GA 支持范围仅国内飞书，国际版 Lark 不在支持承诺内。

npm 发布后可直接安装（当前候选版尚未上传）：

```bash
npm install -g pi-lark-gateway@beta --ignore-scripts  # 分支候选版；正式版用 @latest 或固定版本
pi-lark-gateway setup
pi-lark-gateway doctor
pi-lark-gateway start
```

也支持源码安装：

```bash
npm ci --ignore-scripts
npm run setup                    # 扫码创建并关联机器人
# npm run setup -- --manual      # 已有应用/扫码不可用时手动接入
npm run doctor                   # 只做本地检查
npm start
npm run verify
```

网络需要代理时设置 `HTTPS_PROXY` / `HTTP_PROXY`。默认复用 `~/.pi/agent` 的模型凭据。会话策略 `tools: "none"` 禁用工具、扩展和 Skills；`tools: "all"` 开放 pi 默认工具并加载本机扩展、Skills 和上下文。支持文字、富文本，附件解析尚未实现。

## 安装、部署和发布

- [干净环境安装](docs/INSTALL.md)：Node/Pi 模型授权、扫码与手动接入、平台权限和首次验收。
- [运维手册](docs/OPERATIONS.md)：Linux systemd / macOS LaunchAgent、日志轮转、本地诊断、备份恢复、升级回滚。
- [发布流程](docs/RELEASING.md)：release/x.y.z 分支自动 beta、PR 合入 main 自动正式版、npm OIDC 和失败重试。
- [变更记录](CHANGELOG.md) · [安全说明](SECURITY.md) · [许可状态](LICENSE)

当前源码开发版本为 `1.0.0-rc.1`，CI 的实际发布版本由 `release/x.y.z` 分支名决定。支持 npm 运行时包（带 shrinkwrap）与源码包双渠道分发；配置可信发布者并开启发布开关后，release 分支每次 push 自动发新的 beta，PR 合入 main 自动发正式版。CI 同步修改产物的 package/lockfile，不向源码分支回写版本提交，也不会部署或重启服务。许可证暂为 `UNLICENSED`，不是开源授权。新机器必须先按安装文档配置 Pi 模型授权，单跑 setup 不会获得模型凭据。

部署模板位于 `deploy/`，需按目标主机填写绝对路径，**不会自动安装/重启**。同一 App ID 只运行一个实例，避免与手动 `npm start` 并行。

## 代码结构

每个 feature 独立目录，`index.js` 为公开入口；跨 feature 通过入口导入。编排文件不承载具体 SDK/存储实现。

```text
src/
├── index.js             # 进程启动、代理、退出信号
├── gateway/             # 应用组装、事件处理流程编排
├── onboarding/          # 初始化 CLI、注册协议
├── config/              # schema、持久化迁移、策略、热加载
├── approvals/           # 审批服务、申请条件、卡片渲染
├── messages/            # 消息归一化、队列、回复流程、话题映射
├── progress/            # 文本/工具时间线、进度收集和节流
├── debug/               # 单消息虚拟身份转换
├── agent/               # pi 会话池、模型回答
├── lark/                # 飞书连接、消息、卡片、表情、元信息 API
└── storage/             # 私有 JSON 原子写入
```

`npm start` 和 `npm run setup` 用法不变，配置与会话存储路径不变。详见 `AGENTS.md` 的结构约定。

## 本地配置 v2

默认配置目录 `~/.config/pi-lark-gateway/`：

- `config.json`：Bot 配置、全局访问策略、owner/admins、模型。
- `credentials-<UUID>.json`：独立 App Secret，权限 600；由 `bot.credentialsFile` 引用，不进仓库。
- `groups.json`：可选的逐群策略覆盖。只支持本地编辑，**没有群内卡片或配置命令**。

`PI_LARK_CONFIG=/绝对路径/config.json npm start` 可使用另一份配置。v1 首次启动会自动迁移：将密钥移出 config，保留旧运行时的“所有用户、有问必答”，不会按旧的未生效字段突然禁用群聊。配置及密钥均以私有临时文件原子写入；配置仍为明文，不是加密存储。

新安装默认最小权限：群聊每条消息必须 @，owner 直接使用，其他人需 owner 私聊审批；私聊默认同样需要审批。工具默认关闭（同时禁用本机扩展、Skills 和上下文文件），回复 normal，管理员与白名单初始为空。审批只授予当前会话访问权，批准后需重新发送消息。未配置 owner 时不允许陌生人使用，也不发送审批请求。现有配置及旧版本迁移保留原有策略，不自动覆盖。

config 示例（真实配置由 setup 生成）：

```json
{
  "version": 2,
  "bot": {
    "appId": "cli_xxx",
    "domain": "feishu",
    "name": null,
    "openId": null,
    "credentialsFile": "credentials-xxx.json",
    "connectionMode": "websocket"
  },
  "access": {
    "owner": "ou_owner",
    "admins": [],
    "private": { "enabled": true, "users": "allowlist", "allowedUsers": [], "trigger": "all", "tools": "none", "onUnknown": "ask_owner" },
    "groups": { "enabled": true, "users": "allowlist", "allowedUsers": [], "trigger": "mention", "tools": "none", "onUnknown": "ask_owner" }
  },
  "session": { "private": "chat", "group": "thread" },
  "model": null
}
```

- `model: null` 使用 pi 默认/会话模型；显式选择为 `{"provider":"...","id":"..."}`。
- `users`: `all` 或 `allowlist`。白名单模式仅允许 listed users、owner、admins；`enabled:false` 对所有人禁用。
- `trigger`: `all` 或 `mention`。群 mention 模式匹配机器人 Open ID，或下述文本白名单；话题内追问也使用同样规则。私聊忽略 trigger 和文本规则。
- `allowTextPatterns`: 可选正则字符串数组，任意一条匹配即可替代 @，**不会绕过用户白名单/审批**。例如 `["测试\\s*PI", "^问答："]`（JSON 文件中反斜杠需写成 `\\`）。不配置或空数组保持原行为。
- `denyTextPatterns`: 可选正则字符串数组，任意一条匹配即静默拒绝，不回复、不申请审批；优先于 @ 和文本白名单，`trigger: "all"` 时也生效。
- 文本规则支持全局群策略及逐群完整覆盖，匹配普通文本和富文本标题/正文，排除 @ 占位符和附件元数据。采用 JavaScript Unicode 正则、区分大小写，不写 `/…/` 包裹；每个列表最多 50 条，每条 1–1000 字符。请仅配置可信、简单的正则，避免嵌套量词等可能导致回溯耗时的表达式。无效正则会拒绝整次配置载入。
- `tools` 支持 `none` / `all`，在后续任务开始时生效。`all` 可读写宿主文件、执行命令，并加载本机搜索/记忆扩展；不是沙箱，获准用户可能访问个人记忆。白名单、审批、拉黑仍独立生效。标题摘要始终无工具。
- owner/admins 区分管理身份与普通使用者；由于没有远程配置入口，管理身份目前用于白名单豁免和后续扩展。
- Bot 名称和 Open ID 启动时通过 API 尝试获取，保存在状态目录 `bot-meta.json`；`bot.openId` 可本地显式覆盖。

逐群配置使用完整策略，不做字段级合并：

```json
{
  "version": 1,
  "groups": {
    "oc_example": { "enabled": true, "users": "allowlist", "allowedUsers": ["ou_example"], "trigger": "mention", "tools": "none" }
  }
}
```

`config.json` 顶层可选 `answerTimeoutMs`：毫秒整数，省略、`null` 或 `0` 表示不设 gateway 回复超时（默认）；例如 `300000` 表示 5 分钟，最大 `2147483647`。支持热加载，仅对之后开始的回复生效；不包含排队时间，不改变模型服务自身的网络超时。用户仍可手动停止。

**热加载**：每 3 秒校验并载入访问策略和逐群配置；无效变更保留上一份有效配置并记录警告。仅影响后续消息，不终止已接收任务。修改 App ID、Secret、地区、连接模式或模型需要重启。当前仅支持 WebSocket、私聊按 chat、群聊按 thread。

开放策略允许所有能够向机器人发消息的人消耗模型额度。单进程全局默认最多同时处理 **10 个会话**，超出的 FIFO 等待，同一会话仍串行。后台归档也共享这 10 个名额；这是会话任务并发限制，不是所有 HTTP 请求数限制。尚未实现等待队列上限或逐用户限流，不适合不受信任的大群。已有配置显式设置的 `tools: "all"` 不会自动改为 `none`，关闭工具需本地修改对应策略。

## 群白名单的 Owner 审批

群策略 `users: "allowlist"` 时，未授权用户触发有效对话请求会给 `access.owner` 发送私聊卡片。策略可加 `onUnknown: "ask_owner"`（未填写时默认）或 `"deny"`（静默拒绝）。私聊同样支持白名单问询 owner，使用 `access.private` 策略，授权限定到对应私聊会话。

- 只有当前 owner 可以点「授权 / 拒绝」；还会校验卡片消息 ID、请求随机 ID、过期和处理状态。
- 授权仅针对该用户 + 该群；不改变工具权限、不绕过群禁用或触发条件。授权后用户需重新发消息，不自动重放原请求。
- 待审批请求 24 小时有效；同会话同用户合并待审批请求。拒绝后发送新消息可立即重新申请，同一消息重投不重复申请。投递失败冷却 60 秒。
- 授权、拉黑和审批状态保存在应用状态目录 `access-approvals.json`（600），重启保留。已授权卡片可「收回权限」或「拉黑」，待审批/拒绝卡片也可拉黑；拉黑后提供「解除拉黑」。仅当前 owner 可操作。收回只删除审批授权，不覆盖本地显式白名单/管理员或 all 策略；拉黑优先于所有普通准入策略，按用户+会话限定，停止回复和申请。解除拉黑不会恢复旧授权。操作影响后续消息，不中止已在执行的任务。旧申请被新申请取代后不能再操作。
- 在飞书开放平台「事件与回调」的 **回调配置** 中添加 `card.action.trigger`，使用长连接。仅订阅消息事件不够；权限/发布要求以控制台为准。机器人必须能向 owner 发私聊。
- 全开放模式不会触发审批。本次升级不自动把现有群切换为白名单。

### Owner 专用调试

在群或私聊发送一条多行消息：首行 `/debug assume 张三`（也可写邮箱），换行后写正常问题。允许前置 @机器人。仅真实 owner 可用（admins 不可用）；首行被移除，余下正文以虚拟发送者进入正常权限、审批、回复流程。身份只对这一条消息生效。

名字/邮箱是**虚拟身份标签**，不会查询通讯录或授权同名真实员工。`all` 策略直接回答，`allowlist` 且未授权则私聊 owner 问询；禁用会话则拒绝。不会强制审批或修改正式策略。测试授权只针对 `debug_` 前缀身份，审批卡片标注 `[模拟测试]`。

批准后重新发送相同标签加正常问题，即正常回答；拒绝后发送新消息可再次问询。不同会话授权隔离。仍需在飞书开放平台订阅 `card.action.trigger` 回调。

## 回复与会话

私聊/群策略支持 `replyMode: "normal" | "card"`，省略默认 normal，可热加载。逐群覆盖使用同一字段。

- normal：文本占位、工具进度、原地更新最终文本。
- card：立即发送灰色等待卡片；生成中蓝色，完成绿色，失败红色。标题用当前会话模型在独立临时会话中总结本次消息意图，不写入正式对话；每条回复会额外调用一次模型，标题失败/超时回退为“对话回复”。正文按实际顺序实时保留本轮助手中间说明、工具名称/状态及最终答复；工具完成后在原位置更新，不把之前的文本覆盖掉，也不重复追加最终聚合文本。长内容生成中就拆为续卡，后续原地更新这些续卡；结束后所有卡片更新为终态，停止/失败保留已输出内容并追加提示。
- card 蓝色阶段在首张卡片提供「停止」与输入框 +「打断」，续卡不重复提供控制按钮。停止请求立即取消当前模型运行，待当前工具响应取消后显示橙色“已停止”，不会取消其他排队消息；已完成的外部副作用不会回滚，独立后台子任务不保证被一并停止。打断通过 SDK steering 注入，在下一个执行边界处理，不强杀当前工具。仅本轮发起人、owner、管理员可操作，且实时检查访问权限与拉黑状态。结束/重启后旧卡片控制失效。
- 同话题普通新消息立即显示等待卡片，但模型执行、最终回复与清理按顺序完成后才启动下一条；不同话题可并行。卡片打断是唯一绕过普通消息队列的输入途径。
- 模式在收到消息时选定，不中途转换已发出的消息。回复卡片使用 JSON 2.0（需飞书客户端 7.20+），正文放在 `body.elements` 的 Markdown 组件中，以支持标题、引用和表格；标题保持纯文本。按钮使用 2.0 的 `behaviors` 回传和 `form_action_type` 表单提交协议。实际排版以飞书支持的 Markdown 语法为准。


收到消息加随机表情，立即发送占位回复。群内使用 `reply_in_thread` 创建话题。normal 模式生成中最多显示最近 10 条工具名称和状态，完成后原地替换为最终答案，长回答分段续发；card 模式实时保留整轮文本与工具时间线（工具条目不限制为最近 10 条）。两种模式均不展示内部推理、工具参数或原始工具结果；完成后撤回本次表情。

私聊整个 chat 共用上下文；群内按话题隔离，同话题参与者共享。状态在 `~/.local/share/pi-lark-gateway/<App ID>/`，包含话题映射、Bot 元信息和哈希会话目录中的 JSONL。旧版按用户拆分的历史不自动合并。重启恢复会话；事件去重仅存在内存中。

### 会话过期归档

连续 **30 天**没有处理新交互的会话会被归档（按最后一轮开始/结束时间及 JSONL 修改时间中的较新值计算，失败/停止的交互也刷新时间）。启动、每小时巡检和再次访问时检查；正在处理或已进入会话池排队的任务不会被后台归档。

归档使用隔离的无工具模型会话，分段生成历史摘要；明确写入“该会话已过期被归档”。摘要先以权限 600 原子保存到原会话目录的 `archive.json`，再删除被摘要覆盖的会话 JSONL 并释放缓存。下次对话以摘要作为历史上下文开启新会话，不恢复原始逐条记录。连续多次归档会合并上一份摘要。

- 摘要生成、校验或保存失败时保留原始记录，记录脱敏错误，**正常聊天继续**，不把归档当成回复的前置条件。
- 删除中断可由持久化清理清单恢复；原文件已改变时停止清理，不删除新内容。用户恢复聊天后旧清理计划作废，保留现存原文件及已保存摘要，重新达到空闲期才再次归档。
- 不删除工具生成的其他文件、话题映射或授权状态。`activity.json` 记录交互时间，摘要长期保留。
- 摘要会产生额外模型调用费用，并且是有损压缩；不保留系统提示、内部推理、工具参数或图片二进制。原始 JSONL 合计超过 32 MiB 时自动归档暂缓并记录错误，需人工处理，避免截断历史后误删。
- 仅网关运行时执行巡检；停机期间的过期会话在下次启动后处理。

## 平台配置与初始化协议

飞书开放平台启用长连接，订阅 `im.message.receive_v1`，赋予发消息、编辑消息、表情回复所需权限。普通群消息是否投递仍由飞书授权决定：不 @ 的全群消息可能需要 `im:message.group_msg`，按控制台说明发布审批。历史拉取权限失败不等于 @事件或话题回复失败。

扫码参考 Hermes commit `69948c005791d4d0e51670ca015238c2c7663749`：账号服务 `/oauth/v1/app/registration` 的 init → begin（PersonalAgent/client_secret）→ poll。注册接口独立于消息 SDK，不能视为已验证的公开稳定 API；受租户/地区/上游变更影响。这是创建关联应用，不是已有应用的 OAuth。支持时效、取消、拒绝和 slow_down；拒绝国际版租户和关联链接。不会输出密钥或覆盖已存在的配置。扫码不可用时使用 `npm run setup -- --manual`。

自动化测试使用模拟 transport；维护者已确认国内飞书既有功能 E2E 通过。新部署仍应完成最小 owner 回复验证。`npm run smoke:clean` 仅验证无凭据干净安装，不会发消息或调用模型。
