import test from 'node:test'
import assert from 'node:assert/strict'
import { exportToPdf } from './export.js'

test('PDF export escapes untrusted conversation text before document.write', () => {
  let written = ''
  const previousWindow = globalThis.window
  globalThis.window = {
    open() {
      return {
        document: {
          write(value) { written = value },
          close() {},
        },
      }
    },
  }

  try {
    exportToPdf({
      title: '</title><script>window.opener.localStorage.token</script>',
      messages: [{ role: 'user" onmouseover="alert(1)', content: '<img src=x onerror=alert(1)>\n</div><script>alert(2)</script>' }],
    })
  } finally {
    globalThis.window = previousWindow
  }

  assert.doesNotMatch(written, /<(?:script|img)\b/)
  assert.doesNotMatch(written, /class="msg [^"]*"\s+on\w+=/)
  assert.match(written, /&lt;script&gt;alert\(2\)&lt;\/script&gt;/)
  assert.match(written, /&lt;img src=x onerror=alert\(1\)&gt;/)
})
