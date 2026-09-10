# xget 认证使用说明

生产环境的 xget 普通代理默认要求登录。首次访问代理域名时会跳转到登录页，输入管理员分发的访问密钥后，Worker 会写入一个安全 Cookie。Cookie 有效期为 90 天，不能被 JavaScript 读取，也不会转发给 GitHub、Docker
Hub 或其他上游。

AI 推理接口 `/ip/*`
是例外：OpenAI、Gemini、Anthropic 等模型 API 请求不要求 xget 浏览器登录，直接进入上游代理流程。调用方仍必须提供对应模型厂商的 API
key；请求中的 `Authorization`、`x-api-key`
等认证请求头会按协议转发给上游，不会被 xget 登录 Cookie 替代。

认证由入口固定的协议适配器执行：Web 使用 Cookie，Git/Git LFS 使用 Basic，Docker 使用 Bearer；AI、Hugging Face 与包管理器适配器只保留调用方到上游的凭证语义。

公开包管理器目录（包括
`/npm/*`、`/pypi/*`、`/maven/*`、`/crates/*`）同样不要求浏览器登录，保证客户端能读取元数据和制品；认证仍按各自协议作用于普通网页代理、Git/Git
LFS 和 Docker 请求。

## 部署配置

必须通过 Cloudflare Secret 设置 `XGET_SESSION_SECRET` 和
`XGET_LOGIN_SECRET`，不要将它们写入 `wrangler.toml` 或提交到 Git：

```bash
npx wrangler secret put XGET_SESSION_SECRET
npx wrangler secret put XGET_LOGIN_SECRET
npx wrangler secret put XGET_SESSION_SECRET --env git
npx wrangler secret put XGET_LOGIN_SECRET --env git
```

生产配置使用 `XGET_AUTH_REQUIRED=true`。如果需要将 `?target=`
限制为配置站点，额外设置
`XGET_PROXY_TARGET_ALLOWLIST=true`；该开关默认关闭，以便认证后的请求使用 HTTPS 透明代理。轮换
`XGET_SESSION_SECRET` 会立即使已有登录 Cookie 全部失效；轮换 `XGET_LOGIN_SECRET`
会立即更换登录密钥。

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

Docker Registry 使用标准 Bearer
challenge。简单首次使用时，可以直接使用登录页的 Access
secret 登录；更推荐先在浏览器登录，然后调用 `/__xget/auth/git-token`
获取 90 天 Access Token：

```bash
docker login docker.fast.dxshelley.fun
# Username: xget
# Password: Access secret 或上一步获得的 Access Token
docker pull docker.fast.dxshelley.fun/library/alpine:latest
docker pull docker.fast.dxshelley.fun/library/nginx:latest
```

Docker 客户端会将登录凭据保存到本地 Docker 配置，后续 `pull`
会自动用该凭据换取短期 Bearer token，不需要每次重新登录。使用浏览器签发的 Access
Token 时，Token 有效期为 90 天；直接使用 `XGET_LOGIN_SECRET`
时，有效期由管理员轮换该 Secret 控制。当前只支持公开镜像的 `pull`，不支持 `push`
或上游私有仓库凭据转发。xget Bearer token 不会转发到 Docker Hub。

Docker Hub 官方镜像需要显式使用 `library` 命名空间，例如 `library/alpine` 和
`library/nginx`。带有其他命名空间的路径（例如 `nginx/nginx`）表示 Docker
Hub 上的独立 `nginx/nginx` 仓库，不等同于官方 `nginx`
镜像；如果该仓库不存在，Docker CLI 可能会显示
`Login prior to pull`，这不代表本地 90 天登录态失效。

Ubuntu 等没有 Docker credential helper 的系统，通常会将凭据写入
`~/.docker/config.json`，并显示 unencrypted
warning。这不会影响后续使用，但应限制该文件权限；生产环境建议安装并配置 Docker
credential helper。确认当前登录信息：

```bash
docker login docker.fast.dxshelley.fun
docker pull docker.fast.dxshelley.fun/library/alpine:latest
```

如果 macOS Docker CLI 报错
`error saving credentials: User interaction is not allowed. (-25308)`，这是本机 Keychain 无法在当前终端会话中保存凭据，不是 xget 服务端认证失败。可使用临时配置目录绕过 Keychain 完成登录和拉取：

```bash
export DOCKER_CONFIG="$(mktemp -d)"
printf '%s\n' '<XGET_LOGIN_SECRET>' | \
  docker login docker.fast.dxshelley.fun --username xget --password-stdin
docker pull docker.fast.dxshelley.fun/library/alpine:latest
```

临时目录中的凭据只对当前 shell 有效。若希望持久保存，请在本机交互式桌面终端解锁登录 Keychain 后重新执行
`docker login`，或按 Docker
Desktop 的凭据存储配置处理；不要把登录密钥直接写入脚本、镜像或仓库。
