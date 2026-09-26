# 干净环境安装

## 支持范围

国内飞书；单机器人、单网关进程；macOS 或 Linux。Node.js **>=22.21.0**，推荐 Node 24 LTS；npm 随 Node 安装。系统需有 `tar`。不承诺国际版 Lark 或 Windows。源码开发版本为 `1.0.0-rc.1`，实际 CI 发布版本由 release 分支名决定，不等于已发布 GA。

使用专用普通 OS 用户，不要以 root 运行。网关访问该用户的 `HOME`；常驻服务必须使用同一用户。需要外网访问飞书及所选模型服务，代理按实际环境配置，不预设端口。

## 1. 获取程序：npm 或源码包

### npm 安装（对应版本正式上传后）

```bash
npm install -g pi-lark-gateway@beta --ignore-scripts  # release 分支候选版
# 稳定版使用 @latest，生产建议固定 @具体版本
pi-lark-gateway --version
pi-lark-gateway --help
```

不需要 clone 仓库；npm 包包含 `pi-lark-gateway` CLI 和锁定依赖的 `npm-shrinkwrap.json`，不包含源码测试/发布脚本。当前版本未上传前，不能把上述安装当成已经可用的 registry 版本。

之后仍须完成下文的模型授权和飞书配置。npm 用户将文中的 `npm run setup` / `npm run doctor` / `npm start` / `npm run backup` / `npm run restart` 分别替换为 `pi-lark-gateway setup` / `doctor` / `start` / `backup` / `restart`，**不需要 npm 的 `--` 参数分隔符**。例如 `pi-lark-gateway setup --manual`。

### 源码包安装

GitHub Release 使用共享 Action 产物：`pi-lark-gateway-<版本>-source.tar.gz`、npm `.tgz`、`SHA256SUMS` 和 `bundle.json`。校验文件也必须来自可信渠道。

```bash
# 下载源码包、npm tgz 和 SHA256SUMS 到同一目录；macOS 校验如下
# Linux 可用 sha256sum -c SHA256SUMS
shasum -a 256 -c SHA256SUMS
# 建议解压到一个新的版本目录，避免覆盖已有 source/ 目录
tar -xzf pi-lark-gateway-<版本>-source.tar.gz
cd source
node --version
npm ci --ignore-scripts
npm run verify
```

本地旧 `release:pack` 命令仍生成 `pi-lark-gateway-<版本>.tar.gz` 和独立 `.sha256`，顶层目录为包名加版本；不要与上述共享 Action 格式混用。

版本目录可以放在 `~/.local/opt/pi-lark-gateway/`。保留 `package-lock.json`，部署不要改用 `npm update` 或拷贝别的 OS 的 `node_modules`。依赖无需安装生命周期脚本，使用 `--ignore-scripts`。仅解压你信任的包。

## 2. 配置 Pi 模型授权（新机器必须做）

源码安装无需另装全局 Pi，在源码目录使用已锁定版本的 CLI：

```bash
./node_modules/.bin/pi
```

npm 安装用户可使用 `npm exec --package=@earendil-works/pi-coding-agent@0.86.1 -- pi` 打开与 SDK 配套的 Pi CLI（下载公开依赖，不要在 root 下登录）。两种方式使用同一 OS 用户的 `~/.pi/agent`。

进入 Pi 后：
1. `/login` 选择支持订阅登录的模型提供方并完成授权；或者按提供方说明配置对应 API key 环境变量。
2. `/model` 选择可用模型，Ctrl+S 保存启动默认模型。
3. 发送一个无敏感内容的测试问题，验证授权、网络和额度；这会产生真实模型调用。
4. `/quit` 退出。

授权通常保存在 `~/.pi/agent/auth.json`，默认模型在 `~/.pi/agent/settings.json`。网关复用同一用户的配置。若用 API key 环境变量，常驻服务也必须获得它；不要把密钥放进命令行参数、Git、群聊或共享的 service/plist 文件。按 [运维说明](OPERATIONS.md) 使用权限 600 的本地环境配置或提供方凭据存储。

