# 对话永久删除 · 后端实现规范（ai-gateway）

用户在前端删除历史对话后，**数据库与缓存均不得保留该对话的任何数据**（含消息正文、元数据、导出缓存、流式会话上下文）。

## API

```
DELETE /api/v1/conversations/{id}
Authorization: Bearer {access_token}
```

### 成功响应

- `204 No Content`（推荐）
- 或 `200` + `{ "deleted": true, "id": 123 }`

### 错误响应

| 状态码 | 场景 |
|--------|------|
| `401` | 未登录 |
| `403` | 对话不属于当前用户 |
| `404` | 对话不存在（幂等：可视为已删除） |
| `409` | 对话正在流式生成中，暂不可删（可选） |

## 数据库（硬删除）

必须在**同一事务**内完成，禁止软删除：

```sql
-- 示例：先删子表再删主表，或使用 ON DELETE CASCADE
DELETE FROM messages WHERE conversation_id = :id AND user_id = :uid;
DELETE FROM conversations WHERE id = :id AND user_id = :uid;
```

关联表（若存在）同步删除，例如：

- `conversation_exports` / 导出记录
- `conversation_attachments` / 图片附件
- `token_usage_logs` 中可匿名化 `conversation_id`，或按合规要求一并删除

## 缓存清理（必须）

删除成功后立即清理所有相关缓存键，例如：

| 缓存键模式 | 说明 |
|-----------|------|
| `conv:{id}` | 对话详情 |
| `conv:{id}:messages` | 消息列表 |
| `user:{user_id}:conversations` | 用户对话列表 |
| `chat:context:{id}` | 上下文窗口 / `context_window` 缓存 |
| `sse:session:{id}` | 进行中的流式会话 |

若使用 Redis：

```text
DEL conv:{id} conv:{id}:messages chat:context:{id}
DEL user:{user_id}:conversations
```

## 流式会话

- 若该 `conversation_id` 存在进行中的 SSE，应**中止连接**并清理内存缓冲
- 删除后，`POST /api/v1/platform/chat/completions` 携带已删 `conversation_id` 应返回 `404`

## 鉴权

```text
conversation.user_id == current_user.id
```

不得通过 ID 猜测删除他人对话。

## 前端约定

前端在 `DELETE` 成功后才更新 UI，并调用 `purgeConversationFromLocal` 清理 `localStorage` 中的 mock 缓存。
