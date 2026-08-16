# Agent Note: 工作区作用域的 Files 面板（浏览、编辑、上传、下载）

Status: implemented

[English](2026-08-15-workspace-files-panel.md) | 中文

## Problem

GUI 没有面向会话工作区的浏览器侧文件面：宿主侧工具可以读写文件，但浏览器端的操作者无法列出、预览、编辑、上传或下载它们。fork 交接把缺口界定为工作区作用域的 Files 右侧面板——在 workspace 边界内浏览活动会话的 `cwd`，刻意不成为特权面。

## Decision

在 `ApiProxy` 上新增 `files` RPC 领域（`files.list`/`read`/`write`/`upload`），以会话寻址、路径均为工作区相对路径；另加与会话导出镜像的 `GET /api/files.download` 字节面（先 `HEAD` 预检，再交给浏览器下载管理器）。宿主是权威：会话规范化的 `header.cwd` 即工作区根目录，每条路径都经 fs seam 解析（`fs.resolve` 将符号链接 realpath）且必须通过 `fs.contains`——其余一律失败于 `file-outside-workspace`。写入与上传携带显式锚定于规范化工作区的 `workspace-write` 策略，使沙箱后端的围栏与包含门禁一致；上传作为 base64 搭乘 JSON 信封，因此载体的跨站写入围栏仍然覆盖它们。读取返回有界文本（默认 1 MiB，按码点对齐的前缀加 `truncated`），列目录以 2000 条为上限，传输以 64 MiB 为上限；三个上限都是经过校验的 `ApiProxyService` 配置键。fs seam 增加了 `readBytes` 的字节镜像：抽象 `writeBytes` 由 `dsh-fs-local`、`dsh-fs-sandbox` 与 `dsh-fs-e2b` 实现。

客户端半边是新的插件包 `@deepseek-ai/dsh-client-ui-files`：它在会话视图环注册 `files` 标签页（order 20），`FilesView` 通过注入的会话绑定操作（其 contract）接收一切——它从不接触会话 id、连接句柄或 ctx。一个无密钥的 web e2e 黄金快照（`apps/web/tests/files-panel.e2e.ts`）种入真实会话，在其工作区创建真实文件，驱动标签页完成列表与有界编辑器流程，并对面板 ARIA 快照。

## Alternatives considered

**FTP/SFTP 端点工具（handoff 选项 A）。** 不采用：操作者缺口是针对 harness 自身工作区的浏览器侧传输；外部服务器连接在出现具体需求之前保持延后。

**裸 body 上传路由。** 不采用：浏览器发出的跨站「简单」POST 不带 CORS 预检，会击穿 `application/json` 415 写入围栏；base64 放进信封能让上传与其余方法处于同一围栏之下。

**特权远程面。** 不采用：面板按设计就是工作区作用域，绝不能依赖 `--allow-privileged-remote`。

## Consequences

面板浏览每个会话自己的工作区根目录；工作区之外的内容无法被列出、读取、写入、上传或下载，截断的读取也拒绝编辑。`files` 领域与下载面记录在 apiproxy README 与 ui-files 包 README；`writeBytes` seam 新增记录在 filesystem 子系统页。面板的目录、打开文件与草稿状态都属于组件局部状态，切换会话后不保留。
