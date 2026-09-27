# Release 分支自动发布

## 版本规则与触发方式

| GitHub 事件 | 构建/发布版本 | npm channel |
|---|---|---|
| 首次推送 `release/1.2.3` | `1.2.3-beta.<run_number>` | `beta` |
| 该分支后续每次 push | 新的 beta 版本（新的流水线序号） | `beta` |
| 同仓库 `release/1.2.3` 的 PR 合入 `main` | `1.2.3` | `latest` |

例如一次执行是 `1.2.3-beta.42`，下一次更新是 `1.2.3-beta.43`。数字采用工作流自增运行序号，不按分支从 1 重置，失败的运行可能留下空号。版本来自严格的 `release/x.y.z` 分支名，无需手动修改 package 版本，也无需先打 tag。

**CI 通过原生 `npm version` 在隔离的 manifest 副本上同步版本，再用于构建副本中的 `package.json`、`package-lock.json` 及 npm shrinkwrap；不向 release/main 分支回写版本提交。** 调用禁用 Git 提交/标签和 lifecycle scripts，启用 offline 与 allow-same-version，避免重试时因版本相同失败。 仓库文件里的版本因此可能仍是原开发版本；实际发布版本以产物元数据为准。源码包与 npm 包都带正确的发布版本，并记录真实源 commit 与原始 sourceVersion，不伪造版本提交，不修改依赖解析。

- 本地 `git switch -c` 本身不触发，须将分支推送到 GitHub。仅创建空的远程引用而没有 push 事件时，推送一次提交来触发。
- 分支名只接受三段非负整数，如 `release/1.2.3`；拒绝 `release/01.2.3`、`release/1.2`、`release/1.2.3-beta`。
- 正式版只由**同仓库 release 分支的 PR 合入 main**触发，使用合并后的 commit（支持 merge/squash/rebase），不是 PR 原 head。
- 关闭但未合并、fork PR、普通 feature PR、其他目标分支、直接 push main 均不发布正式包。直接 git merge 后 push main 不替代 PR 合并流程。
- `v<发布版本>` 标签和 GitHub Release 由发布 job 自动创建，指向真实源 commit；打 tag 不再触发这条流程。
- 已发布的基础版本不要重用；发布正式版后，后续补丁新建 `release/1.2.4`，不要再次合并 release/1.2.3 来覆盖 1.2.3。

## 流水线

`.github/workflows/release.yml`：release 分支 push / release PR merged → 校验 GitHub 事件及源 commit → 复用 Linux/macOS × Node 22.21.0/24 测试矩阵 → 按分支版本构建源码包与 npm 包 → 校验版本/commit/SHA → 安装 smoke **同一份 npm tgz** → npm OIDC 发布 → GitHub Release。

四个阶段直接复用 `SokuRitszZ/npm-release-action@5c5679ea86d68f72df2e82f1e1c1275dd9c3c09d`，分别调用 `plan`、`build`、`publish-npm`、`publish-github`。固定 SHA 包含单数字 beta 及原生 npm version，不使用尚未更新的 `v1` 标签。

各阶段参数一致：包目录 `.`、分支前缀 `release/`、主分支 `main`、预发布标识/channel `beta`、正式 channel `latest`、Git 标签前缀 `v`、registry `https://registry.npmjs.org/`、access `public`、shrinkwrap/source-archive 均为 `true`。只有通过发布开关的上传阶段使用 `dry-run: false`。

构建后使用 Action 的 `npm-file` 输出进行网关安装 smoke，整个 `artifact-directory` 上传；发布阶段下载到 `$RUNNER_TEMP/npm-release`，不重建。附件为 npm `.tgz`、`*-source.tar.gz`、`SHA256SUMS` 和 `bundle.json`，源码包顶层目录为 `source/`；版本、源 commit 和 sourceVersion 在 bundle 元数据中。源码归档包含全部 tracked 文件，新增敏感文件前必须审查；不要提交本地配置。通用 Action 保留 package scripts，但 pack/publish 均禁用 hooks；npm 安装用户应使用 CLI，不运行源码发布命令。

