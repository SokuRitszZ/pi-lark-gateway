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

## 实现与回归

- `src/cli/program.js`：Commander 子命令树，只生成/执行受支持的分发计划。
- `src/cli/ui.js`：Clack 边界；取消转为可识别错误，密码只经 password 组件。
- `src/qq-gateway/setup.js`：业务流程注入 ask/progress，不依赖终端实现，可单元测试。
- 飞书手动凭据输入也使用统一 UI；扫码创建协议、二维码及其他运维命令不变。
- 命令入口仍保留旧名称，`pi-gateway -v` 和 `help` 兼容。

测试覆盖带空格的配置路径、未知参数转发、自动化不提示、帮助退出码、空选择、
密码组件隔离、多选确认和连接取消后的资源清理。另使用伪终端人工 smoke 验证
实际方向键选择、Ctrl+C 和密码不出现在输出中；这些测试不连接真实 QQ。
