import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { JSDOM, ResourceLoader } from 'jsdom'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const indexPath = path.join(root, 'index.html')
const standardsPath = path.join(root, 'docs/conventions/frontend-standards.md')
const fixedScriptUrl = 'https://embed.tawk.to/6aba033429f257344364f946/1k3j9p1b0'
const tawkStart = '<!--Start of Tawk.to Script-->'
const tawkEnd = '<!--End of Tawk.to Script-->'

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(entryPath)
    if (!entry.isFile() || !/\.(?:js|vue)$/.test(entry.name) || entry.name.endsWith('.test.js')) return []
    return [entryPath]
  }))
  return files.flat()
}

test('root HTML owns the sole fixed Tawk entry after the app module and excludes visitor data', async () => {
  const html = await readFile(indexPath, 'utf8')
  const start = html.indexOf(tawkStart)
  const end = html.indexOf(tawkEnd)
  const moduleEntry = html.indexOf('<script type="module" src="/src/main.js"></script>')

  assert.equal(html.split(fixedScriptUrl).length - 1, 1, 'fixed Tawk URL appears exactly once')
  assert.notEqual(start, -1, 'official Tawk snippet start marker exists')
  assert.ok(end > start, 'official Tawk snippet end marker follows its start')
  assert.notEqual(moduleEntry, -1, 'Vite /src/main.js module entry exists')
  assert.ok(start > moduleEntry, 'Tawk snippet follows the /src/main.js module entry')
  assert.ok(end < html.indexOf('</body>'), 'Tawk snippet precedes the body end')

  const snippet = html.slice(start, end + tawkEnd.length)
  assert.match(snippet, /s1\.async\s*=\s*true/)
  assert.match(snippet, /s1\.charset\s*=\s*['"]UTF-8['"]|s1\.setAttribute\(['"]charset['"],\s*['"]UTF-8['"]\)/i)
  assert.match(snippet, /setAttribute\(['"]crossorigin['"],\s*['"]\*['"]\)/i)
  assert.doesNotMatch(snippet, /Tawk_API\.visitor|localStorage|document\.cookie/i)
})

test('production JavaScript and Vue source contains no Tawk embed URL', async () => {
  const files = await sourceFiles(path.join(root, 'src'))
  const matches = await Promise.all(files.map(async (file) => ({
    file,
    source: await readFile(file, 'utf8'),
  })))
  const offenders = matches.filter(({ source }) => source.includes('embed.tawk.to'))

  assert.deepEqual(offenders.map(({ file }) => file), [])
})

test('frontend standards define inherited Vue Router and independent HTML entry rules', async () => {
  const standards = await readFile(standardsPath, 'utf8')
  assert.match(standards, /Vue Router[^\n]*(?:自动继承|自动应用|继承)/)
  assert.match(standards, /(?:独立 HTML|独立入口)[^\n]*(?:契约|build|构建)/i)
})

test('JSDOM executes the inline bootstrap once and blocks external Tawk loading', async () => {
  const html = await readFile(indexPath, 'utf8')
  const requested = []
  class BlockingResourceLoader extends ResourceLoader {
    fetch(url) {
      requested.push(url)
      return null
    }
  }

  const dom = new JSDOM(html, {
    url: 'https://local.test/',
    runScripts: 'dangerously',
    resources: new BlockingResourceLoader(),
  })
  try {
    const scripts = [...dom.window.document.querySelectorAll('script')]
      .filter((script) => script.src === fixedScriptUrl)
    assert.equal(scripts.length, 1)
    assert.ok(dom.window.document.querySelector('#app'))
    assert.equal(dom.window.Tawk_API.visitor, undefined)
    assert.deepEqual(requested, [fixedScriptUrl])
  } finally {
    dom.window.close()
  }
})
