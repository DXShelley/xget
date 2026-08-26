# xget 认证使用说明

生产环境的 xget 代理默认要求登录。首次访问代理域名时会跳转到登录页，输入管理员分发的访问密钥后，Worker 会写入一个安全 Cookie。Cookie 有效期为 90 天，不能被 JavaScript 读取，也不会转发给 GitHub、Docker
Hub 或其他上游。

## 部署配置

必须通过 Cloudflare Secret 设置 `XGET_SESSION_SECRET` 和
`XGET_LOGIN_SECRET`，不要将它们写入 `wrangler.toml` 或提交到 Git：

```bash
npx wrangler secret put XGET_SESSION_SECRET
npx wrangler secret put XGET_LOGIN_SECRET
npx wrangler secret put XGET_SESSION_SECRET --env git
npx wrangler secret put XGET_LOGIN_SECRET --env git
```

生产配置使用 `XGET_AUTH_REQUIRED=true`。轮换 `XGET_SESSION_SECRET`
会立即使已有登录 Cookie 全部失效；轮换 `XGET_LOGIN_SECRET` 会立即更换登录密钥。

## 浏览器登录

首次访问 `fast.dxshelley.fun`、`git.dxshelley.fun`
或其他受保护的浏览器代理时，页面会跳转到：

```text
/__xget/auth/login
```

登录成功后会回到原始路径。检查当前登录状态：

```text
GET /__xget/auth/session
```

退出登录：

```bash
curl -i -X POST https://fast.dxshelley.fun/__xget/auth/logout
```

认证 Cookie 使用 `__Host-xget_session`，属性为
`Secure`、`HttpOnly`、`SameSite=Lax` 和
`Path=/`。认证请求和认证后的代理请求不得进入共享缓存。

## Git clone

Git Smart HTTP 使用标准 Basic challenge。首次执行 `git clone` 时输入用户名和 Git
Access Token，之后由 Git credential helper 保存凭据：

```bash
git config --global credential.helper osxkeychain
git clone https://git.dxshelley.fun/owner/repo.git
```

用户名可以使用任意非空值。最简单的首次使用方式是直接输入
`XGET_LOGIN_SECRET`；该方式适合少量用户，管理员应至少每 90 天轮换一次登录密钥。更推荐浏览器登录后，向
`/__xget/auth/git-token` 发送 POST，获得一个自动在 90 天后失效的 Git Access
Token；管理员轮换 `XGET_SESSION_SECRET` 会立即使签发的 Git
Token 失效。浏览器 Cookie 不能直接用于 Git 命令行。

## Docker pull

Docker Registry 使用标准 Bearer challenge。先在浏览器登录，然后调用
`/__xget/auth/git-token` 获取 90 天 Access Token，并使用该 token 登录 Docker：

```bash
docker login docker.fast.dxshelley.fun
# Username: xget
# Password: 上一步获得的 Access Token
docker pull docker.fast.dxshelley.fun/library/alpine:latest
```

Docker 客户端之后会自动使用短期 Bearer token。当前只支持公开镜像的
`pull`，不支持 `push` 或上游私有仓库凭据转发。xget Bearer
token 不会转发到 Docker Hub。
