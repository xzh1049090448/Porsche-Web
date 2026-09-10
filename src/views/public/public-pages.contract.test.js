import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8')

test('public shell and homepage preserve the published-content contract', () => {
  const layout = source('../../layouts/PublicLayout.vue')
  const home = source('./Home.vue')
  const header = source('../../components/public/PublicHeader.vue')
  const footer = source('../../components/public/PublicFooter.vue')
  assert.match(layout, /<PublicHeader/)
  assert.match(layout, /<PublicFooter/)
  assert.deepEqual([...home.matchAll(/data-section="([^"]+)"/g)].map(match => match[1]), ['hero', 'advantages', 'models', 'announcements-faq', 'cta'])
  assert.match(home, /演示|demo/i)
  assert.match(home, /releaseVersion/)
  assert.match(home, /localStorage/)
  assert.match(home, /to=["']\/chat["']/)
  assert.doesNotMatch(`${layout}${home}${header}${footer}`, /href=["']#["']/)
  assert.doesNotMatch(`${layout}${home}${header}${footer}`, /(?:>|['"])(?:40\+|100%|MIT|永久免费)(?:<|['"])/)
})

test('about and legal pages expose safe published states and metadata', () => {
  const about = source('./About.vue')
  const legal = source('./LegalPage.vue')
  const state = source('../../components/public/PublicContentState.vue')
  assert.match(about, /loadPage\(['"]about['"]\)/)
  assert.match(legal, /version/)
  assert.match(legal, /effectiveDate/)
  assert.match(legal, /table-of-contents|目录/)
  assert.match(legal, /DOMPurify/)
  assert.match(legal, /marked/)
  assert.match(state, /loading/)
  assert.match(state, /preparing/)
  assert.match(state, /empty/)
  assert.match(state, /error/)
  assert.match(state, /retry/)
  assert.match(`${about}${legal}`, /<h1/)
})

test('public pages are lazy routes and styles cover themes, breakpoints and reduced motion', () => {
  const router = source('../../router/index.js')
  const global = source('../../styles/global.scss')
  const mobile = source('../../styles/mobile.scss')
  assert.match(router, /import\(['"]@\/views\/public\/Home\.vue['"]\)/)
  assert.match(router, /import\(['"]@\/views\/public\/About\.vue['"]\)/)
  assert.match(router, /import\(['"]@\/views\/public\/LegalPage\.vue['"]\)/)
  assert.match(global, /--public-primary:\s*#2563eb/i)
  assert.match(global, /prefers-color-scheme:\s*dark/)
  assert.match(global, /prefers-reduced-motion:\s*reduce/)
  assert.match(mobile, /max-width:\s*767px/)
  assert.match(mobile, /min-width:\s*768px/)
  assert.match(mobile, /min-width:\s*1280px/)
})
