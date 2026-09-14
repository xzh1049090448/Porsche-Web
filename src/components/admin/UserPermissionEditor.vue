<script>
import { ADMIN_CAPABILITIES, ADMIN_CAPABILITY_DEFINITIONS } from '../../api/admin-users.js'

const CANONICAL_CAPABILITIES = Object.freeze([...ADMIN_CAPABILITIES])
const CANONICAL_DEFINITIONS = Object.freeze(ADMIN_CAPABILITY_DEFINITIONS.map(item => Object.freeze({ ...item })))
export const PERMISSION_EDITOR_MODULES = Object.freeze([
  Object.freeze({ key: 'users', label: '用户管理' }),
  Object.freeze({ key: 'groups', label: '分组管理' }),
  Object.freeze({ key: 'public_content', label: '公共内容' }),
])

const EFFECTS = new Set(['inherit', 'allow', 'deny'])
const WIRE_EFFECTS = new Set(['allow', 'deny'])
const MAX_INT64 = '9223372036854775807'
const GUID = /^[1-9]\d{0,18}$/
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const validDecimal = value => typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)
  && (value.length < MAX_INT64.length || value.length === MAX_INT64.length && value <= MAX_INT64)
const validGuid = value => typeof value === 'string' && GUID.test(value)
  && (value.length < MAX_INT64.length || value <= MAX_INT64)
const invalidModel = () => Object.freeze({ valid: false, rows: Object.freeze([]), groups: Object.freeze([]) })

function catalogDefinitions(catalog) {
  if (!exactKeys(catalog, ['catalog_version', 'override_effects', 'capabilities']) || catalog.catalog_version !== 1
      || !Array.isArray(catalog.override_effects) || catalog.override_effects.join('\0') !== 'inherit\0allow\0deny'
      || !Array.isArray(catalog.capabilities) || catalog.capabilities.length !== CANONICAL_CAPABILITIES.length) return null
  const definitions = catalog.capabilities.map((item, index) => exactKeys(item, ['name', 'admin_default', 'grantable', 'root_only', 'available'])
      && item.name === CANONICAL_CAPABILITIES[index]
      && ['admin_default', 'grantable', 'root_only', 'available'].every(key => typeof item[key] === 'boolean')
      && item.admin_default === CANONICAL_DEFINITIONS[index].baseline
      && item.grantable === CANONICAL_DEFINITIONS[index].grantable
      && item.root_only === CANONICAL_DEFINITIONS[index].rootOnly
      && item.available === CANONICAL_DEFINITIONS[index].available
    ? Object.freeze({ name: item.name, baseline: item.admin_default, grantable: item.grantable, rootOnly: item.root_only, available: item.available })
    : null)
  return definitions.some(item => item === null) ? null : Object.freeze(definitions)
}

function validPolicy(policy, catalog) {
  if (!exactKeys(policy, ['user_guid', 'role', 'status', 'catalog_version', 'permissions_version', 'capabilities'])
      || !validGuid(policy.user_guid) || policy.role !== 'admin' || !['active', 'disabled'].includes(policy.status)
      || policy.catalog_version !== 1 || typeof policy.permissions_version !== 'string'
      || !validDecimal(policy.permissions_version)
      || !Array.isArray(policy.capabilities) || policy.capabilities.length !== catalog.length) return false
  return policy.capabilities.every((item, index) => {
    const definition = catalog[index]
    if (!exactKeys(item, ['name', 'baseline', 'override', 'policy_effective', 'effective'])
        || item.name !== definition.name || item.baseline !== definition.baseline || !EFFECTS.has(item.override)
        || typeof item.policy_effective !== 'boolean' || typeof item.effective !== 'boolean'
        || (item.override === 'allow' && !definition.grantable)) return false
    const policyEffective = !definition.available || definition.rootOnly ? false
      : item.override === 'deny' ? false : item.override === 'allow' ? true : definition.baseline
    return item.policy_effective === policyEffective && item.effective === (policy.status === 'active' && policyEffective)
  })
}

function wireOverrides(modelValue, catalog) {
  if (!Array.isArray(modelValue)) return null
  const indexByName = new Map(catalog.map((item, index) => [item.name, index]))
  const seen = new Set()
  const result = []
  for (const item of modelValue) {
    if (!exactKeys(item, ['capability', 'effect']) || typeof item.capability !== 'string' || !WIRE_EFFECTS.has(item.effect)) return null
    const folded = item.capability.toLocaleLowerCase('en-US')
    if (seen.has(folded)) return null
    seen.add(folded)
    const index = indexByName.get(item.capability)
    if (index === undefined) return null
    const definition = catalog[index]
    if (!definition.available || (item.effect === 'allow' && (!definition.grantable || definition.rootOnly))) return null
    result.push({ capability: item.capability, effect: item.effect, index })
  }
  result.sort((left, right) => left.index - right.index)
  return result
}

