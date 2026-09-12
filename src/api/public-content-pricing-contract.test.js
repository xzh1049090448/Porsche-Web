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

function referencedSchemaNames(contract) {
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
  for (const route of contract.routes) {
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

function assertFrozenContract(frontend, backend) {
  const imported = frontend.public_content_pricing
  assert.ok(imported, 'missing_frontend_public_content_pricing_contract')
  assert.equal(imported.routes.length, 35)
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
  assert.equal(schemaNames.length, 42)
  assert.ok(schemaNames.includes('PublicModelRedacted'))
  assert.ok(schemaNames.includes('PublicCatalogFacets'))

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

  assert.equal(stableHash(frontend.interfaces), 'ef23ddb25c2f1177bb4040dd95f6732e661d13a2f17b05a00932d52b89c71815')
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
