# @deepseek-ai/dsh-client-ui-files

[English](README.md) | 中文

工作区范围的文件面板：会话视图中的一个标签页（`文件`，位于 对话 / 轨迹 旁），浏览 **当前会话的工作区根目录**——列出、打开并编辑文本文件、上传新文件，以及下载任意文件。边界由宿主掌握：每个操作都会解析会话的规范 `header.cwd`，并拒绝任何逃逸出该目录的工作区相对路径（`file-outside-workspace`），因此本面板是工作区范围的，**不是特权表面**——它不需要 `--allow-privileged-remote`，也只能访问会话自身的项目。

## 消费的宿主表面

- `files.list` / `files.read` / `files.write` / `files.upload` —— files RPC 域（`@deepseek-ai/dsh-host-apiproxy`），按会话寻址，所有路径均为工作区相对路径。
- `GET /api/files.download?sessionId=…&path=…` —— 工作区下载表面（受部署传输上限约束；支持 HEAD 预检，与 `session.export` 一致）。

## 界限

- 读取以部署的文本上限为界；更大的文件返回按码点对齐的前缀并标记 `truncated: true`，且编辑器拒绝编辑被截断的视图（覆盖会破坏尾部内容）。
- 写入与上传超过界限会在任何 I/O 之前以 `file-too-large` 响亮失败。
- 列表在条目上限处截断并标记 `truncated: true`。

## 开发

```sh
pnpm --filter @deepseek-ai/dsh-client-ui-files test   # jsdom component + bundle specs
pnpm --filter @deepseek-ai/dsh-client-ui-files bundle # rebuild lib/client.js
```

## Model Experience

间接地，通过共享文件系统：面板的编辑会改变模型的 `read`/`write` 工具所观察的同一批工作区文件（同一 `ctx.fs` 接缝，`workspace-write` 模式），因此之后的模型读取能看到它们；面板本身不注册任何提示词分节、工具 schema 或会话事件。

#### KV Cache effect

无：面板不触及模型请求路径。

## 已知限制与后续工作

- **没有删除、重命名或新建目录操作** —— 面板只列出、读取、写入、上传和下载；破坏性与结构性操作不在首版范围内。
- **仅文本预览** —— 二进制文件可下载但不可预览；读取路径以 `file-not-text` 拒绝它们。
- **上传走 JSON 信封**（base64），保持跨站写入栅栏完整；流式原始体上传路由留待后续。
