import { optionalGuid } from '../api/guid.js'

/** Applies only a valid opaque conversation GUID; never coerces a Snowflake number. */
export function applyConversationGuid(conversation, value) {
  const guid = optionalGuid(value)
  return guid ? { ...conversation, guid } : conversation
}

/** Replaces a server conversation by its GUID, or prepends it when first created. */
export function upsertConversationByGuid(conversations, conversation) {
  const guid = optionalGuid(conversation?.guid)
  if (!guid) return conversations
  const next = applyConversationGuid(conversation, guid)
  const index = conversations.findIndex((item) => item.guid === guid)
  if (index < 0) return [next, ...conversations]
  return conversations.map((item, itemIndex) => (itemIndex === index ? next : item))
}

/** Removes one conversation using its opaque business GUID. */
export function removeConversationByGuid(conversations, value) {
  const guid = optionalGuid(value)
  return guid ? conversations.filter((conversation) => conversation.guid !== guid) : conversations
}
