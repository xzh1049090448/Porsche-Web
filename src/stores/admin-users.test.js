import test from 'node:test'
import assert from 'node:assert/strict'
import { reactive } from 'vue'
import { isCurrentAdminUserDetail } from './admin-users.js'

test('Root catalog follow-up recognizes the selected detail through a Vue proxy', () => {
  const detail = { guid: '356078883456212993', role: 'user', status: 'active', authVersion: 1 }
  const state = reactive({ selected: null })

  state.selected = detail

  assert.notEqual(state.selected, detail)
  assert.equal(isCurrentAdminUserDetail(state.selected, detail), true)
  assert.equal(isCurrentAdminUserDetail(state.selected, { ...detail }), false)
})
