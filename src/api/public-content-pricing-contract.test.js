import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const frontendContractURL = new URL('../../interface-contract.json', import.meta.url)
const missingContractPath = '/definitely/not/a/public-content-pricing-contract.json'

async function readJSON(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

function requireBackendContractPath(env = process.env) {
  assert.ok(env.PUBLIC_PRICING_BACKEND_CONTRACT, 'missing_PUBLIC_PRICING_BACKEND_CONTRACT')
  return env.PUBLIC_PRICING_BACKEND_CONTRACT
}

function routeTuple(route) {
  return {
    method: route.method,
    path: route.path,
    role: route.role,
    request_headers: route.request_headers,
    response_headers: route.response_headers,
    path_schema: route.path_schema,
    query_schema: route.query_schema,
    body_schema: route.body_schema,
    response_schema: route.response_schema,
    status: route.status,
  }
}

function referencedSchemaNames(contract, routes = contract.routes) {
  const names = new Set()
  const visit = name => {
    if (names.has(name)) return
    assert.ok(contract.schemas[name], `missing_schema:${name}`)
    names.add(name)
    const walk = value => {
      if (!value || typeof value !== 'object') return
      if (typeof value.$ref === 'string') visit(value.$ref)
      for (const [key, child] of Object.entries(value)) {
        if (key === 'one_of' && Array.isArray(child)) {
          for (const member of child) {
            if (typeof member === 'string') visit(member)
            else walk(member)
          }
          continue
        }
        walk(child)
      }
    }
    walk(contract.schemas[name])
  }
  for (const route of routes) {
    for (const key of ['path_schema', 'query_schema', 'body_schema', 'response_schema']) visit(route[key])
  }
  visit(contract.errors.envelope_schema)
  return [...names].sort()
}

function selectedProperties(object, names) {
  return Object.fromEntries(names.map(name => [name, object[name]]))
}

function stableHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

const frozenNewRoutes = [
  { method: 'GET', path: '/api/v1/public/home-config', role: 'anonymous', request_headers: 'public_request_headers', response_headers: 'public_response_headers', path_schema: 'NoBody', query_schema: 'NoBody', body_schema: 'NoBody', response_schema: 'HomeConfigPublicResponse', status: 200 },
  { method: 'GET', path: '/admin/v2/public-content/home-draft', role: 'root', request_headers: 'admin_request_headers', response_headers: 'admin_response_headers', path_schema: 'NoBody', query_schema: 'NoBody', body_schema: 'NoBody', response_schema: 'HomeDraftResponse', status: 200 },
  { method: 'POST', path: '/admin/v2/public-content/home-draft/announcements', role: 'root', request_headers: 'admin_request_headers', response_headers: 'admin_response_headers', path_schema: 'NoBody', query_schema: 'NoBody', body_schema: 'AnnouncementCreateRequest', response_schema: 'HomeDraftResponse', status: 201 },
  { method: 'PATCH', path: '/admin/v2/public-content/home-draft/announcements/{guid}', role: 'root', request_headers: 'admin_request_headers', response_headers: 'admin_response_headers', path_schema: 'GUIDRequest', query_schema: 'NoBody', body_schema: 'AnnouncementUpdateRequest', response_schema: 'HomeDraftResponse', status: 200 },
  { method: 'DELETE', path: '/admin/v2/public-content/home-draft/announcements/{guid}', role: 'root', request_headers: 'admin_request_headers', response_headers: 'admin_draft_delete_response_headers', path_schema: 'GUIDRequest', query_schema: 'NoBody', body_schema: 'AnnouncementDeleteRequest', response_schema: 'NoBody', status: 204 },
  { method: 'POST', path: '/admin/v2/public-content/home-draft/faqs', role: 'root', request_headers: 'admin_request_headers', response_headers: 'admin_response_headers', path_schema: 'NoBody', query_schema: 'NoBody', body_schema: 'FAQCreateRequest', response_schema: 'HomeDraftResponse', status: 201 },
  { method: 'PATCH', path: '/admin/v2/public-content/home-draft/faqs/{guid}', role: 'root', request_headers: 'admin_request_headers', response_headers: 'admin_response_headers', path_schema: 'GUIDRequest', query_schema: 'NoBody', body_schema: 'FAQUpdateRequest', response_schema: 'HomeDraftResponse', status: 200 },
  { method: 'DELETE', path: '/admin/v2/public-content/home-draft/faqs/{guid}', role: 'root', request_headers: 'admin_request_headers', response_headers: 'admin_draft_delete_response_headers', path_schema: 'GUIDRequest', query_schema: 'NoBody', body_schema: 'FAQDeleteRequest', response_schema: 'NoBody', status: 204 },
  { method: 'PUT', path: '/admin/v2/public-content/home-draft/featured-models', role: 'root', request_headers: 'admin_request_headers', response_headers: 'admin_response_headers', path_schema: 'NoBody', query_schema: 'NoBody', body_schema: 'FeaturedModelsSaveRequest', response_schema: 'HomeDraftResponse', status: 200 },
  { method: 'GET', path: '/admin/v2/public-content/home-preview', role: 'root', request_headers: 'admin_request_headers', response_headers: 'admin_preview_response_headers', path_schema: 'NoBody', query_schema: 'PreviewRequest', body_schema: 'NoBody', response_schema: 'HomeDraftResponse', status: 200 },
  { method: 'GET', path: '/admin/v2/public-content/releases/{guid}/home-config', role: 'root', request_headers: 'admin_request_headers', response_headers: 'admin_response_headers', path_schema: 'GUIDRequest', query_schema: 'NoBody', body_schema: 'NoBody', response_schema: 'HomeConfigPublicResponse', status: 200 },
  { method: 'GET', path: '/admin/v2/public-content/documents-draft', role: 'root', request_headers: 'admin_request_headers', response_headers: 'admin_response_headers', path_schema: 'NoBody', query_schema: 'NoBody', body_schema: 'NoBody', response_schema: 'DocumentsDraftResponse', status: 200 },
  { method: 'PUT', path: '/admin/v2/public-content/documents-draft', role: 'root', request_headers: 'admin_request_headers', response_headers: 'admin_response_headers', path_schema: 'NoBody', query_schema: 'NoBody', body_schema: 'DocumentsDraftSaveRequest', response_schema: 'DocumentsDraftResponse', status: 200 },
]

const frozenNewSchemaNames = [
  'null',
  'rfc3339_utc',
  'AnnouncementDraft',
  'FAQDraft',
  'HomeDraftResponse',
  'DocumentsDraftResponse',
  'AnnouncementCreateRequest',
  'AnnouncementUpdateRequest',
  'AnnouncementDeleteRequest',
  'FAQCreateRequest',
  'FAQUpdateRequest',
  'FAQDeleteRequest',
  'FeaturedModelsSaveRequest',
  'DocumentsDraftSaveRequest',
  'HomeConfigPublicAnnouncement',
  'HomeConfigPublicFAQ',
  'HomeConfigPublicResponse',
]

function assertIndependentFreeze(contract) {
  assert.equal(contract.version, 'v2')
  assert.equal(contract.status, 'implemented_locally_pending_acceptance')

  const routeIdentities = contract.routes.map(route => `${route.method} ${route.path}`).sort()
  assert.equal(routeIdentities.length, 48)
  assert.equal(new Set(routeIdentities).size, 48)
  assert.equal(stableHash(routeIdentities), 'e9f1951dedd3534722580cfa556edeaaac8f474e4efa5e9e5f9dac9fe589fc04')
  assert.equal(stableHash(contract.routes.slice(0, 35).map(routeTuple)), 'cb3b0bd4f327484fbba0a17297ac640f1120e7243b131705d0dea2515cdb2dcf')
  assert.deepEqual(contract.routes.slice(35).map(routeTuple), frozenNewRoutes)
  assert.deepEqual(contract.pending_implementation_routes, [])

  const stableModelKey = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[a-z](?:[a-z0-9]|-[a-z0-9])*$' }
  for (const schemaName of ['PublicModelVisible', 'PublicModelRedacted', 'PublicModelAdmin', 'CreatePublicModelRequest']) {
    assert.deepEqual(contract.schemas[schemaName].properties.model_key, stableModelKey)
  }
  assert.deepEqual(contract.schemas.PublicModelDetailRequest.properties.modelKey, stableModelKey)
  for (const schemaName of ['HomeDraftResponse', 'FeaturedModelsSaveRequest', 'HomeConfigPublicResponse']) {
    assert.deepEqual(contract.schemas[schemaName].properties.featured_model_keys.items, stableModelKey)
  }

  const legacySchemaNames = referencedSchemaNames(contract, contract.routes.slice(0, 35))
  assert.equal(legacySchemaNames.length, 42)
  assert.equal(
    stableHash(selectedProperties(contract.schemas, legacySchemaNames)),
    '092f07c941c681ffcd7c1307c3c227d91904b4dcc7fb0000900ab99434f4535e',
  )
  assert.equal(
    stableHash(selectedProperties(contract.schemas, frozenNewSchemaNames)),
    'e455130e9f979a193e134ca8851418f90ee4d96a6d522aab3f53095dce031e87',
  )

  const positiveRevision = { type: 'integer', minimum: 1 }
  const guid = { type: 'string', format: 'positive-int64' }
  const effectiveAt = { one_of: ['null', 'rfc3339_utc'] }
  const sortOrder = { type: 'integer', minimum: 0, maximum: 1000000 }
  const announcement = contract.schemas.AnnouncementDraft
  assert.deepEqual(announcement.required, ['guid', 'title', 'body_markdown', 'effective_at', 'is_visible', 'sort_order'])
  assert.deepEqual(announcement.properties.guid, guid)
  assert.deepEqual(announcement.properties.title, { type: 'string', minLength: 1, maxLength: 120 })
  assert.deepEqual(announcement.properties.body_markdown, { type: 'string', maxBytes: 16384 })
  assert.deepEqual(announcement.properties.effective_at, effectiveAt)
  assert.deepEqual(announcement.properties.is_visible, { type: 'boolean' })
  assert.deepEqual(announcement.properties.sort_order, sortOrder)

  const faq = contract.schemas.FAQDraft
  assert.deepEqual(faq.required, ['guid', 'question', 'answer_markdown', 'is_visible', 'sort_order'])
  assert.deepEqual(faq.properties.guid, guid)
  assert.deepEqual(faq.properties.question, { type: 'string', minLength: 1, maxLength: 200 })
  assert.deepEqual(faq.properties.answer_markdown, { type: 'string', maxBytes: 16384 })
  assert.deepEqual(faq.properties.is_visible, { type: 'boolean' })
  assert.deepEqual(faq.properties.sort_order, sortOrder)

  const home = contract.schemas.HomeDraftResponse
  assert.deepEqual(home.required, ['revision', 'announcements', 'faqs', 'featured_model_keys'])
  assert.deepEqual(home.properties.revision, positiveRevision)
  assert.deepEqual(selectedProperties(home.properties.announcements, ['type', 'maxItems']), { type: 'array', maxItems: 20 })
  assert.deepEqual(selectedProperties(home.properties.faqs, ['type', 'maxItems']), { type: 'array', maxItems: 50 })
  assert.deepEqual(selectedProperties(home.properties.featured_model_keys, ['type', 'maxItems', 'uniqueItems']), { type: 'array', maxItems: 12, uniqueItems: true })

  const documents = contract.schemas.DocumentsDraftResponse
  assert.deepEqual(documents.required, ['revision', 'about', 'terms', 'privacy', 'legal_reviewed'])
  assert.deepEqual(documents.properties.revision, positiveRevision)
  assert.equal('home' in documents.properties, false)

  const newWriteRoutes = frozenNewRoutes.filter(route => ['POST', 'PATCH', 'PUT', 'DELETE'].includes(route.method))
  for (const route of newWriteRoutes) {
    const request = contract.schemas[route.body_schema]
    assert.ok(request.required.includes('expected_revision'), `${route.method} ${route.path} expected_revision`)
    assert.deepEqual(request.properties.expected_revision, positiveRevision)
    assert.equal(contract.mutation_requirements.expected_revision_routes.filter(value => value === `${route.method} ${route.path}`).length, 1)
  }
  assert.deepEqual(contract.schemas.AnnouncementCreateRequest.properties.title, announcement.properties.title)
  assert.deepEqual(contract.schemas.AnnouncementCreateRequest.properties.body_markdown, announcement.properties.body_markdown)
  assert.deepEqual(contract.schemas.AnnouncementCreateRequest.properties.effective_at, effectiveAt)
  assert.deepEqual(contract.schemas.AnnouncementUpdateRequest.properties.sort_order, sortOrder)
  assert.deepEqual(contract.schemas.FAQCreateRequest.properties.question, faq.properties.question)
  assert.deepEqual(contract.schemas.FAQCreateRequest.properties.answer_markdown, faq.properties.answer_markdown)
  assert.deepEqual(contract.schemas.FAQUpdateRequest.properties.sort_order, sortOrder)
  assert.deepEqual(contract.schemas.FeaturedModelsSaveRequest.properties.featured_model_keys, home.properties.featured_model_keys)
  assert.deepEqual(contract.schemas.DocumentsDraftSaveRequest.required, ['expected_revision', 'about', 'terms', 'privacy', 'legal_reviewed'])

  assert.deepEqual(contract.admin_draft_delete_response_headers, {
    'Cache-Control': 'no-store',
    'X-Request-ID': 'required_non_empty',
    'X-Content-Draft-Revision': 'required_positive_integer',
  })

  const publicHome = contract.schemas.HomeConfigPublicResponse
  assert.deepEqual(publicHome.required, ['announcements', 'faqs', 'featured_model_keys', 'content_release_version', 'price_release_version'])
  assert.deepEqual(selectedProperties(publicHome.properties.announcements, ['type', 'maxItems']), { type: 'array', maxItems: 20 })
  assert.deepEqual(selectedProperties(publicHome.properties.faqs, ['type', 'maxItems']), { type: 'array', maxItems: 50 })
  assert.deepEqual(selectedProperties(publicHome.properties.featured_model_keys, ['type', 'maxItems', 'uniqueItems']), { type: 'array', maxItems: 12, uniqueItems: true })
  assert.deepEqual(publicHome.properties.content_release_version, positiveRevision)
  assert.deepEqual(publicHome.properties.price_release_version, positiveRevision)
}

function assertFrozenContract(frontend, backend) {
  const imported = frontend.public_content_pricing
  assert.ok(imported, 'missing_frontend_public_content_pricing_contract')
  assertIndependentFreeze(imported)
  assert.deepEqual(imported.routes.map(routeTuple), backend.routes.map(routeTuple))

  const schemaNames = referencedSchemaNames(backend)
  assert.deepEqual(referencedSchemaNames(imported), schemaNames)
  assert.deepEqual(selectedProperties(imported.schemas, schemaNames), selectedProperties(backend.schemas, schemaNames))

  const headerNames = [...new Set(backend.routes.flatMap(route => [route.request_headers, route.response_headers]))].sort()
  assert.deepEqual(selectedProperties(imported, headerNames), selectedProperties(backend, headerNames))
  assert.deepEqual(imported.body_rules, backend.body_rules)
  assert.deepEqual(imported.errors, backend.errors)
  assert.deepEqual(imported, backend)
}

test('public pricing contract requires the explicit backend path', () => {
  assert.throws(() => requireBackendContractPath({}), /missing_PUBLIC_PRICING_BACKEND_CONTRACT/)
  assert.equal(requireBackendContractPath({ PUBLIC_PRICING_BACKEND_CONTRACT: '/explicit/contract.json' }), '/explicit/contract.json')
})

test('invalid explicit backend path fails safely', async () => {
  await assert.rejects(readJSON(missingContractPath), error => error?.code === 'ENOENT')
})

test('malformed explicit backend contract fails safely', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'public-pricing-contract-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'malformed.json')
  await writeFile(path, '{"routes":[')
  await assert.rejects(readJSON(path), SyntaxError)
})

