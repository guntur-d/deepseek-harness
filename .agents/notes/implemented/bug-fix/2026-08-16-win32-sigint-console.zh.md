# Agent Note: win32 SIGINT 快速退出，PowerShell 控制台保持可用

状态：已实现

中文 | [English](2026-08-16-win32-sigint-console.md)

## 问题

在 Windows 上注册的 `SIGINT` 监听器会自行应答 `CTRL_C_EVENT`，PowerShell
收不到中断；随后优雅关闭可能拖延到 5 秒上限，PowerShell 5.1 的 PSReadLine
最终控制台输入失效（无提示符、无回显）。上游报告（Discussion #2568）。

## 决策

Windows 上的用户中断使用接近即时的宽限（`WIN32_SIGINT_GRACE_MS = 300`），
取代完整关闭窗口，与 vite/npm 行为一致。控制器的 `interrupt()` 接受可选
的按次宽限；`profile-boot` 的 SIGINT 处理器仅在 `win32` 上传入短窗口——
SIGTERM（supervisor）与正常完成仍保留完整宽限，第二次 Ctrl+C 仍立即强杀。

## 备选方案

**退出前恢复控制台输入模式。** 拒绝：需要原生 `GetConsoleMode`/
`SetConsoleMode` 调用且不解决拖延；快速退出符合既有的 Windows CLI 行为。

**win32 上不注册 SIGINT 监听器。** 拒绝：完全失去优雅销毁与 130 退出码；
短宽限两者兼得。

## 后果

- Windows 上 `dsh web` 之后 Ctrl+C 约 300ms 退出，PowerShell 提示符保持可用。
- 非 Windows 行为不变；树在宽限内完成销毁时优雅拆除照常运行。
