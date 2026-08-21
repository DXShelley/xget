# 站点镜像路由

## 域名边界

| 镜像域名 / URL                        | 上游             | 适配器                |
| ------------------------------------- | ---------------- | --------------------- |
| `git.dxshelley.fun`                   | `github.com`     | `GitHubAdapter`       |
| `fast.dxshelley.fun`                  | 平台目录与入口页 | `XgetPlatformAdapter` |
| `fast.dxshelley.fun/_/<alias>/<path>` | 固定已登记站点   | `ConfiguredAdapter`   |
| `<alias>.fast.dxshelley.fun/<path>`   | 固定已登记站点   | 站点专属适配器        |

站点由请求 `Host` 唯一确定。`git.dxshelley.fun`
的根路径与 GitHub 根路径一一对应，例如 `/Homebrew/brew`、ZIP 下载和
`owner/repo.git/info/refs` 都直接转发至 `github.com` 的同一路径。旧 GitHub Web
`/gh/*` 路径不再支持。

`fast.dxshelley.fun` 保留 Xget 的平台前缀路由，例如 `/npm/*`、`/pypi/*`、
`/cr/*` 和 `/ip/*`，并提供已登记站点的统一入口。用户可在入口页粘贴普通 HTTPS
URL；Worker 会校验其 Origin 后跳转至规范 URL。`?target=`
仅是兼容入口，用户无需手工 URL 编码。已登记的专属 `WebAdapter`
目标会直接跳转到其固定镜像 Host；它们不会回退为通用配置站点代理。

## 路由分派架构

Worker 主处理器只负责 CORS、错误兜底、平台缓存管线和最终安全响应包装。固定 Host 的浏览器路由按以下顺序分派：

1. `WebAdapter`：仅处理已登记的认证型站点及其精确资源 Origin。
2. `GitHubAdapter`：处理 `git.dxshelley.fun` 的 GitHub Web 与协议流量。
3. `ConfiguredAdapter`：处理固定 Host 的匿名公开站点。
4. `FastRoute`：处理 `fast.dxshelley.fun` 入口、`?target=`、`/_/<alias>/...` 和
   `<alias>.fast.dxshelley.fun` 隔离 Host。
5. `XgetPlatformAdapter`：处理剩余的包管理、镜像与协议平台路由。

`FastRoute` 位于
[`src/proxy/fast-route.js`](../src/proxy/fast-route.js)，不再把入口解析、白名单跳转和隔离 Host 路由混在主处理器中。`src/config/platforms.js`
和 `test/helpers/test-utils.js`
是已删除的兼容转发层；新代码必须直接从平台目录、平台索引、路径转换器或模块化测试辅助文件导入。

### 平台特殊处理与过滤器边界

`XgetPlatformAdapter`
的通用流程只识别平台前缀、构造固定上游 URL、执行缓存/回源并包装响应；它不包含任何具名平台的路径或正文判断。

- [`src/platforms/path-transformers.js`](../src/platforms/path-transformers.js)
  负责路径层例外。目前仅包含 Crates.io 的 `/api/v1/crates` 归一化和 Jenkins
  Update Center 的 `/current` 归一化。
- [`src/platforms/response-filters.js`](../src/platforms/response-filters.js)
  负责成功文本响应的安全改写和缓存隔离策略：NPM 元数据、PyPI
  HTML，以及 Flathub 的 `.flatpakrepo` / `.flatpakref`
  文件。PyPI 改写结果不进入共享缓存；Flathub 描述文件的缓存键按镜像 Origin 隔离。
- [`src/protocols/`](../src/protocols) 负责 Git、Git LFS、Docker、Hugging
  Face 和 AI
  API 的协议语义，例如请求头、认证挑战和 Docker 重定向；协议规则不作为普通平台过滤器执行。
- [`src/filters/run-filters.js`](../src/filters/run-filters.js)
  只提供按注册顺序运行异步过滤器的通用机制。`ConfiguredAdapter`
  在自身代理边界注册 request/response filter，专属 `WebAdapter`
  在自己的适配器内处理凭证、CSP 和资源 Origin；过滤器不会跨越站点或放宽 Origin 白名单。

旧的 `src/routing/platform-transformers.js`、`src/utils/rewrite.js` 和
`src/proxy/filter-chain.js` 已删除，避免继续从通用层引入平台或适配器特例。