test('frontend public pricing contract matches every frozen backend route and reachable DTO', async () => {
  const backendPath = requireBackendContractPath()
  const [frontend, backend] = await Promise.all([readJSON(frontendContractURL), readJSON(backendPath)])
  assertFrozenContract(frontend, backend)
})

test('one_of schema-name unions are reachable while literal enums are not references', async () => {
  const backend = await readJSON(requireBackendContractPath())
  const schemaNames = referencedSchemaNames(backend)
  assert.equal(schemaNames.length, 59)
  assert.ok(schemaNames.includes('PublicModelRedacted'))
  assert.ok(schemaNames.includes('PublicCatalogFacets'))
  assert.ok(schemaNames.includes('AnnouncementDraft'))
  assert.ok(schemaNames.includes('FAQDraft'))
  assert.ok(schemaNames.includes('HomeConfigPublicResponse'))

  const missingUnionMember = structuredClone(backend)
  delete missingUnionMember.schemas.PublicModelRedacted
  assert.throws(
    () => referencedSchemaNames(missingUnionMember),
    /missing_schema:PublicModelRedacted/,
  )

  const literalEnum = structuredClone(backend)
  literalEnum.schemas.PublicModelVisible.properties.price_visibility.enum.push('PublicModelRedacted')
  assert.deepEqual(referencedSchemaNames(literalEnum), schemaNames)
})

