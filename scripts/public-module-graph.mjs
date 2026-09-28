import { createHash } from 'node:crypto'
import { basename, relative, sep } from 'node:path'

const KNOWN_VIRTUAL_IDS = new Set([
  'plugin-vue:export-helper',
  'vite/modulepreload-polyfill.js',
  'vite/preload-helper.js',
])
const KNOWN_PUBLIC_ROOT_ASSETS = new Set(['/logo.png'])

function opaqueId(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

function sanitizeModuleId(id, root) {
  if (KNOWN_PUBLIC_ROOT_ASSETS.has(id)) return `public:${id}`
  const clean = id.replace(/^\0+/, '').split('?')[0]
  const nodeModules = clean.lastIndexOf(`${sep}node_modules${sep}`)
  if (nodeModules >= 0) return `npm:${clean.slice(nodeModules + `${sep}node_modules${sep}`.length).split(sep).join('/')}`
  if (clean === root || clean.startsWith(`${root}${sep}`)) return `repo:${relative(root, clean).split(sep).join('/')}`
  if (KNOWN_VIRTUAL_IDS.has(clean)) return `virtual:${clean}`
  const kind = clean.startsWith('/') ? 'external' : 'virtual-unknown'
  return `${kind}:${opaqueId(clean)}:${basename(clean)}`
}

export function publicModuleGraphPlugin() {
  let root = process.cwd()
  return {
    name: 'public-module-graph',
    configResolved(config) { root = config.root },
    generateBundle(_options, bundle) {
      const chunks = {}
      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type !== 'chunk') continue
        let cssBytes = 0
        for (const cssFile of output.viteMetadata?.importedCss || []) {
          const asset = bundle[cssFile]
          if (asset?.type === 'asset') cssBytes += Buffer.byteLength(String(asset.source))
        }
        chunks[fileName] = {
          isEntry: output.isEntry,
          imports: [...output.imports],
          modules: [...new Set(Object.keys(output.modules).map(id => sanitizeModuleId(id, root)))].sort(),
          codeBytes: Buffer.byteLength(output.code),
          cssBytes,
        }
      }
      this.emitFile({ type: 'asset', fileName: 'public-module-graph.json', source: JSON.stringify({ version: 1, chunks }, null, 2) })
    },
  }
}
