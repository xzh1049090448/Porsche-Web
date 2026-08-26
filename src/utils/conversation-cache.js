import { getItem, setItem, removeItem } from '@/utils/storage'

/** 从本地缓存中彻底移除指定对话（含消息内容） */
export function purgeConversationFromLocal(conversationGuid) {
  const list = getItem('conversations', []).filter((c) => c.guid !== conversationGuid)
  if (list.length) {
    setItem('conversations', list)
  } else {
    removeItem('conversations')
  }

  if (getItem('activeConversation') === conversationGuid) {
    removeItem('activeConversation')
  }
}

/** 清空所有对话相关本地缓存 */
export function clearAllConversationCache() {
  removeItem('conversations')
  removeItem('activeConversation')
}
