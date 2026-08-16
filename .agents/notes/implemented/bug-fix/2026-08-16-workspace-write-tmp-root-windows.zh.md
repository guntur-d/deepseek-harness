# Agent Note: workspace-write 围栏在 Windows 上不再授予 <盘符>:\tmp

状态：已实现

中文 | [English](2026-08-16-workspace-write-tmp-root-windows.md)

## 问题

`writableRoots()`（`packages/sandbox/sandbox/src/roots.ts`）无条件把 POSIX
字面量 `'/tmp'` 计入 `workspace-write` 允许列表。在 Windows 上
`realpathSync.native('/tmp')` 按进程当前盘符解析，因此当 `<盘符>:\tmp`
存在时，进程内 fs 围栏会把其下任何目标当作可写根接受。上游报告
（Discussion #2562）。

## 决策

POSIX `/tmp` 拼写只用于 POSIX。`os.tmpdir()` 在所有平台都已提供真实的临时
区域，因此 `win32` 上完全去掉该字面量；推导函数接受可注入的平台名，
跨平台行为在任何主机上都有测试钉住。所有执行方言（Seatbelt 配置、
fs-sandbox 围栏）都从同一函数推导，围栏与原生配置不会漂移。

## 备选方案

**保留 `/tmp` 但解析到 Windows 临时目录。** 拒绝：该字面量在 Windows 上
没有意义；`os.tmpdir()` 才是真实临时区域且已被授予，额外根只会扩大围栏。

## 后果

- Windows `workspace-write` 沙箱不再写到工作区与真实临时区域之外。
- POSIX 行为不变（字面量仍解析到共享 `/tmp`）。
