# 部署与代理故障排查

本文记录 Xget 在代理 GitHub 页面、Git 推送和 GitHub
Actions 部署过程中容易遇到的问题。

## GitHub Web 全量代理

### URL 与行为

- 搜索快捷入口：`/search?q=hermes` 默认跳转到 `/gh/DXShelley/xget`。
- 浏览入口：`/gh/[所有者]/[存储库]`，以及仓库的目录、文件、分支、提交历史和交互页面。
- GitHub 页面中的内部 Web URL 会改写为当前域名下的 `/gh/...`；GitHub
  Assets、Raw、API、codeload 等资源只允许通过固定白名单
  `/_github/proxy/{host}/...` 路径访问。
- 外部站点链接保持原地址，不会被转换为代理请求。
- 登录、Signup、Fork、编辑、Issue/PR 新建、Settings、评论、提交及其他 Web 写操作也通过 Worker 转发，浏览器不会因跨域跳转而丢失会话流程。
- 非 `GET/HEAD` 的 GitHub Web 请求会转发请求体；`Cookie` 和 `Authorization`
  仍按请求头安全策略处理。旧 Git、Git LFS、下载等非浏览器流量仍走原有流程。
- GitHub React 的 `latest-commit`、`tree-commit-info`、`overview-files` 和
  `deferred_metadata` 等动态请求必须保持原始 Fetch 上下文头，并留在 `/gh`
  同源路径，否则页面会停留在 skeleton 或报 `TypeError: Failed to fetch`。

### 快捷词配置

默认快捷词为 `hermes=/DXShelley/xget`。可通过 Worker 环境变量追加或覆盖：

```text
GITHUB_WEB_SHORTCUTS=hermes=/DXShelley/xget,docs=/owner/repository
```

快捷词目标必须是安全的 `/owner/repository`
路径，不能配置任意域名。修改环境变量后应重新验证 `/search?q=关键词` 的
`Location`。

### 上游连通性与资源白名单

生产 Worker 必须能够访问 `github.com`，以及页面实际使用的白名单资源域名，例如
`github.githubassets.com`、`raw.githubusercontent.com`、`api.github.com`、`codeload.github.com`
和 `avatars.githubusercontent.com`。如果本地页面在代理域名下只显示超时或 502：

1. 直接从 Worker 所在网络检查
   `https://github.com/{owner}/{repo}`，不要只检查浏览器是否能直接打开 GitHub。
2. 检查 Cloudflare 出站 DNS、TLS 和防火墙策略，确认没有拦截 GitHub 资源域名。
3. 检查 Worker 日志中的 `Request timeout`、`Upstream request failed`
   和 5xx 重试记录。
4. 不要把任意用户提供的 Host 加入白名单；新增资源域名必须同时加入代码白名单、URL 改写和测试。

### 浏览器 E2E 限制

本次实现的 E2E 记录在
[`test/e2e/github-readonly-web.md`](../test/e2e/github-readonly-web.md)。本地环境第一轮曾成功加载
`DXShelley/xget` 页面并确认页面正文、README、目录、分支、提交链接和 GitHub
Assets 均在本地域名；随后对 GitHub 搜索和重启后的仓库页面请求出现连接超时（Windows
`os error 10060`）。第二轮复测仍复现上游超时，因此无法把当前机器上的完整实时 GitHub 页面链路作为通过依据。路由、重写、动态 Fetch 请求头、Web 写请求体转发、白名单和旧 Git 路由由 Vitest 集成测试覆盖；部署后仍应在实际大陆网络和目标域名上重新执行 E2E。

## GitHub 页面布局混乱或没有样式

### 现象

通过 Xget 访问 GitHub
HTML 页面时，页面内容能够打开，但布局错乱、字体异常，或者看起来像没有加载 CSS 和 JavaScript。

### 根因

GitHub 页面依赖 `github.githubassets.com`
提供 CSS、JavaScript 和字体。旧版本在代理成功响应上统一添加了以下 CSP：

```http
Content-Security-Policy: default-src 'none'; img-src 'self'; script-src 'none'
```

