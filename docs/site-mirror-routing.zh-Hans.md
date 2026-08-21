# 站点镜像路由

## 域名边界

| 镜像域名                         | 上游              | 适配器                |
| -------------------------------- | ----------------- | --------------------- |
| `git.dxshelley.fun`              | `github.com`      | `GitHubAdapter`       |
| `fast.dxshelley.fun`             | 现有平台目录      | `XgetPlatformAdapter` |
| `claude.fast.dxshelley.fun`      | `claude.com`      | `ConfiguredAdapter`   |
| `code.claude.fast.dxshelley.fun` | `code.claude.com` | `ConfiguredAdapter`   |

站点由请求 `Host` 唯一确定。`git.dxshelley.fun`
的根路径与 GitHub 根路径一一对应，例如 `/Homebrew/brew`、ZIP 下载和
`owner/repo.git/info/refs` 都直接转发至 `github.com` 的同一路径。旧 GitHub Web
`/gh/*` 路径不再支持。

`fast.dxshelley.fun` 仅保留 Xget 的平台前缀路由，例如
`/npm/*`、`/pypi/*`、`/cr/*` 和
`/ip/*`。它不会按浏览器头或仓库形状猜测 GitHub 流量。

## GitHub 资源域

GitHub 页面引用的资源通过 `git.dxshelley.fun/_github/proxy/<host>/<path>`
回源。`<host>`
必须在 GitHub 适配器的固定白名单中；未知 host 被拒绝，不能作为通用开放代理使用。

GitHub 页面、JSON、重定向、CSS/JS
URL 和 WebSocket 地址会被结构化改写到镜像根路径或该资源命名空间。Git Smart
HTTP、LFS、上传和所有允许方法的请求体原样传递。

## 凭证、缓存与风控

- `Authorization`、CSRF、`Origin`、`Referer`、Turbo、PJAX 与 React 请求头保持语义并映射到固定上游。
- 镜像 Cookie 按上游 host 作用域回放；上游 `Set-Cookie`
  回写为镜像可用 Cookie，禁止跨站点混发。
- 认证、写操作、上传、OAuth 与令牌请求使用 `no-store`，且不重试非幂等 body。
- 上游 `429`、`403`、登录挑战与访问控制原样保留；代理不规避上游风控或访问限制。
- 审计信息必须脱敏，不能记录 Cookie、Authorization、token 或请求体。

## 新增简单站点

在 [`config/sites.json`](../config/sites.json)
添加固定镜像主机与固定上游即可创建
`ConfiguredAdapter`。配置不是用户可控 URL 转发：未登记的镜像主机永远不会被代理。若站点需要复杂认证、协议、内容重写或资源域策略，应新增专属适配器与 Filter，而不是放宽通用代理。

每个站点根域或子域均作为独立镜像站点注册。例如 `claude.com` 和 `code.claude.com`
分别对应独立配置，Cookie、浏览器存储、缓存和授权状态自然隔离。

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
