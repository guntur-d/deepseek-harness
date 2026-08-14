# Agent Note: `dsh web` GUI 的远程访问

Status: implemented

[English](2026-08-14-remote-dsh-web-server-access.md) | 中文

## 问题

`dsh web` 只服务于操作者本机。webserver 的 `host` schema 是封闭的双字面量联合（`127.0.0.1` 或 `0.0.0.0`），而 CLI 出于安全刻意拒绝全接口通配字面量，因此运行在远程服务器上的 GUI 无法经 LAN 或 Tailnet IP 访问。在可达性缺口之外，浏览器侧对 RPC 与草稿 id 调用 `crypto.randomUUID()`——一个仅限安全上下文的 API——在非 localhost 来源的明文 HTTP 下会抛错；并且特权方法面（settings、credentials、agent presets、原生对话框）被硬钉在回环，操作者没有任何开放它的途径。

## 决策

远程服务是显式、分层的选择，且明文 HTTP 的浏览器代码绝不触碰 `crypto.randomUUID()`：

- `randomUuid()` 用 `crypto.getRandomValues()` 生成 RFC 4122 v4 UUID，浏览器在不安全来源上也暴露该 API。它位于可内联的线层 `dsh-host-apiproxy/api`，是 `AbstractApiClient.mintRpcId`、connection RPC 通道、fixture 载体与 `ui-conversation` 草稿附件 id 的单一铸造助手。
- webserver 的 `host` schema 接受任意非空绑定地址。具体 IP 字面量或主机名只绑定该网卡；通配字面量 `0.0.0.0`（全部 IPv4）与 `::`（全部 IPv6）仍被 CLI 拒绝。
- `/api` 浏览器信任栅栏仍要求所服务的 authority 出现在 `--trusted-host` 中。缺少匹配的受信 authority 时，具体绑定能提供页面，但每次 `/api` 调用都以 403 拒绝。
- `--allow-privileged-remote`（要求 `--trusted-host`）把特权面——settings、credentials、agent presets、原生对话框、模型发现——开放给恰好这些受信 authority。缺少它时该面保持仅回环。
- 运行时 URL 行对具体绑定打印可达的绑定主机 URL；当服务器绑定回环时，打印仅回环提示（`to serve the network, restart with: dsh web --host <LAN IP> --trusted-host <LAN IP>`）。

## 备选方案

**在前端 shell 中植入 `crypto.randomUUID` 补丁。** 否决：对全局 Web API 打补丁是魔法式修复；定向助手让每个调用点都保持显式。

**从 `dsh-client-connection/client` 导出 `randomUuid`。** 否决：客户端 bundle 纯净门禁禁止对带运行时身份的 loader 行做跨插件值导入。`dsh-host-apiproxy/api` 是文档化的可内联线层，客户端 bundle 已在按值导入它。

**允许 `--host 0.0.0.0`。** 否决：全接口绑定会在没有操作者决策的情况下把远程代码执行暴露给每个网卡。具体地址只绑定一个网卡。

**自动信任具体的绑定主机。** 否决：一个 flag 会在该网卡上静默暴露 agent。栅栏要求 authority 在 `--host` 与 `--trusted-host` 中被两次具名。

**对特权面复用 `--trusted-host`。** 否决：`trustedHosts` 是 DNS rebinding 栅栏而非认证，配置/密钥面在真正的认证出现之前保持仅回环。独立的 `--allow-privileged-remote` 让密钥面暴露成为它自己的显式决策。

## 后果

从远程服务器服务 `dsh web` 的命令是 `dsh web --host <IP> --trusted-host <IP> [--allow-privileged-remote]`——每一层都是显式、可审计的选择。因为没有任何浏览器执行的代码调用 `crypto.randomUUID()`，明文 HTTP 的 LAN/Tailnet 访问可以工作。操作者仍对网络暴露负责：任何可达的受信 authority 都能驱动 agent，启用 `--allow-privileged-remote` 时还能读写配置与密钥库。通配绑定在 CLI 上仍不可用。
