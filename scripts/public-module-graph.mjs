import { relative, sep } from 'node:path'

function sanitizeModuleId(id, root) {
  const clean = id.replace(/^\0+/, '').split('?')[0]
  const nodeModules = clean.lastIndexOf(`${sep}node_modules${sep}`)
  if (nodeModules >= 0) return clean.slice(nodeModules + 1).split(sep).join('/')
  if (clean === root || clean.startsWith(`${root}${sep}`)) return relative(root, clean).split(sep).join('/')
  return clean.startsWith('/') ? `external/${clean.split(sep).at(-1)}` : `virtual/${clean}`
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
