function normalized(value) {
  return typeof value === 'string' ? value.toLocaleLowerCase() : ''
}

export function filterModels(models, query) {
  const source = Array.isArray(models) ? models : []
  const needle = normalized(query).trim()

  if (!needle) return [...source]

  return source.filter((model) => [model?.name, model?.id, model?.vendor, model?.desc]
    .some((field) => normalized(field).includes(needle)))
}
