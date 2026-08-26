# 对话逻辑删除 · 后端实现规范（ai-gateway）

用户在前端删除历史对话后，对话与消息必须逻辑删除，并从所有常规读取、授权和统计中排除。缓存和流式上下文必须立即清理。

## API

```
DELETE /api/v1/conversations/{guid}
Authorization: Bearer {access_token}
```

### 成功响应

- `204 No Content`（推荐）
- 或 `200` + `{ "deleted": true, "guid": "903496573054181376" }`

### 错误响应

| 状态码 | 场景 |
|--------|------|
| `401` | 未登录 |
| `403` | 对话不属于当前用户 |
| `404` | 对话不存在（幂等：可视为已删除） |
| `409` | 对话正在流式生成中，暂不可删（可选） |

## 数据库（逻辑删除）

必须在**同一事务**内完成，禁止物理删除：

```sql
-- 以内部外键关联用户；外部请求仅提供 conversation guid。
UPDATE messages SET is_deleted = 1, updated_at = :now_ms, updated_by = :uid
WHERE conversation_id = :conversation_id AND user_id = :uid AND is_deleted = 0;
UPDATE conversations SET is_deleted = 1, updated_at = :now_ms, updated_by = :uid
WHERE guid = :guid AND user_id = :uid AND is_deleted = 0;
```

后续任何查询、预加载与统计必须显式过滤 `is_deleted = 0`。

## 缓存清理（必须）

删除成功后立即清理所有相关缓存键，例如：

| 缓存键模式 | 说明 |
|-----------|------|
| `conv:{guid}` | 对话详情 |
| `conv:{guid}:messages` | 消息列表 |
| `user:{user_guid}:conversations` | 用户对话列表 |
| `chat:context:{guid}` | 上下文窗口 / `context_window` 缓存 |
| `sse:session:{guid}` | 进行中的流式会话 |

若使用 Redis：

```text
DEL conv:{guid} conv:{guid}:messages chat:context:{guid}
DEL user:{user_guid}:conversations
```

## 流式会话

- 若该 `conversation_guid` 存在进行中的 SSE，应**中止连接**并清理内存缓冲
- 删除后，`POST /api/v1/platform/chat/completions` 携带已删 `conversation_guid` 应返回 `404`

## 鉴权

```text
conversation.user_id == current_user.id AND conversation.is_deleted == 0
```

不得通过 ID 猜测删除他人对话。

## 前端约定

前端只以字符串 GUID 调用 `DELETE`，在成功后才更新 UI，并调用 `purgeConversationFromLocal` 清理 mock 缓存。