`.github/workflows/ci.yml` 仍负责普通分支 push/PR/手动验证，只有只读权限，不发布。版本规划、正式打包和发布实现只在共享 Action 中维护，本仓库不保留第二套发布脚本。`smoke-fixture.js` 仅准备临时安装测试副本，不负责版本、标签、校验和或上传；发布流水线的 smoke 始终直接安装 Action 产出的同一份 tgz。

不同 push 使用不同并发组，不会因“只保留一个 pending run”而丢掉中间更新。GitHub runner 资源不足时排队；失败的更新不会发布。并发构建可能完成顺序不同，`beta` channel 指向最后成功上传的版本，不保证是最后一次 push；验收应安装明确的完整 beta 版本号。不同正式版本请按顺序合并、验收，避免同时竞争 latest。

发布 job 下载已经测试过的 artifact，不重新打包、不安装项目依赖。总开关 `NPM_PUBLISH_ENABLED` 默认为关闭，只有设置为字符串 `true` 才会上传 npm 和创建 GitHub Release；否则只测试/构建并提示未发布。该流水线不会部署或重启宿主网关。

## 一次性配置

### GitHub 与发布授权

仓库：https://github.com/SokuRitszZ/pi-lark-gateway （公开）。先将本流程代码合入 main，再从包含新 workflow 的提交创建 release 分支。

许可证暂为 `UNLICENSED`，不等于开源授权；开启公开分发前须由权利人确认许可/分发权、npm 包名控制权和安全联系人。不要提交配置、模型凭据、会话、备份或日志。

保护 main、release 分支和 workflow 文件；只有受信任维护者可更新 release 分支。开启发布后，推送 release 分支或合并对应 PR 即代表授权对外发包。若保护 `v*` 标签，请允许发布 workflow 创建对应标签，否则 npm 发布后 GitHub Release 可能被规则拒绝。

### npm 初次建立包

包名暂定 `pi-lark-gateway`；包名占用/所有权尚需维护者确认。npm Trusted Publisher 需要已存在的包；若尚不存在，由有权限的账号先完成一次传统认证的 bootstrap 发布，再配置可信发布者。之后自动使用分支驱动流程；不能重发同一版本。

若改用 scoped 包名，须同步 package、lockfile、校验脚本与文档再验证。不要把 npm token/OTP 发到聊天或提交仓库。

### npm Trusted Publisher（OIDC）

在 npm 包设置 → Trusted Publisher → GitHub Actions 中填写：

- Organization/User：`SokuRitszZ`
- Repository：`pi-lark-gateway`
- Workflow filename：`release.yml`（不是完整路径，也不是 ci.yml）
- Environment：`npm-publish`
- 如界面区分方式，允许直接 `npm publish`，不是仅 staged publishing。

