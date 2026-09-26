# GitHub Actions 自动发布

## 发布链路

推送版本标签 `v<package.version>` → 校验标签/版本/lockfile → Linux/macOS × Node 22.21.0/24 测试矩阵 → 构建源码包与 npm 包 → 校验提交和 SHA → 安装 smoke **同一份 npm tgz** → npm Trusted Publishing → GitHub Release（源码包、npm 包和各自 SHA-256）。

- `.github/workflows/ci.yml`：分支 push、PR、手动测试及 release 的复用测试矩阵。只有只读权限，不发布。
- `.github/workflows/release.yml`：`v*` 标签触发，或 Actions 页面输入**已有标签**手动重试。
- 发布只使用构建 job 上传的同一份 artifact，不在有发布权限的 job 重新打包。
- npm 预发布版本自动使用 `next`；稳定版使用 `latest`。GitHub Release 对应设置 prerelease。
- 默认总开关关闭：仓库变量 `NPM_PUBLISH_ENABLED` 必须为字符串 `true` 才会上传 npm 和创建 GitHub Release。关闭时仍构建/测试，并在日志提示未发布。

## 一次性配置（维护者完成）

### 1. GitHub 仓库与授权

项目使用私有仓库 https://github.com/SokuRitszZ/pi-lark-gateway 。维护者审查代码和权利归属后提交、推送；不要提交应用配置、模型凭据、日志、会话或备份。

许可证暂为 `UNLICENSED`，不等于开源授权。开启公开分发前，权利人需确认许可证/分发权、包名控制权、发布渠道和私密安全联系人。脚本不会替你创建远程仓库、选择开源许可证或推送标签。

保护默认分支、`v*` 标签和 workflow 文件（建议 CODEOWNERS）。仅允许受信任维护者创建发布标签；标签应指向已审查提交，发布后不要移动/重用标签。启用 release 就意味着授权受信任标签触发对外分发。

### 2. npm 首次建立包（仅一次）

包名暂定 `pi-lark-gateway`，还未替维护者确认 registry 名称占用或所有权。npm Trusted Publisher 需要先有这个包；若尚不存在，需先由有权限的账号按“本地备用流程”完成一次 bootstrap 发布，再到 npm 网站配置可信发布者。初次账号登录/2FA 不能由 workflow 文件凭空创建。

bootstrap 后为下一版本创建新标签走自动流程。不要用同一 npm 版本重发含不同 repository 元数据的 CI 包。若改变为 scoped 包名，须同步 package、lockfile、校验脚本和文档，再重跑验证。

### 3. 配置 npm Trusted Publisher（OIDC）

npm 包设置 → Trusted Publisher → GitHub Actions，填写：

- Organization/User：`SokuRitszZ`。
- Repository：`pi-lark-gateway`。
- Workflow filename：**`release.yml`**（不是完整路径，也不是 `ci.yml`）。
- Environment：**`npm-publish`**，与 workflow job 完全一致。
- 如果 npm 界面区分发布方式，确保允许直接 `npm publish`，不是仅 staged publishing。

在 GitHub 创建同名 environment `npm-publish`，限制可部署标签 `v*`；需要人工放行可加 required reviewers，不需要每次审批则不配置 reviewers。只授予 npm 发布 job `id-token: write`，不配置长期 `NPM_TOKEN` / `NODE_AUTH_TOKEN`。失败时不会自动降级使用 token。

流水线固定使用 GitHub-hosted Ubuntu、Node 24.21.0 和 npm 11.12.1（高于 Trusted Publishing 的 npm 11.5.1 要求）。npm 包在 CI 构建时从 `GITHUB_REPOSITORY` 写入真实 repository 元数据；公开 GitHub 仓库满足条件时，npm 自动生成 provenance。私有仓库/提供方限制以 npm 官方规则为准，不把 checksum 当数字签名。

最后在 GitHub Settings → Secrets and variables → Actions → **Variables** 添加 `NPM_PUBLISH_ENABLED=true`。先配好 trusted publisher、environment、标签保护，再开总开关。

