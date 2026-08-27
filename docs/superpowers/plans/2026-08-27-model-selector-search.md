# Model Selector Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one local search input that filters both the single-model and compare-mode model lists without changing authorization or selection.

**Architecture:** A pure matcher filters server-authorized dynamic catalog metadata. `ModelPanel.vue` owns a temporary query and renders the same computed list in both controls; the settings store remains the selection source.

**Tech Stack:** Vue 3, Element Plus, Node test runner, Vite.

---

### Task 1: Add a pure local matcher

**Files:**
- Create: `src/utils/model-search.js`
- Create: `src/utils/model-search.test.js`

- [ ] **Step 1: Write failing tests**

```js
test('filterModels matches all searchable fields', () => {
  assert.deepEqual(filterModels(models, 'glm').map((m) => m.id), ['zai-org/glm-5.1'])
  assert.deepEqual(filterModels(models, 'V4-PRO').map((m) => m.id), ['deepseek/deepseek-v4-pro'])
  assert.deepEqual(filterModels(models, 'zai').map((m) => m.id), ['zai-org/glm-5.1'])
  assert.deepEqual(filterModels(models, 'reasoning').map((m) => m.id), ['deepseek/deepseek-v4-pro'])
})

test('filterModels copies all models for blank search without mutation', () => {
  const result = filterModels(models, '  ')
  assert.deepEqual(result, models)
  assert.notEqual(result, models)
})
```

- [ ] **Step 2: Verify RED**

Run `node --test src/utils/model-search.test.js` from `/Users/xuzhihao/code/Porsche-Web`. Expected: module-not-found failure.

- [ ] **Step 3: Implement the matcher**

```js
function normalized(value) {
  return typeof value === 'string' ? value.toLocaleLowerCase() : ''
}

export function filterModels(models, query) {
  const source = Array.isArray(models) ? models : []
  const needle = normalized(query).trim()
  if (!needle) return [...source]
  return source.filter((model) => [model?.name, model?.id, model?.vendor, model?.desc]
    .some((field) => normalized(field).includes(needle)))
}
```

The matcher must not mutate models, selections, storage, or backend state.

- [ ] **Step 4: Verify GREEN and commit**

Run `node --test src/utils/model-search.test.js`. Then commit `src/utils/model-search.js` and `src/utils/model-search.test.js` with message `feat: add local model catalog search`.

### Task 2: Render one shared filtered list in ModelPanel

**Files:**
- Modify: `src/components/chat/ModelPanel.vue`
- Modify: `src/i18n/messages.js`
- Modify: `src/utils/model-search.test.js`

- [ ] **Step 1: Add a failing component contract test**

```js
test('ModelPanel shares filtered models between controls', () => {
  const source = readFileSync(new URL('../components/chat/ModelPanel.vue', import.meta.url), 'utf8')
  assert.equal((source.match(/v-for="m in filteredModels"/g) || []).length, 2)
  assert.match(source, /v-model="searchTerm"/)
  assert.doesNotMatch(source, /setItem\(['"]modelSearch/)
})
```

- [ ] **Step 2: Verify RED**

Run `node --test src/utils/model-search.test.js`. Expected: existing loops use `settings.models`.

- [ ] **Step 3: Implement input, computed result, and empty states**

Import `ref` and `filterModels`, then add:

```js
const searchTerm = ref('')
const filteredModels = computed(() => filterModels(settings.models, searchTerm.value))
```

Place this under the title:

```vue
<el-input v-model="searchTerm" clearable class="model-search"
  :placeholder="t('model.searchPlaceholder')" :aria-label="t('model.searchAria')" />
```

Replace both model loops with `v-for="m in filteredModels"`. For a nonblank query with zero matches render `el-empty` using `t('model.searchEmpty')` in both relevant lists. Add Chinese and English `model.searchPlaceholder`, `model.searchAria`, and `model.searchEmpty` translations. Add `.model-search { margin: 0 0 12px; }`. Do not clear selected IDs, persist search text, change ACLs, or alter the existing three-model limit.

- [ ] **Step 4: Verify GREEN and commit**

Run `node --test src/utils/model-search.test.js`. Commit `ModelPanel.vue`, `messages.js`, and the test with message `feat: search models in chat selector`.

### Task 3: Verify and record evidence

**Files:**
- Modify: `progress.md`
- Modify: `feature_list.json`

- [ ] **Step 1: Run complete frontend checks**

From `/Users/xuzhihao/code/Porsche-Web`, run `npm test`, `npm run build`, and `git diff --check`. Expected: all pass; retain existing Vite warnings only as warnings.

- [ ] **Step 2: Local UI smoke**

Use the standard `init.sh` startup path. Verify one query filters both lists, clearing restores all models, no result shows the localized empty state, and selected compare IDs plus maximum-three enforcement remain unchanged.

- [ ] **Step 3: Record evidence and commit**

Update tracker evidence only after checks pass, preserving unrelated white-label upstream smoke as `in_progress`. Commit `progress.md` and `feature_list.json` with message `docs: record model search verification`.

## Plan self-review

- The matcher covers name, ID, vendor, description, case-insensitivity, blank input, and non-mutation.
- Both controls use one computed filtered list; search remains component-local and cannot alter authorization or compare limits.
- Model data stays in Vue text bindings; no HTML, token, or error sink is introduced.
