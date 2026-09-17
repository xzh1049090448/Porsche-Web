const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const POSITIVE_DECIMAL_GUID = /^[1-9][0-9]*$/
const STABLE_ERROR_CODE = /^[a-z][a-z0-9_]{0,63}$/
const MAX_SIGNED_INT64 = 9223372036854775807n
const ACCESS_FAILED = Symbol('access-failed')

function readProperty(value, property) {
  try { return value?.[property] } catch { return ACCESS_FAILED }
}

function isArray(value) {
  try { return Array.isArray(value) } catch { return false }
}

function isCanonicalGuid(value) {
  if (typeof value !== 'string' || !POSITIVE_DECIMAL_GUID.test(value)) return false
  try { return BigInt(value) <= MAX_SIGNED_INT64 } catch { return false }
}

function indexMessagesByCanonicalGuid(messages) {
  const byGuid = new Map()
  const ordered = []
  const length = readProperty(messages, 'length')
  if (length === ACCESS_FAILED) return null
  for (let index = 0; index < length; index += 1) {
    const message = readProperty(messages, index)
    if (message === ACCESS_FAILED) return null
    const guid = readProperty(message, 'guid')
    const role = readProperty(message, 'role')
    if (guid === ACCESS_FAILED || role === ACCESS_FAILED) return null
    const snapshot = { message, index, guid, role }
    ordered.push(snapshot)
    if (!isCanonicalGuid(guid)) continue
    const matches = byGuid.get(guid) || []
    matches.push(snapshot)
    byGuid.set(guid, matches)
  }
  return { byGuid, ordered }
}

function uniqueMessage(byGuid, guid, role) {
  if (!isCanonicalGuid(guid)) return null
  const matches = byGuid.get(guid)
  if (matches?.length !== 1 || matches[0].role !== role) return null
  return matches[0]
}

function readResult(result) {
  if (!result || typeof result !== 'object') return null
  const model = readProperty(result, 'model')
  const status = readProperty(result, 'status')
  const assistantMessageGuid = readProperty(result, 'assistant_message_guid')
  const tokens = readProperty(result, 'tokens')
  const errorCode = readProperty(result, 'error_code')
  if ([model, status, assistantMessageGuid, tokens, errorCode].includes(ACCESS_FAILED)) return null
  if (typeof model !== 'string' || model.trim() === '' || !['completed', 'failed'].includes(status)) return null
  if (status === 'failed') {
    if (assistantMessageGuid !== null || tokens !== 0 || typeof errorCode !== 'string' || !STABLE_ERROR_CODE.test(errorCode)) return null
  } else if (!isCanonicalGuid(assistantMessageGuid) || !Number.isSafeInteger(tokens) || tokens < 0 || errorCode !== null) {
    return null
  }
  return { model, status, assistantMessageGuid, tokens, errorCode }
}

