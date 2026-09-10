import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const outputDir = resolve(process.argv[2] || 'dist')
const manifest = JSON.parse(readFileSync(resolve(outputDir, '.vite/manifest.json'), 'utf8'))
const publicLayoutKey = Object.keys(manifest).find(key => key.endsWith('/PublicLayout.vue'))
if (!publicLayoutKey) throw new Error('missing PublicLayout.vue manifest entry')

const entryKey = Object.keys(manifest).find(key => manifest[key].isEntry)
if (!entryKey) throw new Error('missing production entry manifest record')

function staticFiles(key, seen = new Set()) {
  if (seen.has(key)) return seen
  seen.add(key)
  for (const imported of manifest[key]?.imports || []) staticFiles(imported, seen)
  return seen
}

const publicFiles = new Set([...staticFiles(entryKey), ...staticFiles(publicLayoutKey)])
const forbidden = [
  ['admin-users', /admin-users/],
  ['users.create', /users\.create/],
  ['users.delete', /users\.delete/],
  ['action-verifications', /action-verifications/],
]

for (const key of publicFiles) {
  const file = manifest[key]?.file
  if (!file) continue
  const source = readFileSync(resolve(outputDir, file), 'utf8')
  for (const [label, pattern] of forbidden) {
    if (pattern.test(source)) throw new Error(`public chunk ${file} contains protected marker ${label}`)
  }
}

process.stdout.write(`public chunk boundary verified across ${publicFiles.size} manifest records\n`)