export function buildPermissionEditorModel(catalog, policy, modelValue) {
  const definitions = catalogDefinitions(catalog)
  if (!definitions || !validPolicy(policy, definitions)) return invalidModel()
  const overrides = wireOverrides(modelValue, definitions)
  if (!overrides) return invalidModel()
  const overrideByName = new Map(overrides.map(item => [item.capability, item.effect]))
  const rows = definitions.map(definition => {
    const override = overrideByName.get(definition.name) ?? 'inherit'
    const policyEffective = !definition.available || definition.rootOnly ? false
      : override === 'deny' ? false : override === 'allow' ? true : definition.baseline
    return Object.freeze({
      name: definition.name,
      baseline: definition.baseline,
      override,
      policyEffective,
      effective: policy.status === 'active' && policyEffective,
      source: override === 'inherit' ? 'baseline' : `override_${override}`,
      grantable: definition.grantable,
      rootOnly: definition.rootOnly,
      available: definition.available,
      locked: !definition.grantable || !definition.available,
    })
  })
  const groups = PERMISSION_EDITOR_MODULES.map(module => Object.freeze({
    ...module,
    rows: Object.freeze(rows.filter(row => row.name.startsWith(`${module.key}.`))),
  }))
  if (groups.reduce((total, group) => total + group.rows.length, 0) !== rows.length) return invalidModel()
  return Object.freeze({ valid: true, rows: Object.freeze(rows), groups: Object.freeze(groups) })
}
</script>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  catalog: { type: Object, required: true },
  policy: { type: Object, required: true },
  modelValue: { type: Array, required: true },
})
const emit = defineEmits(['update:modelValue'])
const editor = computed(() => buildPermissionEditorModel(props.catalog, props.policy, props.modelValue))

function update(capability, effect) {
  const row = editor.value.rows.find(item => item.name === capability)
  if (!editor.value.valid || !row || row.locked || !EFFECTS.has(effect)) return
  const next = new Map(props.modelValue.map(item => [item.capability, item.effect]))
  if (effect === 'inherit') next.delete(capability)
  else next.set(capability, effect)
  const emitted = editor.value.rows.flatMap(item => next.has(item.name)
    ? [{ capability: item.name, effect: next.get(item.name) }]
    : [])
  emit('update:modelValue', emitted)
}
</script>

<template>
  <div class="permission-editor">
    <p v-if="!editor.valid" class="permission-editor__error" role="alert">
      权限数据无效，请刷新后重试。
    </p>
    <section
      v-for="group in editor.groups"
      v-else
      :key="group.key"
      class="permission-editor__module"
      :aria-labelledby="`permission-module-${group.key}`"
    >
      <h3 :id="`permission-module-${group.key}`">{{ group.label }}</h3>
      <div
        v-for="row in group.rows"
        :key="row.name"
        class="permission-editor__row"
        :data-capability="row.name"
      >
        <div class="permission-editor__identity">
          <code>{{ row.name }}</code>
          <span :id="`permission-meta-${row.name}`">
            基线：{{ row.baseline ? '允许' : '拒绝' }}；
            生效：{{ row.effective ? '允许' : '拒绝' }}；
            来源：{{ row.source === 'baseline' ? '继承基线' : row.source === 'override_allow' ? '显式允许' : '显式拒绝' }}
          </span>
          <span v-if="row.rootOnly">Root 专属</span>
          <span v-else-if="!row.available">暂不可用</span>
        </div>
        <el-radio-group
          :model-value="row.override"
          :disabled="row.locked"
          :aria-label="`${row.name} 权限覆盖`"
          :aria-describedby="`permission-meta-${row.name}`"
          @update:model-value="effect => update(row.name, effect)"
        >
          <el-radio-button value="inherit">继承</el-radio-button>
          <el-radio-button value="allow">允许</el-radio-button>
          <el-radio-button value="deny">拒绝</el-radio-button>
        </el-radio-group>
      </div>
    </section>
  </div>
</template>

<style scoped>
.permission-editor { display: grid; gap: 16px; }
.permission-editor__module { display: grid; gap: 8px; }
.permission-editor__module h3 { margin: 0; font-size: var(--font-size-subtitle); }
.permission-editor__row { display: grid; grid-template-columns: minmax(260px, 1fr) auto; align-items: center; gap: 16px; padding: 10px 0; border-bottom: 1px solid var(--el-border-color-lighter); }
.permission-editor__identity { display: grid; gap: 4px; min-width: 0; }
.permission-editor__identity span { color: var(--el-text-color-secondary); font-size: 12px; }
.permission-editor__error { margin: 0; color: var(--el-color-danger); }
@media (max-width: 720px) { .permission-editor__row { grid-template-columns: 1fr; } }
</style>