test('public pricing invariants and existing SSE contract remain fixed', async () => {
  const backendPath = requireBackendContractPath()
  const [frontend, backend] = await Promise.all([readJSON(frontendContractURL), readJSON(backendPath)])
  const imported = frontend.public_content_pricing

  assert.deepEqual(imported.pricing, backend.pricing)
  assert.deepEqual(imported.pricing.components, ['input', 'output'])
  assert.equal(imported.pricing.currency, 'USD')
  assert.equal(imported.pricing.unit, 'million_tokens')
  assert.equal(imported.pricing.billing_semantics, 'references_only_no_automatic_charge')

  const mutations = imported.routes.filter(route => !['GET', 'HEAD', 'OPTIONS'].includes(route.method))
  assert.ok(mutations.length > 0)
  assert.ok(mutations.every(route => route.role === 'root'))
  assert.equal(imported.roles.root, 'authenticated_root_role_required')
  assert.equal(imported.deletion.deleted_list_endpoint, 'absent')
  assert.ok(!imported.routes.some(route => /deleted|restore/.test(route.path) && route.path.includes('public-models')))
  assert.equal(imported.errors.statuses['404'], 'unknown_or_never_published_public_model_or_missing_resource')
  assert.equal(imported.errors.statuses['410'], 'previously_published_inactive_or_deleted_public_model')

  assert.equal(stableHash(frontend.interfaces), '1361943f74067d7b8e4917a84fcb489aa45994a15d0de206b1b6b60a69c5bfc9')
  assert.equal(stableHash(frontend.sse_events), '915154b364c1dcfdb9ede6ce0d5bba2f24a3a6648440f64cfb2ffe2e0db55fd3')
  assert.equal(stableHash(frontend.sse_rules), '948ce9031eb7e08afb7a653a24048c7137845f970d31c8fa95db21ced9bb9427')
})

