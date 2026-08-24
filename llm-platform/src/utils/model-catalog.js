/** Converts the trusted, local platform catalog contract into display models. */
export function catalogModels(payload) {
  const seen = new Set()
  const rows = Array.isArray(payload?.data) ? payload.data : []

  return rows.flatMap((raw) => {
    const id = typeof raw?.id === 'string' ? raw.id.trim() : ''
    if (!id || seen.has(id)) return []
    seen.add(id)

    return [{
      id,
      name: safeText(raw.title) || id,
      desc: safeText(raw.description),
      vendor: safeText(raw.owned_by),
      icon: id.slice(0, 1).toUpperCase(),
      type: 'chat',
      multimodal: false,
      maxTokens: finiteNumber(raw.max_tokens),
      contextWindow: finiteNumber(raw.context_window),
      inputTokenPricePerM: finiteNumber(raw.input_token_price_per_m),
      outputTokenPricePerM: finiteNumber(raw.output_token_price_per_m),
    }]
  })
}

/** Returns a current authorized selection, or an empty ID when the catalog is empty. */
export function chooseAvailableModel(candidate, models) {
  return models.some((model) => model.id === candidate) ? candidate : (models[0]?.id || '')
}

/** Keeps the caller selection ordered, authorized, unique, and within the API limit. */
export function chooseCompareModels(candidates, models) {
  const available = new Set(models.map((model) => model.id))
  return [...new Set((candidates || []).filter((id) => available.has(id)))].slice(0, 3)
}

function safeText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}
