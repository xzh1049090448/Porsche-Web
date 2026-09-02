import test from 'node:test'
import assert from 'node:assert/strict'
import { copyText } from './clipboard.js'

// Node has no DOM: this models only the browser boundary used by the utility.
function browserEnvironment(result = true) {
  const children = []
  const range = { cloneRange() { return this } }
  const selection = {
    ranges: [range], get rangeCount() { return this.ranges.length },
    getRangeAt(index) { return this.ranges[index] },
    removeAllRanges() { this.ranges = [] }, addRange(value) { this.ranges.push(value) },
  }
  const container = { appendChild(node) { children.push(node); node.parentNode = this } }
  const document = {
    body: container, getSelection: () => selection,
    createElement(tag) {
      assert.equal(tag, 'textarea')
      return {
        style: {}, value: '', setAttribute() {},
        focus() { document.activeElement = this },
        select() { this.selectionStart = 0; this.selectionEnd = this.value.length; selection.removeAllRanges() },
        remove() { children.splice(children.indexOf(this), 1) },
      }
    },
    execCommand(command) {
      assert.equal(command, 'copy')
      const node = document.activeElement
      assert.equal(node.value, 'dummy-secret')
      assert.equal(node.selectionStart, 0)
      assert.equal(node.selectionEnd, node.value.length)
      if (result instanceof Error) throw result
      return result
    },
  }
  const input = {
    selectionStart: 2, selectionEnd: 5, selectionDirection: 'backward',
    closest: () => container,
    focus() { document.activeElement = this },
    setSelectionRange(start, end, direction) { Object.assign(this, { selectionStart: start, selectionEnd: end, selectionDirection: direction }) },
  }
  document.activeElement = input
  return { document, navigator: {}, children, input, selection, range }
}

test('native clipboard success does not create fallback DOM', async () => {
  const env = browserEnvironment()
  env.navigator.clipboard = { async writeText(text) { assert.equal(text, 'dummy-secret') } }
  env.document.createElement = () => assert.fail('native success must not fall back')
  assert.equal(await copyText('dummy-secret', env), true)
})

for (const native of ['missing', 'rejected']) {
  test(`${native} native clipboard falls back and restores focus and selections`, async () => {
    const env = browserEnvironment()
    if (native === 'rejected') env.navigator.clipboard = { async writeText() { throw new Error('denied') } }
    assert.equal(await copyText('dummy-secret', env), true)
    assert.equal(env.children.length, 0)
    assert.equal(env.document.activeElement, env.input)
    assert.deepEqual([env.input.selectionStart, env.input.selectionEnd, env.input.selectionDirection], [2, 5, 'backward'])
    assert.deepEqual(env.selection.ranges, [env.range])
  })
}

for (const result of [false, new Error('unsupported')]) {
  test(`fallback ${result === false ? 'false' : 'throw'} returns false and cleans up`, async () => {
    const env = browserEnvironment(result)
    assert.equal(await copyText('dummy-secret', env), false)
    assert.equal(env.children.length, 0)
    assert.equal(env.document.activeElement, env.input)
    assert.deepEqual(env.selection.ranges, [env.range])
  })
}

test('empty input never attempts either clipboard path', async () => {
  const env = browserEnvironment()
  env.navigator.clipboard = { writeText() { assert.fail('empty copy') } }
  env.document.createElement = () => assert.fail('empty fallback')
  for (const text of ['', '   ', null, undefined]) assert.equal(await copyText(text, env), false)
})

test('fallback uses the active dialog rather than the document body', async () => {
  const env = browserEnvironment()
  env.document.body = { appendChild() { assert.fail('outside dialog focus trap') } }
  assert.equal(await copyText('dummy-secret', env), true)
})

test('missing document or fallback API returns false', async () => {
  assert.equal(await copyText('dummy-secret', { navigator: {} }), false)
  const env = browserEnvironment()
  delete env.document.execCommand
  assert.equal(await copyText('dummy-secret', env), false)
  assert.equal(env.children.length, 0)
})

test('a cancelled native request cannot start a late fallback', async () => {
  const env = browserEnvironment()
  const controller = new AbortController()
  env.signal = controller.signal
  let reject
  env.navigator.clipboard = { writeText() { return new Promise((_resolve, fail) => { reject = fail }) } }
  env.document.createElement = () => assert.fail('closed dialog must not start a fallback')
  const pending = copyText('dummy-secret', env)
  controller.abort()
  // The native API itself cannot be cancelled, only its fallback and UI result.
  reject(new Error('late permission denial'))
  assert.equal(await pending, false)
})

test('restoration failure does not change the confirmed copy result or leak the temporary node', async () => {
  const env = browserEnvironment()
  env.input.focus = () => { throw new Error('source no longer focusable') }
  assert.equal(await copyText('dummy-secret', env), true)
  assert.equal(env.children.length, 0)
})

test('input selection is restored after document ranges which may reset its caret', async () => {
  const env = browserEnvironment()
  env.selection.addRange = (range) => {
    env.selection.ranges.push(range)
    env.input.setSelectionRange(0, 0, 'none')
  }
  assert.equal(await copyText('dummy-secret', env), true)
  assert.deepEqual([env.input.selectionStart, env.input.selectionEnd, env.input.selectionDirection], [2, 5, 'backward'])
})

test('an explicit dialog-content container takes precedence over an outer dialog role', async () => {
  const env = browserEnvironment()
  env.container = { ownerDocument: env.document, isConnected: true, appendChild(node) { env.children.push(node) } }
  env.input.closest = () => ({ appendChild() { assert.fail('outer overlay is outside the focus trap') } })
  assert.equal(await copyText('dummy-secret', env), true)
  assert.equal(env.children.length, 0)
})

for (const foreign of [false, true]) {
  test(`fallback rejects a ${foreign ? 'foreign-document' : 'detached'} explicit container`, async () => {
    const env = browserEnvironment()
    env.container = {
      ownerDocument: foreign ? {} : env.document, isConnected: foreign,
      appendChild(node) { env.children.push(node) },
    }
    assert.equal(await copyText('dummy-secret', env), false)
    assert.equal(env.children.length, 0)
  })
}
