# 部署、观察、备份与回滚

## 约束

一个 App ID 只能运行一个网关实例；当前没有跨进程锁或共享限流。部署模板不自动安装，不自动重启现有服务。首次使用请先完成 [安装](INSTALL.md)。

使用固定的 Node 可执行路径和版本目录；通过 `command -v node` 获取路径，不要假设 systemd/launchd 会加载 nvm 的 shell 配置。推荐版本目录 + `current` 符号链接，例如 `~/.local/opt/pi-lark-gateway/current`。升级 Node 后需检查服务中的绝对路径。

npm 安装时，`@APP_DIR@` 使用 `npm root -g` 下的 `pi-lark-gateway` 绝对路径，模板可从该目录的 `deploy/` 复制；`@NODE@` 仍须与该安装使用的 Node 匹配。日常命令改用 `pi-lark-gateway doctor/setup/start/backup`，无需进入全局包目录。切换 nvm Node 版本可能改变全局包路径，必须同步服务配置。

## Linux：systemd 用户服务

1. 复制 `deploy/pi-lark-gateway.service` 至 `~/.config/systemd/user/`，将 `@NODE@` 替换为 Node 的绝对路径，将 `@APP_DIR@` 替换为部署目录或 current 链接的绝对路径（不是 shell 的 `~`）。
2. 可选：复制 `deploy/service.env.example` 为 `~/.config/pi-lark-gateway/service.env`，按本机实际代理/配置路径编辑并 `chmod 600`。不要提交填好的文件。
3. 确认旧实例已停止，再操作：

```bash
systemctl --user daemon-reload
systemctl --user enable --now pi-lark-gateway
systemctl --user status pi-lark-gateway
journalctl --user -u pi-lark-gateway -n 100 --no-pager
# 停用/维护：先等当前任务结束
systemctl --user stop pi-lark-gateway
```

注销后常驻需由主机管理员批准启用 linger：`loginctl enable-linger <服务用户>`。用户服务不要使用 `sudo npm start`。Linux 模板须在目标 Linux 主机验收；macOS 本地测试不代表 systemd 已安装或运行。

日志使用 journal，不另建无限增长文件。让主机管理员设置合适的 journald 保留策略，例如 `SystemMaxUse=500M`、`MaxRetentionSec=7day`；这些设置可能影响其他服务，勿盲目覆盖主机策略。

## macOS：LaunchAgent

