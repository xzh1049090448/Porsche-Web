# 对话回复自适应逐字流式展示：批准与候选契约冻结记录

- 日期：2026-09-07
- 产品依据：`docs/superpowers/specs/2026-09-07-chat-adaptive-character-streaming-prd.md`
- 产品决策：用户已批准 PRD v1.0，采用“真实 SSE + 前端自适应逐字播放”。
- 授权范围：继续前后端项目经理协调和隔离开发。
- 不包含：push、merge、部署、生产迁移、真实付费模型调用。

## 前端基线

- 仓库：Porsche-Web
- 工作树：`.worktrees/chat-streaming-prd`
- 分支：`docs/chat-streaming-prd`
- 批准后协调 revision：`28bff93565733b99c1dded0844788ad59e167680`
- FE-01 与 FE-02 已通过独立规格、质量及根协调验证；这不代表完整 PRD 已完成。

## 后端基线

- 推荐基线：Porsche `origin/main@0bab2b7fd7515789c7a853edab7db120771b6028`
- 推荐隔离分支：`feature/platform-chat-sse-v2-backend`
- 推荐隔离工作树：`<Porsche-repository>/.worktrees/platform-chat-sse-v2-backend`
- Porsche 根目录 `main@e0efac2` 落后且有用户修改，不得作为本需求开发工作树。

## 候选冻结契约

- 名称：`platform-chat-sse.v2`
- 状态：`candidate-frozen`
- 流接口：`POST /api/v1/platform/chat/completions`、`POST /api/v1/platform/chat/compare`
- 状态接口：`POST /api/v1/platform/chat/generations/{generation_id}/cancel`、`GET /api/v1/platform/chat/generations/{generation_id}`
- v2 请求必须含 `stream: true`、`stream_version: "platform-chat-sse.v2"` 和客户端生成的字符串 `generation_id`。
- SSE 首事件为唯一 `meta`；文本使用带 generation/model/严格递增 seq 的非空 `delta`；每个模型先以 `model_done` 或 `model_error` 终止，随后唯一全局 `done` 或 `error`。
- EOF、解析错误、序号缺口、裸 `[DONE]` 均不得视为成功。
- 响应头必须包含 `text/event-stream; charset=utf-8`、`Cache-Control: no-cache, no-transform`、`X-Accel-Buffering: no`。
- 错误仅暴露稳定错误码和允许的 request ID，不得暴露提示词、回复正文、Authorization、密钥、上游原文或内部地址。

## 已批准的生命周期决策

用户于 2026-09-07 明确批准以下方案：

1. 重复 `generation_id` POST 返回 `409` 和当前权威状态，不重新附着 SSE，也不再次调用上游。
2. compare 为每个模型保存独立的 `assistant_message_guid`。
3. 取消或失败不消耗 daily call quota；已经产生的上游成本进入独立审计，不伪装为成功用量。
4. Redis 不可用时仅 v2 返回稳定 `503`；旧协议保持现有兼容行为。

该批准允许继续隔离实现和测试，不自动授权 push、merge、部署、生产迁移或真实付费调用。
