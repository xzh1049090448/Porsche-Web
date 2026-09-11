import test from 'node:test'
import assert from 'node:assert/strict'
import { getItem, removeItem, setItem } from './storage.js'

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

function restoreStorage() {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage)
  else delete globalThis.localStorage
}

test.afterEach(restoreStorage)

test('storage helpers resolve localStorage inside their safety boundary', () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new DOMException('storage blocked', 'SecurityError') },
  })

  assert.equal(getItem('locale', 'zh'), 'zh')
  assert.equal(setItem('locale', 'en'), false)
  assert.equal(removeItem('locale'), false)
})

test('storage helpers tolerate missing storage and throwing methods', () => {
  delete globalThis.localStorage
  assert.equal(getItem('locale', 'zh'), 'zh')
  assert.equal(setItem('locale', 'en'), false)
  assert.equal(removeItem('locale'), false)

  const broken = {
    getItem() { throw new Error('read denied') },
    setItem() { throw new Error('quota exceeded') },
    removeItem() { throw new Error('delete denied') },
  }
  assert.equal(getItem('locale', 'zh', broken), 'zh')
  assert.equal(setItem('locale', 'en', broken), false)
  assert.equal(removeItem('locale', broken), false)
})

test('storage helpers retain JSON and prefix semantics with explicit storage', () => {
  const values = new Map()
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  }

  assert.equal(getItem('locale', 'zh', storage), 'zh')
  assert.equal(setItem('locale', 'en', storage), true)
  assert.equal(values.get('llm_platform_locale'), JSON.stringify('en'))
  assert.equal(getItem('locale', 'zh', storage), 'en')
  values.set('llm_platform_locale', '{broken')
  assert.equal(getItem('locale', 'zh', storage), 'zh')
  assert.equal(removeItem('locale', storage), true)
  assert.equal(values.has('llm_platform_locale'), false)
})

test('storage tests restore the original localStorage descriptor', () => {
  assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), originalStorage)
})
