# xget 认证使用说明

生产环境的 xget 代理默认要求登录。首次访问代理域名时会跳转到登录页，输入管理员分发的访问密钥后，Worker 会写入一个安全 Cookie。Cookie 有效期为 90 天，不能被 JavaScript 读取，也不会转发给 GitHub、Docker
Hub 或其他上游。

## 部署配置

必须通过 Cloudflare Secret 设置 `XGET_SESSION_SECRET` 和
`XGET_LOGIN_SECRET`，不要将它们写入 `wrangler.toml` 或提交到 Git：

```bash
npx wrangler secret put XGET_SESSION_SECRET
npx wrangler secret put XGET_LOGIN_SECRET
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

## 当前范围

本阶段只实现浏览器访问认证。Git Smart HTTP、`git clone` 和 Docker
Registry 认证使用各自协议的认证流程，不能把浏览器 Cookie 手工复制到命令行工具中。