官方参考：[npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)、[provenance](https://docs.npmjs.com/generating-provenance-statements/)。

## 日常发版：提交版本，再推标签

```bash
npm version 1.0.0-rc.2 --no-git-tag-version
# 更新 CHANGELOG.md，审查并提交全部版本改动
# 将对应提交推送到已配置的远程仓库

git tag -a v1.0.0-rc.2 -m "Release 1.0.0-rc.2"
git push origin v1.0.0-rc.2
```

正式 GA 使用例如 `1.0.0` / `v1.0.0`。版本必须与 package.json、package-lock.json 一致；标签解析出的 commit 必须与 checkout 的 HEAD 一致，工作区必须干净。错误标签不会发布。

到 Actions → Release 看流水线；如果 environment 有审批规则，完成审批后才进入发布。无需再手动执行 npm publish 或上传 GitHub Release 附件。

CI 做：单元测试、语法/CLI 检查、依赖审计、干净 HOME 安装和 npm 安装验证。真实模型/飞书 E2E 不在无凭据 CI 内；既有国内飞书 E2E 已由维护者确认，目标部署仍要做 owner 最小回复验收。

## 失败与重试

- **测试/构建失败**：修复后发布新候选版本；不要覆盖已发布版本或悄悄移动已公开标签。
- **OIDC 失败**：检查 npm 侧 owner/repo/workflow/environment 与 GitHub 配置。不会打印 token 或自动改用长期 token。
- **npm 上传中断**：优先在原 Actions run 使用 **Re-run failed jobs**，保留原构建 artifact。脚本查询相同版本的 `dist.integrity`；只有与本地 tgz 的 SHA-512 完全相同才跳过上传继续。不同内容立即失败，绝不覆盖。已发布版本重试不会把 next/latest 重新指向旧版本。
- **registry 查询失败**：只有明确 E404 当成尚未发布；认证错误、网络错误或未知返回都中止，不盲目上传。
- **GitHub Release 失败**：npm 可能已经发布，两个平台没有跨平台原子事务。Release 先建 draft，全部附件就绪才公开；重试只补缺失文件，同名文件摘要必须完全相同，不 clobber。
- Actions 的已有标签手动触发会重新执行整条链路。重新构建与原产物字节不同时，完整性校验会拒绝继续；优先复用原 run/artifact。artifact 保留 30 天，不自动删除 npm 版本或改 dist-tag。
- 未启用 `NPM_PUBLISH_ENABLED` 时发布 job 会跳过；绿色测试不表示已经上架。

完成后核对 npm 版本/标签、GitHub Release 与附件 SHA，并在目标机器安装**精确版本**做验收。部署、停机备份、回滚见 [OPERATIONS.md](OPERATIONS.md)；该 workflow 只发布产物，**不会自动重启你的网关主机**。

## 本地验证 / 备用流程

```bash
npm ci --ignore-scripts
npm run release:check
npm run smoke:clean
npm run smoke:npm
# 本地无提交候选：不上传
npm run release:npm -- --allow-unversioned --dry-run --output /新的临时目录
npm run release:pack -- --allow-unversioned --output /另一个新的临时目录
```

本地候选源码文件名含 `-unversioned`；npm 包内 `sourceCommit: null`，不可作为正式 CI 发布产物。源码 tar.gz 包含 lockfile；npm tgz 只含运行时、CLI、运维资料及由 lockfile 生成的 shrinkwrap，不包含发布脚本/用户配置/凭据/node_modules。

首次 bootstrap 或受控备用发布：发布者在自己的终端 `npm login --registry=https://registry.npmjs.org/`，确认包名权利和许可，准备干净的已提交源码及匹配 `v<版本>` 标签后：

```bash
npm run release:npm -- --publish --confirm-publication --output /新的发布目录
```

不要把 token/OTP 发到聊天或提交仓库。不从工作区执行裸 `npm publish`；prepublishOnly 会拒绝，受控流程发布无生命周期脚本的 tgz。手动发布是备用，不会替代 CI 的多平台验证。

## 产物与放行边界

- 同一源码 commit 和版本绑定构建、安装测试、npm 上传和 GitHub Release；已提交代码不等于已获分发许可。
- 源码包采用 allowlist，拒绝 symlink、常见凭据/会话文件；仍需人工 secret review。
- 源码 manifest 含逐文件 SHA-256、版本和 commit；npm 包含 sourceCommit/tag 元数据；两种包均有独立 SHA-256 文件。不保证源码压缩包跨重建字节完全一致。
- 本地已通过的测试不等于 GitHub-hosted 流水线已执行。没有远程仓库/Trusted Publisher 配置时，无法声称云端发布成功。