入口页使用原生 `GET` 表单提交。用户粘贴的普通 URL（包括带有 `&`
的 query）会由浏览器编码为
`target`，Worker 解码后保留其完整路径和 query。例如输入：

```text
https://code.claude.com/docs/zh-CN/quickstart?locale=zh-CN&source=fast
```

会跳转至：

```text
https://claude-code.fast.dxshelley.fun/docs/zh-CN/quickstart?locale=zh-CN&source=fast
```

规范路径代理形式为 `/_/<alias>/<path>`。例如：

```text
https://fast.dxshelley.fun/_/claude-code/docs/zh-CN/quickstart
```

已登记站点默认代理其上游 Origin 下的全部路径和 query，而非只允许某几个文档目录。未知 alias、非 HTTPS、带用户名密码的 URL，以及未登记 Origin 均被拒绝，不能作为通用开放代理使用。

入口页列出已登记站点的快捷访问。提交成功时，最近八条已登记目标 URL 与域名频次仅保存在当前浏览器的
`localStorage`；这些记录不发送到 Worker、不写入日志，也可在入口页立即清除。快捷入口和本机历史都必须再次通过同一份 Origin 白名单校验。

完整 Web 应用使用隔离 Origin：

```text
https://claude-code.fast.dxshelley.fun/docs/zh-CN/quickstart
```

这样可以隔离 Cookie、`localStorage`、IndexedDB、Cache Storage 与 Service
Worker。该模式需要 Cloudflare 配置 `*.fast.dxshelley.fun` 的通配 DNS 和 Worker
route；仅有 `fast.dxshelley.fun` 的 DNS 记录时，隔离 Host 无法解析。

## GitHub 资源域

GitHub 页面引用的资源通过 `git.dxshelley.fun/_github/proxy/<host>/<path>`
回源。`<host>`
必须在 GitHub 适配器的固定白名单中；未知 host 被拒绝，不能作为通用开放代理使用。

GitHub 页面、JSON、重定向、CSS/JS
URL 和 WebSocket 地址会被结构化改写到镜像根路径或该资源命名空间。Git Smart
HTTP、LFS、上传和所有允许方法的请求体原样传递。

## 凭证、缓存与风控

- `Authorization` 仅转发至该适配器的主上游 Origin；静态资源 Origin 一律移除该头。CSRF、`Origin`、`Referer`、Turbo、PJAX 与 React 请求头按固定上游语义映射。
- 镜像 Cookie 按上游 Host 作用域回放；上游 `Set-Cookie`
  回写为镜像可用 Cookie，禁止跨站点混发。
- 认证、写操作、上传、OAuth 与令牌请求使用 `no-store`，且不重试非幂等 body。
- 上游 `429`、非挑战 `403`
  与访问控制原样保留；代理不规避上游风控或访问限制。对于无状态的
  `GET`/`HEAD`，若上游以 `403` 和 `Cf-Mitigated: challenge`
  明确要求浏览器验证，镜像会重定向至同一固定上游 URL，由用户浏览器直接完成访问，不会转发或伪造挑战。
- 审计信息必须脱敏，不能记录 Cookie、Authorization、token 或请求体。

## 新增简单站点

在 [`config/sites.json`](../config/sites.json) 添加固定 `alias`、固定上游
`upstreamOrigin` 与站点模式即可创建
`ConfiguredAdapter`。配置不是用户可控 URL 转发：未登记的 Origin、alias 和隔离 Host 永远不会被代理。若站点需要复杂认证、协议、内容重写或资源域策略，应新增专属适配器与 Filter，而不是放宽通用代理。

每个上游 Origin 必须独立注册。例如 `claude.com` 和 `code.claude.com`
分别对应独立 alias。需要执行第三方脚本、登录、OAuth 或 WebSocket 的站点必须使用隔离 Host，并通过专属适配器处理 CSP、重定向、Cookie 与资源域。

### 配置站点安全默认值

`ConfiguredAdapter` 仅适合公共浏览。它在请求前执行 `allowedMethods` 和
`proxyPolicy.paths`，默认对 `GET`/`HEAD` 以最多一次重试处理短暂的
`408`、`429`、`5xx` 故障，并使用受限超时；`POST` 不重试。配置站点响应统一为
`Cache-Control: private, no-store`，避免跨用户缓存。

