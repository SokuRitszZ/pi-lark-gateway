# CLI 交互设计

统一入口使用 **Commander 15.0.0 + @clack/prompts 1.8.1**。
命令解析和终端呈现不再使用手写数字菜单，平台运行逻辑仍由既有入口负责。

## 参考与取舍

- [Svelte sv](https://github.com/sveltejs/cli)：参考分步骤初始化与 Clack 交互。
- [Astro create-astro](https://github.com/withastro/astro/tree/main/packages/create-astro)：参考欢迎、选择、执行、下一步的流程；Astro 自身使用 `@astrojs/cli-kit`，不是照搬其实现。
- [Clack 官方示例](https://github.com/bombshell-dev/clack/tree/main/packages/prompts)：使用 intro/outro、select、password、confirm、multiselect 和 spinner。
- [Commander](https://github.com/tj/commander.js)：标准化 help、version、子命令及参数转发。

不复制其他 CLI 的品牌动画，不引入大型 TUI 框架。目标是清晰、可取消、脚本友好。

## 交互

```bash
pi-gateway                     # 方向键选择平台与操作
pi-gateway setup               # 选择平台并进入向导
pi-gateway setup qq            # 与 qq setup 等价
pi-gateway qq setup             # 初始化基础配置，并引导授权
pi-gateway qq authorize         # 复用配置补齐白名单，修复 empty_allowlist
pi-gateway qq start --config /path/to/config.json
pi-gateway lark setup --manual
pi-gateway tg setup             # BotFather token、模型、消息识别 owner
pi-gateway tg authorize         # 确认 owner 或添加私聊/群成员（需先停止本账号）
pi-gateway --help
```

- 单选：↑/↓ 移动，Enter 确认。
- 白名单多选：Space 勾选，Enter 提交，再进行一次默认拒绝的授权确认。
- 文本：显示默认值和就地校验，不用填错后从头再来。
- 密钥：单独的 password 组件遮蔽输入，不放入默认值、参数或日志。
- 连接：spinner 显示等待；失败不打印原始 SDK 错误或凭据。
- 取消：Ctrl+C / Esc 不视为确认，不自动选择默认平台，不启动选中的服务。
  连接进行中取消会等待该次启动收尾并关闭返回的资源，避免遗留后台连接。
- 非 TTY：禁止弹交互菜单；使用明确的平台/命令。`--help`、`--version` 和显式 start/check 可用于脚本。

QQ 基础配置保存之后，如果取消身份发现/授权，已保存文件会保留；未确认的身份不会授权。
向导既有的原子写入、0600 凭据文件和账户锁规则不变。
基础配置存在不等于可启动；白名单为空时不显示就绪提示，启动错误会给出 authorize 恢复命令。init 只写模板，不替代 setup。

## 后台运行与诊断

macOS / Linux 上，统一入口的 `start` 默认启动独立后台进程，收到网关就绪回执后返回终端；不是在交互终端里挂一个线程。

```bash
pi-gateway qq start
pi-gateway qq status
pi-gateway qq logs
pi-gateway qq stop
pi-gateway qq restart              # 等旧后台退出，再等待新实例就绪
pi-gateway qq start --foreground  # 前台调试；Ctrl+C 退出
```

Lark 的 start/status/stop/logs 使用相同管理方式；`pi-gateway lark restart` 继续沿用已有的空闲后延迟重启协议，不立即停止当前回复。

QQ restart 仅管理本 CLI 的后台服务：先请求安全停止，最多等待 20 秒；未退出时不会启动第二个实例，也不会删除账号锁。服务已停止时相当于 start，不接管前台或扩展实例；重启可能中断正在生成的 QQ 回复，请在空闲时使用。自定义配置的启动、状态、日志和停止都要沿用同一个 `--config 路径`。
Telegram 使用同一套 start/status/stop/logs；`pi-gateway tg restart` 与聊天 `/restart` 使用空闲延迟协议，不套用 QQ 的立即停止式重启。另有显式 `webhook-register` 和需停机确认的 `backup`。详见 [Telegram 功能与验收边界](TELEGRAM.md)。
旧 `pi-qq-gateway start` / `pi-lark-gateway start` / `pi-tg-gateway start` 仍保持前台行为。

- 仅管理本 CLI 启动的后台服务；不自动接管或停止现有前台、Pi 扩展或 launchd 实例。
- 若已在旧终端运行，请先自行 Ctrl+C 安全停止，再启动后台实例。账号锁不会被自动删除。
- `stop` 通过私有 Unix socket 请求所属服务停止，不按陈旧 PID 杀进程；`status` 可确认是否退出。
- 初次启动失败或超时不会显示已就绪。超时会请求关闭该次启动的进程。
- 日志保存在 `~/.local/share/pi-gateway/services/`，只记录时间与安全事件/错误码，不记录消息正文、模型原始错误或密钥。单文件约 1 MiB 轮转，保留一份历史；`logs` 显示最近 50 行。
- 后台进程可在退出终端后继续运行，但不会自动配置开机启动，也不承诺电脑睡眠期间在线。Windows 请用前台模式或系统服务管理器。
- 异常强杀可能留下 socket 或账号锁；必须核实旧进程已结束再处理，不会静默删除。

## 实现与回归

- `src/cli/program.js`：Commander 子命令树，只生成/执行受支持的分发计划。
- `src/cli/ui.js`：Clack 边界；取消转为可识别错误，密码只经 password 组件。
- `src/qq-gateway/setup.js` / `src/tg-gateway/setup.js`：业务流程注入 ask/progress，不依赖终端实现，可单元测试。Telegram 不会把已保存但尚无 owner 的配置标成完成；Webhook 还需明确注册。
- 飞书手动凭据输入也使用统一 UI；扫码创建协议、二维码及其他运维命令不变。
- 命令入口仍保留旧名称，`pi-gateway -v` 和 `help` 兼容。

测试覆盖带空格的配置路径、未知参数转发、自动化不提示、帮助退出码、空选择、
密码组件隔离、多选确认和连接取消后的资源清理。另使用伪终端人工 smoke 验证
实际方向键选择、Ctrl+C 和密码不出现在输出中；这些测试不连接真实 QQ。