test('route, DTO, header, status, and error drift probes are rejected', async () => {
  const backendPath = requireBackendContractPath()
  const backend = await readJSON(backendPath)
  for (const mutate of [
    contract => { contract.public_content_pricing.routes[0].status = 201 },
    contract => { contract.public_content_pricing.schemas.Error.properties.code.type = 'integer' },
    contract => { contract.public_content_pricing.schemas.PublicModelRedacted.required.pop() },
    contract => { contract.public_content_pricing.public_response_headers.ETag = 'optional' },
    contract => { contract.public_content_pricing.errors.statuses['410'] = 'gone' },
  ]) {
    const frontend = { public_content_pricing: structuredClone(backend) }
    mutate(frontend)
    assert.throws(() => assertFrozenContract(frontend, backend), assert.AssertionError)
  }
})

test('coordinated frontend and backend drift is rejected by the independent freeze', async () => {
  const frozen = await readJSON(requireBackendContractPath())
  for (const mutate of [
    contract => { contract.routes[35].status = 201 },
    contract => { contract.routes[35].response_headers = 'admin_response_headers' },
    contract => { contract.schemas.AnnouncementDraft.properties.body_markdown.maxBytes = 32768 },
    contract => { contract.routes[0] = structuredClone(contract.routes[1]) },
  ]) {
    const backend = structuredClone(frozen)
    const frontend = { public_content_pricing: structuredClone(frozen) }
    mutate(backend)
    mutate(frontend.public_content_pricing)
    assert.throws(() => assertFrozenContract(frontend, backend), assert.AssertionError)
  }
})
