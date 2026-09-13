import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const rule = (source, selector, property, value, message) => {
  assert.match(source, new RegExp(`${selector}[^\\{]*\\{[^\\}]*${property}:\\s*${value}\\s*;`, 's'), message)
}

const tokens = read('./tokens.scss')
const foundations = read('./foundations.scss')
const global = read('./global.scss')
const publicShell = read('./public-shell.scss')
const publicContent = read('./public-content.scss')
const consoleShell = read('./console-shell.scss')
const consolePages = read('./console-pages.scss')
const publicPricing = read('./public-pricing.scss')

test('semantic typography tokens keep the approved exact pixel scale', () => {
  const expected = {
    xs: '11px',
    sm: '12px',
    body: '14px',
    subtitle: '16px',
    'page-title': '20px',
    'section-title': '30px',
    hero: '44px',
    'hero-mobile': '34px',
  }
  for (const [name, value] of Object.entries(expected)) {
    assert.match(tokens, new RegExp(`--font-size-${name}:\\s*${value}\\s*;`), `--font-size-${name} must remain ${value}`)
  }
})

test('foundations and global components map body, page and component text to semantic tokens', () => {
  rule(foundations, 'body', 'font-size', 'var\\(--font-size-body\\)', 'body text uses the body token')
  rule(global, '\\.page-title', 'font-size', 'var\\(--font-size-page-title\\)', 'page titles use the page-title token')
  rule(global, '\\.el-dialog', '--el-dialog-title-font-size', 'var\\(--font-size-subtitle\\)', 'dialog titles use the subtitle token')
  rule(global, '\\.el-alert', '--el-alert-title-font-size', 'var\\(--font-size-sm\\)', 'alert titles use the small token')
  assert.match(global, /@media\s*\(max-width:\s*768px\)[\s\S]*?\.page-title\s*\{[^}]*font-size:\s*var\(--font-size-page-title\)/, 'mobile page titles keep the semantic page-title mapping')
})

test('public pages map hero, section and supporting copy to the shared typography scale', () => {
  rule(publicShell, '\\.public-brand', 'font-size', 'var\\(--font-size-subtitle\\)', 'public brand uses subtitle text')
  rule(publicShell, '\\.public-hero h1', 'font-size', 'var\\(--font-size-hero\\)', 'desktop hero uses the hero token')
  rule(publicShell, '\\.public-lead', 'font-size', 'var\\(--font-size-subtitle\\)', 'lead copy uses the subtitle token')
  rule(publicShell, '\\.public-eyebrow', 'font-size', 'var\\(--font-size-sm\\)', 'eyebrows use the small token')
  rule(publicContent, '\\.public-content-section__heading h2', 'font-size', 'var\\(--font-size-section-title\\)', 'public section headings use the section-title token')
  assert.match(publicShell, /@media\s*\(max-width:\s*767px\)[\s\S]*?\.public-hero h1\s*\{[^}]*font-size:\s*var\(--font-size-hero-mobile\)/, 'mobile hero uses the hero-mobile token')
  rule(publicPricing, '\\.pricing-heading h1', 'font-size', 'var\\(--font-size-section-title\\)', 'pricing headings use the section-title token')
  rule(publicPricing, '\\.pricing-heading p', 'font-size', 'var\\(--font-size-body\\)', 'pricing supporting copy uses the body token')
})

test('console surfaces map brand, navigation, headings and statuses to semantic tokens', () => {
  rule(consoleShell, '\\.app-brand__copy strong', 'font-size', 'var\\(--font-size-subtitle\\)', 'console brand uses subtitle text')
  rule(consoleShell, '\\.app-brand__copy small', 'font-size', 'var\\(--font-size-xs\\)', 'console brand detail uses extra-small text')
  rule(consoleShell, '\\.token-stat', 'font-size', 'var\\(--font-size-sm\\)', 'token stats use small text')
  rule(consoleShell, '\\.console-sidebar__group', 'font-size', 'var\\(--font-size-xs\\)', 'sidebar group labels use extra-small text')
  rule(consoleShell, '\\.page-header h1', 'font-size', 'var\\(--font-size-page-title\\)', 'console headings use the page-title token')
  rule(consoleShell, '\\.page-header__eyebrow', 'font-size', 'var\\(--font-size-sm\\)', 'console eyebrows use small text')
  rule(consoleShell, '\\.page-header__description', 'font-size', 'var\\(--font-size-body\\)', 'console descriptions use body text')
  rule(consoleShell, '\\.status-badge', 'font-size', 'var\\(--font-size-sm\\)', 'status badges use small text')
  rule(consolePages, '\\.auth-brand h1', 'font-size', 'var\\(--font-size-page-title\\)', 'auth headings use the page-title token')
})

test('typography stays at real size and interactive controls retain 44px targets', () => {
  const typographySurfaces = [tokens, foundations, global, publicShell, publicContent, consoleShell, consolePages, publicPricing].join('\n')
  assert.doesNotMatch(typographySurfaces, /\bzoom\s*:/i)
  assert.doesNotMatch(typographySurfaces, /\btransform\s*:[^;{}]*\bscale(?:x|y|3d)?\s*\(/i)
  assert.match(tokens, /--control-min-size:\s*44px\s*;/)
  rule(publicShell, '\\.public-locale', 'min-height', 'var\\(--control-min-size\\)', 'public header controls keep the shared touch target')
  rule(publicShell, '\\.public-button', 'min-height', 'var\\(--control-min-size\\)', 'public actions keep the shared touch target')
  rule(consoleShell, '\\.user-trigger', 'min-height', 'var\\(--control-min-size\\)', 'console user control keeps the shared touch target')
  assert.match(publicPricing, /min-height:\s*(?:44px|var\(--control-min-size\))\s*;/, 'pricing controls retain at least a 44px target')
})
