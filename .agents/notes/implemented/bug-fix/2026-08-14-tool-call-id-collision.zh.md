# Agent Note: 退化 provider 流上的工具调用 id 防碰撞

Status: implemented

[English](2026-08-14-tool-call-id-collision.md) | 中文

## 问题

有些 provider 偶尔会流式返回带空 `id` 与 `name` 的工具调用——这是模型试图使用它没有的工具时发出的退化调用。DeepSeek 与 pi-ai 适配器把缺失的 provider id 映射为 `CallId('')`，因此会话中的每个此类调用都携带 `tool_call_id: ''`。当该轮在把 `unknown tool ""` 错误折叠成工具结果后重发累积历史时，两条携带相同空 `tool_call_id` 的工具消息会让 provider 以 `INVALID_REQUEST: Duplicate value for 'tool_call_id'` 拒绝请求，导致整轮失败。

## 决策

`BlockAssembler` 保证每个组装出的工具调用块都有非空 id。provider 提供的非空 id 是权威的；缺失或为空的 id 使用按消息区分的盐（agent loop 传入 `turn-step`）加上块索引生成的回退值，因此 `call-{turn}-{step}-{index}` 在整个会话历史上唯一。修复覆盖两条进入路径——delta 组装与 `block-end` 交付的块。agent loop 以 `streamSalt: `${turn}-${step}`` 构造 `BlockAssembler`；适配器保持不变，其空 `''` id 在组装时被修复。

## 备选方案

**在每个适配器里铸造随机 id。** 否决：它一次只修一个适配器，而 assembler 是唯一规范组装点，保证应落在那里；按消息的盐也让修复后的 id 保持确定。

**直接丢弃退化工具调用。** 否决：loop 已经把 `unknown tool ""` 错误折叠成工具结果，让模型知道该调用无效；缺陷在于碰撞 id 使整个请求消失，而不是调用本身。

## 后果

触发退化空 id 工具调用的会话现在可以继续，而不是以 provider `INVALID_REQUEST` 失败整轮。修复后的 id 每条消息确定（turn/step），因此记录的 assistant 消息与任何流重放保持一致的组装结果。非退化的 provider id 不变。