GitHub 创建 `npm-publish` environment，允许 **release/* 分支和 main 分支**部署，不能继续使用旧的“只允许 v* 标签”规则。需要逐次审批可配 required reviewers；希望全自动则不配 reviewers，并用分支保护控制推送/合并权限。

只给 npm job `id-token: write`，不要加长期 `NPM_TOKEN` / `NODE_AUTH_TOKEN`；OIDC 失败不会自动降级为 token。只给最终 GitHub Release job `contents: write`；无需给构建 job 推送版本提交的权限。

使用 GitHub-hosted runner、Node 24.21.0 和 npm 11.12.1。package.json 已配置网关真实 repository 元数据，共享 Action 原样保留；npm Trusted Publisher 仍绑定网关仓库的 `release.yml` / `npm-publish`，而不是 Action 仓库。符合 npm 条件时自动生成 provenance。

最后设置 GitHub Actions **仓库变量** `NPM_PUBLISH_ENABLED=true`。实际授权、首次建包和环境配置不是 workflow 文件能自动凭空完成的。

参考：[npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)、[GitHub merged PR events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#running-your-pull_request-workflow-when-a-pull-request-merges)。

## 日常发版

```bash
# 从已审查代码创建版本分支；无需 npm version，也无需打 tag
git switch -c release/1.2.3
git push -u origin release/1.2.3
# 自动构建并发布第一个 1.2.3-beta.*

# 后续提交、push，每次成功流水线发布一个新 beta
# 验收完成后，在 GitHub 创建 release/1.2.3 -> main 的 PR 并合并
# 自动发布 1.2.3 到 latest，创建对应 GitHub Release
```

安装候选包：`npm install -g pi-lark-gateway@beta --ignore-scripts`，更推荐使用流水线给出的完整 beta 版本号。正式版用 `@latest` 或固定版本。不使用 `@next` 作为分支发布 channel。

## 重试与失败

- beta 的 **Re-run all jobs** 和 **Re-run failed jobs** 均沿用同一运行的版本号，例如 `1.2.3-beta.42`；新 push 触发的新运行才产生新编号。
- 优先 **Re-run failed jobs**，复用 prepare 原有输出与 artifact；版本覆盖只接受当前运行对应的完整版本号，拒绝其他分支/运行序号及旧的双数字格式。全量重建源码包可能改变字节，已有附件校验不一致时会拒绝覆盖。
- 正式版重试仍为同一 `x.y.z`，不自动递增 patch。registry 已有版本时，只在 SHA-512 与本地 tgz 完全相同时跳过上传，否则失败；绝不覆盖，也不会在重试时把 channel 指回旧版本。
- 只有明确 registry E404 当成未发布；认证/网络/未知错误都中止，不盲目上传。
- GitHub Release 先 draft，附件全部就绪才公开；重试只补缺失附件，已有同名文件必须完全一致，不 clobber。自动创建的标签若已指向其他 commit，发布验证会失败。
- npm 和 GitHub 没有跨平台原子事务。npm 成功而 GitHub 失败时，优先在原 run 重跑失败 job、保留原 artifact；源码压缩包重新构建可能字节不同。artifact 保留 30 天。
- 配置开关未开启时，绿色测试/构建不代表 npm 已上架。

真实模型/飞书 E2E 不在无凭据 CI 中，目标部署仍做 owner 最小回复验收；部署、备份和回滚见 [OPERATIONS.md](OPERATIONS.md)。

## 本地验证 / 首次 bootstrap

```bash
npm ci --ignore-scripts
npm run release:check
npm run smoke:clean
npm run smoke:npm
# 验证共享 Action 已构建的真实产物，不重新打包
npm run smoke:npm -- --artifact /路径/package.tgz --expected-version 1.2.3-beta.42
```

无 `--artifact` 时，`smoke:npm` 仅在临时目录用原生 `npm pack --ignore-scripts` 准备测试包，包含 lockfile 生成的 shrinkwrap、保留 scripts；测试结束自动清理，不生成正式发布元数据、不上传。`smoke:clean` 保留干净 HOME 安装与启动验证。两者不修改源码 manifest，也不读取宿主认证配置。

已移除本地 `release:pack` / `release:npm` 入口；直接在源码执行 `npm publish` 仍被保护钩子拒绝。首次 bootstrap 若需传统认证，由维护者在自己的终端完成 npm 登录并审核许可、包名权利和版本，使用共享 Action 构建、校验且通过 exact-artifact smoke 的 tgz，按 npm 官方流程显式上传；不要使用本地 smoke 测试包或把 token/OTP 放入聊天。之后配置 Trusted Publisher，日常发布只走上述分支工作流。

源码 tar.gz 包含同步后的 package/lockfile 与 sourceCommit/sourceVersion 元数据；npm tgz 带同版本 package/shrinkwrap、CLI 和运维资料，不含发布工具、配置、凭据或 node_modules。发布前仍应人工检查源码中的秘密。