默认不向上游转发浏览器的 `Cookie`、`Authorization` 或
`Proxy-Authorization`。同一固定上游 Origin 的 `Location`
会改回当前镜像 Origin，外部跳转保持原样。对于 HTML、JSON、CSS、JavaScript 和 Web
Manifest，固定上游 Origin 的绝对 URL 与 CSP 同源来源会改为当前镜像 Origin；第三方域名不改写。上游
`Set-Cookie` 会被移除，不会在镜像 Host 创建会话 Cookie。

配置站点不支持 WebSocket。带有 `Upgrade: websocket` 的请求在回源前以 `426`
拒绝，且所有 hop-by-hop 请求头都会被移除；不能仅通过把
`browserCapabilities.webSocket` 改为 `true` 启用该能力。

此机制不等价于完整应用镜像：上游 Cookie 重写、OAuth 回调、WebSocket、Service
Worker、复杂 CSP、动态模块加载和第三方资源域都必须通过该站点的专属适配器逐项实现和测试后，才可以在
`browserCapabilities` 中启用。

新增站点时应显式填写以下能力边界：

```json
{
  "proxyPolicy": { "paths": "all", "timeoutSeconds": 20, "maxRetries": 1 },
  "browserCapabilities": {
    "forwardCredentials": false,
    "oauth": false,
    "rewriteSameOriginRedirects": true,
    "serviceWorker": false,
    "webSocket": false
  }
}
```

### 已登记的公开 Google 页面

以下站点使用 `ConfiguredAdapter`，只代理匿名公开页面，固定为
`GET`/`HEAD`，不转发浏览器凭证：

| Alias                | 上游 Origin                     | 范围                                                                 |
| -------------------- | ------------------------------- | -------------------------------------------------------------------- |
| `google-dev-docs`    | `https://developers.google.com` | `google.dev` 跳转后的 Google Developers 公开文档                     |
| `ai-google-dev-docs` | `https://ai.google.dev`         | 使用 `WebAdapter` 并可跳转至 Google Identity 的 Gemini 公开技术文档  |
| `google-public`      | `https://www.google.com`        | Google 公开入口；可能因 Worker 出口 IP 触发 Google `/sorry` 人机验证 |

### 登录态 Web 适配器

以下站点使用专属适配器，不使用
`ConfiguredAdapter`。每个镜像 Host 只允许对应主站及表中精确列出的资源 Origin；未知 Host、后缀匹配和 API
Origin 一律不会回源。

| 适配器                   | 镜像 Host                               | 主上游 Origin                 | 附属资源 / 认证 Origin                                                                                                      |
| ------------------------ | --------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `GeminiWebAdapter`       | `gemini.fast.dxshelley.fun`             | `https://gemini.google.com`   | `gstatic.com`、`www.gstatic.com`、`ssl.gstatic.com`、`googleusercontent.com`、`lh3.googleusercontent.com`                   |
| `GeminiWebAdapter`       | `ai-studio.fast.dxshelley.fun`          | `https://aistudio.google.com` | `gstatic.com`、`www.gstatic.com`、`ssl.gstatic.com`、`googleusercontent.com`、`lh3.googleusercontent.com`                   |
| `GoogleIdentityAdapter`  | `google-identity.fast.dxshelley.fun`    | `https://accounts.google.com` | `gstatic.com`、`www.gstatic.com`、`ssl.gstatic.com`、`googleusercontent.com`、`lh3.googleusercontent.com`                   |
| `AIGoogleDocsWebAdapter` | `ai-google-dev-docs.fast.dxshelley.fun` | `https://ai.google.dev`       | 受信 Google 静态资源；Google 身份跳转由 `GoogleIdentityAdapter` 处理                                                        |

适配器将镜像 Cookie 改写为按上游 Host 命名的 Cookie，并且仅在请求同一精确 Host 时回放。响应统一使用
`Cache-Control: private, no-store`；同站跳转、受信资源 URL 和 CSP 会改写到镜像 Origin。未知资源 Host 不会被视为可代理目标。

`googleapis.com` 与所有 API Origin、OpenAI 控制台和 Google Cloud
Console 不属于本组配置。WebSocket 升级与未在表中出现的新资源 Origin 必须先增加专门的实现和测试，不能通过放宽 Host 白名单启用。

Google `/sorry`
是上游针对请求出口 IP 的反自动化验证，不能由 Xget 代理规避。若该验证出现，不要扩大 Host 白名单或伪造浏览器标识；应使用 Google 认可的访问方式或由网络管理员处理出口 IP 的信誉与访问策略。

## Cloudflare Workers 部署