1. 复制 `deploy/dev.pi.lark-gateway.plist` 至 `~/Library/LaunchAgents/`，替换 `@NODE@`、`@APP_DIR@`、`@HOME@` 为绝对路径。路径含 `&` 等 XML 特殊字符时需转义。
2. 创建 `~/Library/Logs/pi-lark-gateway`，目录权限 700，plist 权限 600。用 `plutil -lint` 校验文件。模型建议用同一用户的 Pi 私有凭据存储；launchd 不继承终端中的 API key/代理变量。若必须用环境变量，仅在本机权限 600 的 plist 中配置，切勿共享。
3. 停止其他实例后：

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.pi.lark-gateway.plist
launchctl print gui/$(id -u)/dev.pi.lark-gateway
# 停用/维护：会中断未完成请求
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/dev.pi.lark-gateway.plist
```

模板通过 `PI_LARK_KEEP_AWAKE=ac` 接电时防止自动睡眠；允许屏幕熄灭，不保证电池、合盖、手动睡眠或注销时可用。真正全天候部署用不休眠服务器。代理地址不预设；代理本身也需要持续运行。

文件日志需轮转：可用已安装的 logrotate，复制 `deploy/logrotate.conf` 到私有运维目录并替换 `@HOME@`，使用用户 cron/LaunchAgent **每小时**执行 `logrotate --state <私有状态文件> <配置文件>`，首次加 `--debug` 检查。示例保留 7 份、10 MiB 触发轮转。`copytruncate` 在极短复制窗口内可能丢日志，不用于审计级保证；模板不会自动装 logrotate 或定时器。

## 观察与故障排查

- `npm run doctor`：本地运行时、依赖、配置、owner 与文件权限；不联网，不表示在线健康。
- 查看进程管理器运行状态和启动后的 `websocket_<state>` 状态日志。`gateway_started_configured_access` 单独出现不等于长连接已可用。
- 首次部署/升级后由 owner 发送一条非敏感测试消息并检查回复；不要用高频真实模型调用当健康探针。
- `startup_failed_check_configuration_and_network`：先 doctor，检查配置路径/文件权限、Node 路径，再核对网络和模型配置。
- `model_failed`/`message_failed`：在同一个 OS 用户下通过 Pi 确认登录、模型与额度；勿把原始 SDK 错误或凭据贴进群聊。
- `lark_error`/持续断连：核对代理、App Secret、应用发布和长连接权限。按钮无效另查 `card.action.trigger` 回调订阅。
- `session_archive_failed_retained`：原始记录保留，聊天继续。检查磁盘空间/权限/模型可用性；超过 32 MiB 的历史不自动删。恢复聊天后旧清理计划作废，重新达到空闲期才再次归档。
- 无回复也可能是未 @、白名单未审批、denyTextPatterns、会话被禁用/拉黑，不能一律判为进程故障。

## 备份

**先等任务结束并停止服务，再执行。** `--service-stopped` 是操作者确认，不会替你停服务，也不是自动锁检测。

```bash
npm run backup -- --service-stopped --output /私有目录/gateway-backup-唯一时间.tar.gz
# 自定义配置可另加 --config /绝对路径/config.json
```

包含当前应用配置、独立 App Secret、逐群策略和该应用全部状态（审批、话题映射、会话、归档）；配置内凭据引用规范化为 `credentials.json`。不覆盖已有备份，生成 SHA-256，权限 600，拒绝符号链接/特殊状态文件以免意外备份其他路径。包含明文敏感信息，转移到异机前请使用组织批准的加密存储。

**不包含 `~/.pi/agent` 模型授权/扩展。** 该目录需独立安全备份，或恢复后重新 `/login`。不包含 service/plist 与代码，另行记录所用版本。建议升级前备份；定期停机窗口内备份，保留至少一个已验证的离线版本。无人值守在线一致性快照不在当前实现范围。

## 恢复演练（先到新目录，勿直接覆盖线上）

1. 验证备份 SHA，检查来源可信。在权限 700 的新空目录解压：`tar -xzf <备份> -C <新空目录>`。
2. 应包含 `backup/manifest.json`、`backup/config/` 和可选 `backup/state/<App ID>/`。检查 manifest 的 App ID，勿跨机器人恢复。
3. 对暂存配置执行 `npm run doctor -- --config <新空目录>/backup/config/config.json`。此检查不会启动消费者。
4. 确认停机和恢复目标后，先将旧配置、旧应用状态分别改名保留（不要删除）；把暂存 config 目录放到预期配置路径，将 state 中该应用目录放回 `~/.local/share/pi-lark-gateway/<App ID>/`。不要与旧 state 混合，也不要覆盖其他应用。自定义配置需同步 `PI_LARK_CONFIG`。
5. 检查目录 700、私有文件 600；恢复模型授权或重新登录。启动一个实例并做 owner 回复、审批状态及会话恢复验证。失败时停机，将保留的旧目录移回。

操作会替换状态，必须由操作者确认后执行；本项目不提供静默覆盖线上数据的 restore 命令。归档成功后已删除的逐条历史只能从更早备份恢复，摘要本身不能还原。

## 升级 / 回滚

### npm 安装

先记录 `pi-lark-gateway --version` 和服务路径。等待任务结束、停止服务，用 `pi-lark-gateway backup --service-stopped --output <私有备份路径>` 备份；再执行 `npm install -g pi-lark-gateway@<新版本> --ignore-scripts`。不要在进程运行时原地覆盖全局包。运行 doctor、启动单实例并 smoke 验证。回滚同样先停服务，再安装原来的精确版本，必要时恢复配套状态；不要仅依赖 mutable 的 `latest` 标签。

npm 安装不会修改用户配置/状态目录，但新版启动后的迁移或归档可能改变数据，故备份仍必需。npm 运行时包没有 `npm run verify`，测试/构建由发布前源码 CI 完成。

### 源码安装

1. 校验新包，解压到**新的版本目录**；在那里 `npm ci --ignore-scripts && npm run verify`。
2. 在停机前先阅读 CHANGELOG 和安全/迁移说明；等待活跃任务完成，停止服务，执行上面的备份。
3. 将 `current` 指向新目录（确认旧链接而不是普通目录），或修改服务中的版本路径；重新加载服务配置并启动单实例。
4. 执行 doctor、查看连接状态、完成 owner smoke 验证。未验收前保留旧版本与备份。
5. 回滚先停服务，改回旧版本链接/路径。若新版本修改了状态格式或归档删除了历史，按已验证备份恢复**配套配置和状态**再启动，不能只降级二进制。

没有跨版本自动回滚，也不自动回退第三方模型/扩展。当前 v1 配置首次启动会迁移，旧版本回滚须使用升级前的配置备份。
