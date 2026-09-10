import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PUBLIC_LOCAL_MODULES = new Set([
  'repo:index.html',
  'repo:src/main.js',
  'repo:src/App.vue',
  'repo:src/bootstrap-app.js',
  'repo:src/router/index.js',
  'repo:src/utils/auth-redirect.js',
  'repo:src/layouts/PublicLayout.vue',
  'repo:src/styles/public-bootstrap.css',
])
const PUBLIC_RUNTIME_PACKAGES = /^npm:(?:vue|vue-router|@vue\/(?:reactivity|runtime-core|runtime-dom|shared))(?:\/|$)/
const PUBLIC_VIRTUAL_MODULES = new Set([
  'virtual:plugin-vue:export-helper',
  'virtual:vite/modulepreload-polyfill.js',
  'virtual:vite/preload-helper.js',
])
const MAX_PUBLIC_CODE_BYTES = 200_000
const MAX_PUBLIC_CSS_BYTES = 20_000

function closure(chunks, roots) {
  const files = new Set()
  const visit = file => {
    if (files.has(file)) return
    if (!chunks[file]) throw new Error(`missing imported chunk ${file}`)
    files.add(file)
    for (const imported of chunks[file].imports || []) visit(imported)
  }
  roots.forEach(visit)
  return files
}

export function validatePublicGraph(graph) {
  if (graph?.version !== 1 || !graph.chunks || typeof graph.chunks !== 'object') throw new Error('invalid public module graph')
  const records = Object.entries(graph.chunks)
  const entry = records.find(([, chunk]) => chunk.isEntry)?.[0]
  const publicLayout = records.find(([, chunk]) => chunk.modules?.includes('repo:src/layouts/PublicLayout.vue'))?.[0]
  if (!entry || !publicLayout) throw new Error('missing entry or PublicLayout module')
  const files = closure(graph.chunks, [entry, publicLayout])
  let codeBytes = 0
  let cssBytes = 0
  for (const file of files) {
    const chunk = graph.chunks[file]
    codeBytes += chunk.codeBytes || 0
    cssBytes += chunk.cssBytes || 0
    for (const moduleId of chunk.modules || []) {
      if (PUBLIC_LOCAL_MODULES.has(moduleId) || PUBLIC_RUNTIME_PACKAGES.test(moduleId) || PUBLIC_VIRTUAL_MODULES.has(moduleId)) continue
      throw new Error(`non-public module ${moduleId}`)
    }
  }
  if (codeBytes > MAX_PUBLIC_CODE_BYTES) throw new Error(`public JavaScript budget exceeded: ${codeBytes} > ${MAX_PUBLIC_CODE_BYTES}`)
  if (cssBytes > MAX_PUBLIC_CSS_BYTES) throw new Error(`public CSS budget exceeded: ${cssBytes} > ${MAX_PUBLIC_CSS_BYTES}`)
  return { chunkCount: files.size, codeBytes, cssBytes }
}

export function validatePublicBuild(outputDir = 'dist') {
  const graph = JSON.parse(readFileSync(resolve(outputDir, 'public-module-graph.json'), 'utf8'))
  return validatePublicGraph(graph)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const result = validatePublicBuild(process.argv[2] || 'dist')
  process.stdout.write(`public module graph verified: ${result.chunkCount} chunks, ${result.codeBytes} JS bytes, ${result.cssBytes} CSS bytes\n`)
}
