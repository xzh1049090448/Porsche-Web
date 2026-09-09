import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const forbidden = ['A09_BALANCE_MOCK_DEMO_ONLY', '/demo/admin/balance', 'mock_balance_user']
async function files(root) {
  const entries = await readdir(root, { withFileTypes: true })
  const nested = await Promise.all(entries.map(entry => entry.isDirectory() ? files(join(root, entry.name)) : [join(root, entry.name)]))
  return nested.flat()
}
for (const path of await files(join(process.cwd(), 'dist'))) {
  const content = await readFile(path)
  const text = content.toString('utf8')
  for (const marker of forbidden) {
    if (text.includes(marker)) {
      process.stderr.write(`Production bundle contains development balance marker in ${path}.\n`)
      process.exit(1)
    }
  }
}