同一仓库使用同一个 `src/index.js` 部署两个独立 Worker：

| Worker      | Wrangler 环境 | Custom Domain        | 命令                  |
| ----------- | ------------- | -------------------- | --------------------- |
| `xget-fast` | 默认          | `fast.dxshelley.fun` | `npm run deploy:fast` |
| `xget-git`  | `git`         | `git.dxshelley.fun`  | `npm run deploy:git`  |

`npm run deploy`
按顺序部署两个 Worker。首次部署前，两个域名必须已在同一 Cloudflare 账户中托管；Wrangler 的
`custom_domain = true` 会创建或更新各自的 Custom Domain 绑定。GitHub
Actions 也使用该组合部署命令。

隔离站点上线前，还必须在 `dxshelley.fun` Zone 中配置受 Cloudflare 代理的
`*.fast.dxshelley.fun` 通配 DNS 记录，并将对应通配 Worker route 指向
`xget-fast`。该外部配置不会由站点 JSON 自动创建。

通配 DNS 生效后必须确认边缘证书覆盖 `*.fast.dxshelley.fun`；若 Zone 的 Universal
SSL 未覆盖二级通配域名，应配置 Advanced Certificate 或自定义证书。

### 配置隔离子域名通配入口

在 Cloudflare Dashboard 选择 `dxshelley.fun` Zone 后，按以下顺序配置：

1. 打开 **DNS > Records**，新增一条记录：Type 为 `CNAME`，Name 为
   `*.fast`，Target为 `fast.dxshelley.fun`，并开启
   **Proxied**（橙色云朵）。记录实际匹配 `claude-code.fast.dxshelley.fun`
   等隔离站点 Host；不要把 `*` 或仅 `fast` 作为 Name。
2. 确认 [`wrangler.toml`](../wrangler.toml) 保留以下 route 配置：

   ```toml
   routes = [
     { pattern = "fast.dxshelley.fun", custom_domain = true },
     { pattern = "*.fast.dxshelley.fun/*", zone_name = "dxshelley.fun" }
   ]
   ```

   第一条负责入口域名，第二条将所有隔离子域名请求交给 `xget-fast`
   Worker。不要在 Dashboard 另建一个指向其他 Worker 的同模式 route，以免覆盖或冲突。

3. 执行 `npm run deploy:fast`，使 `xget-fast` 按该 route 发布。DNS 记录与 Worker
   route 是两个独立配置项：前者决定请求是否到达 Cloudflare，后者决定请求到达后是否进入 Worker。
4. 在 **SSL/TLS > Edge Certificates** 检查证书覆盖范围。`*.fast.dxshelley.fun`
   是 `dxshelley.fun` 的二级通配名称；如果 Universal
   SSL 不覆盖它，需要配置 Advanced
   Certificate 或自定义证书后再对外启用隔离站点。
5. 在 **Security > WAF** 和 **Security > Bots** 对 `*.fast.dxshelley.fun`
   应用与公开代理相称的托管规则；在 **Security > WAF > Rate limiting rules**
   对入口 `/?target=`、未知 alias 和高频 `POST`
   设置限流。限流规则按 Host、路径和客户端 IP 区分，不能将合法静态资源与认证/异常请求放在同一阈值中。
6. 保留 Worker invocation logs 和 traces，并为 `4xx/5xx`
   比例、上游超时、Worker 异常、DNS/TLS 失败建立告警。日志字段不得包含 `target`
   的 query、Cookie、Authorization、token 或请求体。

## 发布后验证

部署后按以下顺序验证，避免把 DNS、TLS、Worker 路由和上游代理故障混为一类：

```powershell
Resolve-DnsName claude-code.fast.dxshelley.fun -Type A -Server 1.1.1.1
curl.exe -I https://claude-code.fast.dxshelley.fun/docs/zh-CN/quickstart
curl.exe -I https://fast.dxshelley.fun/_/claude-code/docs/zh-CN/quickstart
Resolve-DnsName ai-studio.fast.dxshelley.fun -Type A -Server 1.1.1.1
curl.exe -I https://ai-studio.fast.dxshelley.fun/
```

第一条和第四条命令必须返回 Cloudflare IP。若浏览器显示
`ERR_NAME_NOT_RESOLVED`，说明请求尚未到达 Worker，应先检查通配 DNS；若 DNS 正常但 TLS 握手失败，检查证书覆盖范围；只有 HTTPS 已建立时，才继续排查 Worker
route 或上游响应。