`config.json` 中也可显式设置 `model: {"provider":"提供方标识","id":"模型标识"}`，使用 Pi 中实际列出的值，不要照抄虚构模型名。SDK 自定义模型/提供方见已安装 Pi 包的 `docs/providers.md` 和 `docs/models.md`。

## 3. 创建/接入飞书应用

### 先查看权限要求（离线，不授权）

```bash
npm run setup -- --permissions
# 推荐权限 JSON（不含非 @ 群消息敏感权限）：
npm run --silent setup -- --permissions-json
# npm 全局安装对应：pi-lark-gateway setup --permissions / --permissions-json
```

详见 [飞书应用权限清单](PERMISSIONS.md)：基础 3 项、增强 3 项、按需敏感权限、事件/回调及官方依据。以上命令不联网、不读取或覆盖配置，现有用户也可运行。扫码和手动配置完成后都会再次显示检查清单及当前应用的权限管理直达链接；程序不代为申请权限。

### 扫码创建

```bash
npm run setup
```

仅国内飞书。扫码创建并关联新应用，不是已有应用 OAuth。配置已存在时拒绝覆盖，可用 `--config /绝对路径/config.json` 另建配置。

### 扫码不可用：手动接入已有应用

在飞书开放平台创建企业自建应用并启用机器人，获取 App ID、App Secret 与该应用对应的 owner open_id。不要使用其他应用下的 open_id。

```bash
npm run setup -- --manual
```

交互式录入；App Secret 不回显、不写入 shell history；owner 必填。此命令只保存配置，不替你创建应用或验证服务端凭据。

### 平台配置清单

在开放平台按实际应用权限说明完成：
- 启用机器人；事件订阅使用长连接，订阅 `im.message.receive_v1`。
- 在**回调配置**中另加 `card.action.trigger` 并使用长连接；否则审批/停止/打断按钮无效。
- 基础应用权限：`im:message.p2p_msg:readonly`（私聊接收）、`im:message.group_at_msg:readonly`（群 @ 接收）、`im:message:send_as_bot`（发送/回复/编辑文本及卡片）。仅做单一聊天类型时可省略另一接收权限。
- 推荐增强权限：`im:message.reactions:write_only`（添加/撤回表情）、`im:chat:read`（审批群名称）、`cardkit:card:write`（原生打字机）。缺少时分别省略表情、显示群 ID、降级整卡更新，不阻断基础回复。
- 仅接收非 @ 群消息时申请敏感权限 `im:message.group_msg`，再显式配置群触发规则。不要为启动网关额外申请通讯录、云文档或云盘权限；无需重复添加 `im:message:update`，上述发送权限已覆盖当前编辑 API。
- 发布应用版本、完成租户审批、配置可用范围；将机器人加入测试群，确认能向 owner 发私聊。
- 扫码未返回 owner 时，先在本地补齐 `access.owner`，否则陌生用户无法申请审批。

新配置默认：owner 可用；其他用户须获 owner 审批；群内每条消息需 @；工具关闭。已有配置不会自动改变准入或工具权限。

## 4. 检查并首次启动

```bash
npm run doctor
npm start
```

自定义配置：`PI_LARK_CONFIG=/绝对路径/config.json npm run doctor`，启动时使用同一变量。

`doctor` 仅检查本地 Node/依赖/配置/文件权限/owner，不证明模型、飞书权限或 WebSocket 在线。启动日志需出现连接状态；用 owner 私聊和群 @ 完成首条回复验收，检查未授权用户仍需审批。不要同时启动第二个消费者。

确认后停止前台实例，再配置 [常驻部署](OPERATIONS.md)。

## 无凭据自动安装验证

```bash
npm run smoke:clean
```

在临时 HOME 和目录内复制发布文件、`npm ci --ignore-scripts`、运行测试及启动失败检查；不读取宿主 Pi/飞书凭据、不调用模型或飞书。会下载公开 npm 依赖，结束删除临时目录。这不是替代真实 E2E。

源码维护者还应执行 `npm run smoke:npm`，验证实际 tgz 在临时全局 prefix 下安装后 CLI 可用；不会更改本机全局包，也不会发布到 registry。
