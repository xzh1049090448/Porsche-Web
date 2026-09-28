import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8')

test('anonymous bootstrap has no static Element Plus, all-icons, or authenticated global styles', () => {
  assert.doesNotMatch(main, /^import ElementPlus/m)
  assert.doesNotMatch(main, /^import \* as ElementPlusIconsVue/m)
  assert.doesNotMatch(main, /^import ['"]element-plus\/dist\/index\.css['"]/m)
  assert.doesNotMatch(main, /^import ['"]\.\/styles\/(?:global|mobile)\.scss['"]/m)
  assert.match(main, /bootstrapApplication\(\{/)
  assert.match(main, /loadAuthApp,/)
  assert.match(main, /recover,/)
  assert.match(main, /import\('element-plus'\)/)
  assert.match(main, /import\('@element-plus\/icons-vue'\)/)
  assert.match(main, /import\('element-plus\/dist\/index\.css'\)/)
  assert.match(main, /import router, \{[^}]*bootstrapModeForPath[^}]*\} from '\.\/router'/)
  assert.doesNotMatch(main, /createAppRouter\(/)
})
