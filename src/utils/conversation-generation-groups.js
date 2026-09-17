const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const POSITIVE_DECIMAL_GUID = /^[1-9][0-9]*$/
const STABLE_ERROR_CODE = /^[a-z][a-z0-9_]{0,63}$/
const MAX_SIGNED_INT64 = 9223372036854775807n

function isCanonicalGuid(value) {
  if (typeof value !== 'string' || !POSITIVE_DECIMAL_GUID.test(value)) return false
  try { return BigInt(value) <= MAX_SIGNED_INT64 } catch { return false }
}

function indexMessagesByCanonicalGuid(messages) {
  const byGuid = new Map()
  messages.forEach((message, index) => {
    if (!isCanonicalGuid(message?.guid)) return
    const matches = byGuid.get(message.guid) || []
    matches.push({ message, index })
    byGuid.set(message.guid, matches)
  })
  return byGuid
}

function uniqueMessage(byGuid, guid, role) {
  if (!isCanonicalGuid(guid)) return null
  const matches = byGuid.get(guid)
  if (matches?.length !== 1 || matches[0].message?.role !== role) return null
  return matches[0]
}

function validateResultShape(result) {
  if (!result || typeof result !== 'object' || typeof result.model !== 'string' || result.model.trim() === '') return false
  if (!['completed', 'failed'].includes(result.status)) return false
  if (result.status === 'failed') {
    return result.assistant_message_guid === null
      && result.tokens === 0
      && typeof result.error_code === 'string'
      && STABLE_ERROR_CODE.test(result.error_code)
  }
  return isCanonicalGuid(result.assistant_message_guid)
    && Number.isSafeInteger(result.tokens)
    && result.tokens >= 0
    && result.error_code === null
}

function validateGenerationGroup(group, byGuid, usedUsers, usedAssistants) {
  if (!group || typeof group !== 'object' || typeof group.generation_id !== 'string' || !CANONICAL_UUID.test(group.generation_id) || group.mode !== 'compare') return null
  if (!Array.isArray(group.results) || group.results.length < 2 || group.results.length > 3) return null

  const userMatch = uniqueMessage(byGuid, group.user_message_guid, 'user')
  if (!userMatch || usedUsers.has(group.user_message_guid)) return null

  const models = new Set()
  const assistantGuids = new Set()
  const completed = []
  const normalizedResults = []
  let totalTokens = 0

  for (const result of group.results) {
    if (!validateResultShape(result) || models.has(result.model)) return null
    models.add(result.model)

    if (result.status === 'failed') {
      normalizedResults.push({ result, assistant: null })
      continue
    }

    if (assistantGuids.has(result.assistant_message_guid) || usedAssistants.has(result.assistant_message_guid)) return null
    const assistant = uniqueMessage(byGuid, result.assistant_message_guid, 'assistant')
    if (!assistant || assistant.message.model !== result.model || assistant.message.tokens !== result.tokens) return null
    assistantGuids.add(result.assistant_message_guid)
    totalTokens += result.tokens
    if (!Number.isSafeInteger(totalTokens)) return null
    completed.push(assistant)
    normalizedResults.push({ result, assistant })
  }

  if (completed.length === 0) return null
  const firstCompleted = normalizedResults.find(item => item.assistant)?.assistant.message
  const replies = Object.fromEntries(normalizedResults.map(({ result, assistant }) => [result.model, assistant ? assistant.message.content : '']))
  const contextReplies = Object.fromEntries(normalizedResults.filter(item => item.assistant).map(({ result, assistant }) => [result.model, assistant.message.content]))
  const modelStates = Object.fromEntries(normalizedResults.map(({ result }) => [result.model, { status: result.status, code: result.error_code }]))
  const sourceAssistantGuids = normalizedResults.filter(item => item.assistant).map(({ result }) => result.assistant_message_guid)

  return {
    userMessageGuid: group.user_message_guid,
    sourceAssistantGuids,
    insertIndex: Math.min(...completed.map(item => item.index)),
    aggregate: {
      guid: firstCompleted.guid,
      role: 'assistant',
      content: null,
      model: null,
      tokens: totalTokens,
      createdAt: firstCompleted.createdAt,
      multiModel: true,
      generationId: group.generation_id,
      models: group.results.map(result => result.model),
      replies,
      contextReplies,
      modelStates,
      sourceAssistantGuids,
    },
  }
}

function replaceAssistantMessages(messages, accepted) {
  const removed = new Set(accepted.flatMap(candidate => candidate.sourceAssistantGuids))
  const aggregateByIndex = new Map(accepted.map(candidate => [candidate.insertIndex, candidate.aggregate]))
  const projected = []
  messages.forEach((message, index) => {
    const aggregate = aggregateByIndex.get(index)
    if (aggregate) projected.push(aggregate)
    if (!removed.has(message?.guid)) projected.push(message)
  })
  return projected
}

/**
 * Builds deterministic compare display messages from verified server grouping metadata.
 * Invalid metadata is ignored so the original flat message history remains intact.
 */
export function projectConversationGenerationGroups(rawMessages, generationGroups) {
  const messages = Array.isArray(rawMessages) ? rawMessages : []
  const groups = Array.isArray(generationGroups) ? generationGroups : []
  const byGuid = indexMessagesByCanonicalGuid(messages)
  const usedUsers = new Set()
  const usedAssistants = new Set()
  const accepted = []

  for (const group of groups) {
    const candidate = validateGenerationGroup(group, byGuid, usedUsers, usedAssistants)
    if (!candidate) continue
    accepted.push(candidate)
    usedUsers.add(candidate.userMessageGuid)
    candidate.sourceAssistantGuids.forEach(guid => usedAssistants.add(guid))
  }

  if (accepted.length === 0) return { messages }
  return { messages: replaceAssistantMessages(messages, accepted), rawMessages: messages }
}