该策略禁止加载 GitHub 的跨域资源，因此浏览器只能显示没有样式的 HTML。这个问题发生在浏览器资源策略阶段，不是 GitHub
HTML 本身损坏。

### 当前行为

- 代理成功响应保留上游的
  `Content-Security-Policy`，不再覆盖 GitHub 等站点的资源策略。
- Xget 自己生成的错误响应仍使用默认安全 CSP。
- 对旧版本缓存中精确匹配 Xget 默认 CSP 的代理响应，会删除该过时策略，避免缓存继续造成页面无样式。

如果仍看到旧页面，先清理浏览器缓存或等待旧边缘缓存过期，再使用硬刷新重新请求。

## GitHub Actions 的 Worker 部署链路

Worker 部署由 `.github/workflows/workers.yml` 负责，自动触发链路是：

```text
main 分支 push
  -> CI workflow
  -> CI completed
  -> Workers workflow
  -> deploy job
  -> wrangler deploy
```

`workers.yml` 的自动部署条件等价于：

```yaml
github.event.workflow_run.conclusion == 'success'
github.event.workflow_run.event == 'push' github.event.workflow_run.head_branch
== 'main' github.event.workflow_run.head_repository.full_name ==
github.repository
```

各条件的含义如下：

- `conclusion == 'success'`：上游 CI 必须最终成功。只要任一必需 Job 失败，部署 Job 就不会执行。
- `event == 'push'`：上游 CI 必须由推送事件触发，Pull
  Request、定时任务或其他事件不会进入自动部署链路。
- `head_branch == 'main'`：推送必须来自 `main` 分支。
- `head_repository.full_name == github.repository`：推送必须来自当前仓库，而不是上游仓库或其他 Fork。

手动 `workflow_dispatch` 不需要满足上述 `workflow_run`
条件，但部署 Job 仍然需要有效的 Cloudflare Secrets。

### `skipped` 与 `failure` 的区别

- `CI` 为 `failure`：CI 的某个 Job 或步骤失败；Worker
  workflow 通常仍会被触发，但 `deploy` Job 因条件不满足显示为 `skipped`。
- `deploy` 为 `skipped`：条件表达式没有通过，`wrangler deploy`
  根本没有执行，不能先归因于 Cloudflare API Token。
- `deploy` 为
  `failure`：条件已经通过，部署步骤实际执行后失败，此时再检查 Wrangler、Cloudflare
  Token、Account ID 或 `wrangler.toml`。