function validateGenerationGroup(group, byGuid, usedUsers, usedAssistants) {
  if (!group || typeof group !== 'object') return null
  const generationId = readProperty(group, 'generation_id')
  const mode = readProperty(group, 'mode')
  const userMessageGuid = readProperty(group, 'user_message_guid')
  const results = readProperty(group, 'results')
  if ([generationId, mode, userMessageGuid, results].includes(ACCESS_FAILED)) return null
  if (typeof generationId !== 'string' || !CANONICAL_UUID.test(generationId) || mode !== 'compare' || !isArray(results)) return null
  const resultCount = readProperty(results, 'length')
  if (resultCount === ACCESS_FAILED || resultCount < 2 || resultCount > 3) return null

  const userMatch = uniqueMessage(byGuid, userMessageGuid, 'user')
  if (!userMatch || usedUsers.has(userMessageGuid)) return null

  const models = new Set()
  const assistantGuids = new Set()
  const completed = []
  const normalizedResults = []
  let totalTokens = 0

  for (let index = 0; index < resultCount; index += 1) {
    const rawResult = readProperty(results, index)
    if (rawResult === ACCESS_FAILED) return null
    const result = readResult(rawResult)
    if (!result || models.has(result.model)) return null
    models.add(result.model)

    if (result.status === 'failed') {
      normalizedResults.push({ result, assistant: null })
      continue
    }

    if (assistantGuids.has(result.assistantMessageGuid) || usedAssistants.has(result.assistantMessageGuid)) return null
    const assistantMatch = uniqueMessage(byGuid, result.assistantMessageGuid, 'assistant')
    if (!assistantMatch) return null
    const assistantModel = readProperty(assistantMatch.message, 'model')
    const assistantTokens = readProperty(assistantMatch.message, 'tokens')
    const assistantContent = readProperty(assistantMatch.message, 'content')
    const assistantCreatedAt = readProperty(assistantMatch.message, 'createdAt')
    if ([assistantModel, assistantTokens, assistantContent, assistantCreatedAt].includes(ACCESS_FAILED)) return null
    if (assistantModel !== result.model || assistantTokens !== result.tokens) return null
    const assistant = { guid: result.assistantMessageGuid, content: assistantContent, createdAt: assistantCreatedAt, index: assistantMatch.index }
    assistantGuids.add(result.assistantMessageGuid)
    totalTokens += result.tokens
    if (!Number.isSafeInteger(totalTokens)) return null
    completed.push(assistant)
    normalizedResults.push({ result, assistant })
  }

  if (completed.length === 0) return null
  const firstCompleted = normalizedResults.find(item => item.assistant)?.assistant
  const replies = Object.fromEntries(normalizedResults.map(({ result, assistant }) => [result.model, assistant ? assistant.content : '']))
  const contextReplies = Object.fromEntries(normalizedResults.filter(item => item.assistant).map(({ result, assistant }) => [result.model, assistant.content]))
  const modelStates = Object.fromEntries(normalizedResults.map(({ result }) => [result.model, { status: result.status, code: result.errorCode }]))
  const sourceAssistantGuids = normalizedResults.filter(item => item.assistant).map(({ result }) => result.assistantMessageGuid)

  return {
    userMessageGuid,
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
      generationId,
      models: normalizedResults.map(({ result }) => result.model),
      replies,
      contextReplies,
      modelStates,
      sourceAssistantGuids,
    },
  }
}

function replaceAssistantMessages(messageSnapshots, accepted) {
  const removed = new Set(accepted.flatMap(candidate => candidate.sourceAssistantGuids))
  const aggregateByIndex = new Map(accepted.map(candidate => [candidate.insertIndex, candidate.aggregate]))
  const projected = []
  for (const snapshot of messageSnapshots) {
    const aggregate = aggregateByIndex.get(snapshot.index)
    if (aggregate) projected.push(aggregate)
    if (!removed.has(snapshot.guid)) projected.push(snapshot.message)
  }
  return projected
}

/**
 * Builds deterministic compare display messages from verified server grouping metadata.
 * Invalid metadata is ignored so the original flat message history remains intact.
 */
export function projectConversationGenerationGroups(rawMessages, generationGroups) {
  const messages = isArray(rawMessages) ? rawMessages : []
  const groups = isArray(generationGroups) ? generationGroups : []
  const messageIndex = indexMessagesByCanonicalGuid(messages)
  if (!messageIndex) return { messages }
  const { byGuid, ordered } = messageIndex
  const usedUsers = new Set()
  const usedAssistants = new Set()
  const accepted = []

  const groupCount = readProperty(groups, 'length')
  if (groupCount === ACCESS_FAILED) return { messages }
  for (let index = 0; index < groupCount; index += 1) {
    const group = readProperty(groups, index)
    if (group === ACCESS_FAILED) continue
    const candidate = validateGenerationGroup(group, byGuid, usedUsers, usedAssistants)
    if (!candidate) continue
    accepted.push(candidate)
    usedUsers.add(candidate.userMessageGuid)
    candidate.sourceAssistantGuids.forEach(guid => usedAssistants.add(guid))
  }

  if (accepted.length === 0) return { messages }
  return { messages: replaceAssistantMessages(ordered, accepted), rawMessages: messages }
}
