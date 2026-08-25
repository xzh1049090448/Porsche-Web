/** Keep Snowflake identifiers as opaque strings; never coerce them through Number. */
export function optionalGuid(value) {
  return typeof value === 'string' && value.trim() ? value : null
}

/** Require an opaque GUID string before it becomes part of a request path. */
export function requiredGuid(value, label = 'GUID') {
  const guid = optionalGuid(value)
  if (!guid) throw new TypeError(`${label} must be a non-empty GUID string`)
  return guid
}