本次排查中，CI 运行记录为
[32117042417](https://github.com/DXShelley/xget/actions/runs/32117042417)，Worker 运行记录为
[32117103925](https://github.com/DXShelley/xget/actions/runs/32117103925)。结果是：`Lint`
和 `Type Check` 成功，`Test and Coverage`
失败；其中测试和覆盖率生成成功，但 Codecov 上传失败。

## Fork 仓库的 GitHub Secrets

Fork 不会自动继承上游仓库的 Actions Secrets。必须在自己的 Fork 仓库中进入：

```text
Settings -> Secrets and variables -> Actions
```

### Cloudflare 部署 Secrets

Worker 工作流从以下 Secrets 读取凭证：

- `CLOUDFLARE_API_TOKEN`：Cloudflare API
  Token，不是任意字符串。建议使用 Cloudflare 的 `Edit Cloudflare Workers`
  模板，至少授予目标 Account 的 `Account -> Workers Scripts -> Edit` 权限。
- `CLOUDFLARE_ACCOUNT_ID`：Cloudflare Account ID，不是 Zone ID。可在 Cloudflare
  Workers 和 Pages 页面或账户信息中查看。

Token 应只保存为 GitHub Actions Secret，不要提交到代码、日志或 `wrangler.toml`。

### Codecov Secret

- `CODECOV_TOKEN`：当前 Codecov 项目的 Upload Token。
- 它不是 GitHub Personal Access Token、Cloudflare API
  Token、README 徽章中的 token，也不能用任意字符串代替。
- 在 Fork 场景下，应在 Fork 对应的 Codecov 项目中确认仓库关联关系，再把该项目要求的 Token 保存到 Fork 的 Actions
  Secrets。

## Codecov 失败导致 Worker 没有部署

CI 配置中 Codecov 步骤使用：

```yaml
fail_ci_if_error: true
```

这表示 Codecov 上传失败时，该步骤返回失败，并将 `Test and Coverage`
Job 以及整个 CI workflow 判定为失败。随后 `github.event.workflow_run.conclusion`
的值不是 `success`，所以 `workers.yml` 中的自动部署条件不成立，`deploy` 显示为
`skipped`。

排查顺序：

1. 先打开 CI 运行记录，确认失败的是哪个 Job。
2. 如果是 `Test and Coverage`，再检查 `Run tests`、`Generate coverage report` 和
   `Upload coverage to Codecov` 的具体结果。
3. 确认 Fork 中存在名为 `CODECOV_TOKEN` 的 Actions
   Secret，并确认其值是当前 Codecov 项目的有效 Token。
4. 修复 Secret 或 Codecov 项目关联后，重新向 `main`
   推送一个代码变更，或根据仓库权限手动重新运行 CI。
5. 只有 CI 最终为 `success`，自动 Worker 部署才会继续。

本次记录能确认失败发生在 Codecov 上传步骤；由于 GitHub
Job 日志下载权限有限，未能从底层日志确认是 Token 缺失、Token 无效还是 Codecov 服务端异常。因此应以 Codecov 步骤的完整日志作为最终判断依据。

如果只是文档变更，CI 的 `paths-ignore` 会忽略 `**.md` 和
`docs/**`，不会触发 CI，也不会触发自动 Worker 部署。这是预期行为；需要验证 Worker 时，应推送会影响源码或部署配置的变更，或在 Actions 页面手动运行工作流。

## Git fetch 与 push 的代理配置

推荐把代理只用于读取，把官方 GitHub 地址用于推送：

```text
origin fetch: https://fast.dxshelley.fun/gh/DXShelley/xget.git
origin push:  https://github.com/DXShelley/xget.git
```

可按以下方式设置当前仓库的两个地址（将所有者和仓库名替换为实际值）：

```bash
git remote set-url origin https://fast.dxshelley.fun/gh/[所有者]/[存储库].git
git remote set-url --push origin https://github.com/[所有者]/[存储库].git
git remote -v
```

检查当前配置：

```bash
git remote -v
git config --show-origin --get-regexp "^url\\..*\\.insteadOf$"
```

如果配置了类似下面的全局 URL 重写：

```text
url.https://fast.dxshelley.fun/gh/.insteadOf=https://github.com/
```

即使命令中明确写入
`https://github.com/DXShelley/xget.git`，Git 也可能在发送请求前将其重写到代理域名，导致推送实际访问代理的
`git-receive-pack`
接口并出现认证失败。此时要删除或调整该全局重写规则，并再次检查 `git remote -v`。

GitHub HTTPS 推送使用 GitHub Personal Access
Token，而不是 GitHub 登录密码。代理适合
`fetch`/`clone`，不应默认承担需要写权限和认证转发的 `push`。

## 提交信息格式

本项目启用了 Conventional Commits 校验。提交信息不能只写普通描述，例如
`test worker deploy` 会被拒绝，因为缺少 `type` 和 `subject`。

可使用：

```bash
git commit -m "docs(deployment): document worker troubleshooting"
```

常用格式为：

```text
type(scope): description
```

常见 `type` 包括 `feat`、`fix`、`docs`、`test`、`refactor`、`perf` 和 `chore`。

## 快速核对清单

- 页面无样式：检查响应 CSP 是否覆盖了上游 CSP，并清理旧缓存。
- Worker `skipped`：先检查 CI 的最终 `conclusion`，不要先检查 Cloudflare Token。
- Worker 真正失败：检查 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` 和
  `wrangler.toml`。
- Fork CI 失败：确认 Fork 自己的 `CODECOV_TOKEN`，不要假设能继承上游 Secret。
- Git 推送认证失败：检查全局 `insteadOf` 重写，确保 push
  URL 是官方 GitHub 地址，并使用 GitHub PAT。
- 提交被 commitlint 拒绝：使用 `type(scope): description` 格式。
