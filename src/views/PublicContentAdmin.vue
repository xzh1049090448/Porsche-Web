<template>
  <main ref="heading" class="page console-page public-content-admin" tabindex="-1">
    <PageHeader eyebrow="ROOT" :title="t('publicContentAdmin.title')" :description="t('publicContentAdmin.description')">
      <template #actions><StatusBadge v-if="busy || revision" :status="busy ? 'pending' : 'active'" :label="status" /><button type="button" :disabled="busy" @click="load">{{ t('publicContentAdmin.refresh') }}</button></template>
    </PageHeader>
    <p class="status" aria-live="polite">{{ status }}</p>
    <section v-if="error" class="error" role="alert">{{ errorText }}<span v-if="error.requestId"> · {{ error.requestId }}</span></section>
    <template v-if="ready">
      <nav class="tabs" :aria-label="t('publicContentStructuredAdmin.homeNavigation')"><button v-for="section in homeSections" :key="section" type="button" :aria-current="activeHomeSection === section ? 'page' : undefined" @click="activeHomeSection = section">{{ t(`publicContentStructuredAdmin.homeSections.${section}`) }}</button></nav>
      <AnnouncementEditor v-show="activeHomeSection === 'announcements'" data-editor="announcement" :items="homeDraft.announcements" :busy="busy" :labels="announcementLabels" @create="createAnnouncement" @update="updateAnnouncement" @remove="deleteAnnouncement" @move="moveAnnouncement" />
      <FaqEditor v-show="activeHomeSection === 'faqs'" data-editor="faq" :items="homeDraft.faqs" :busy="busy" :labels="faqLabels" @create="createFAQ" @update="updateFAQ" @remove="deleteFAQ" @move="moveFAQ" />
      <FeaturedModelSelector v-show="activeHomeSection === 'featuredModels'" data-editor="featured-models" :selected="homeDraft.featuredModelKeys" :results="modelResults" :search="modelSearch" :searching="searching" :busy="busy" :labels="featuredLabels" @search="searchModels" @save="saveFeaturedModels" @move="moveFeaturedModel" />
      <SurfaceCard class="document-editor" aria-labelledby="document-editor-title">
        <h2 id="document-editor-title">{{ t('publicContentStructuredAdmin.documentEditor') }}</h2>
        <nav class="tabs" :aria-label="t('publicContentStructuredAdmin.documentNavigation')"><button v-for="name in documentNames" :key="name" type="button" :aria-current="activeDocument === name ? 'page' : undefined" @click="activeDocument = name">{{ t(`publicContentAdmin.documents.${name}`) }}</button></nav>
        <SafeMarkdownEditor :id="`content-${activeDocument}`" v-model="documentsDraft[activeDocument]" :label="t(`publicContentAdmin.documents.${activeDocument}`)" :help="t('publicContentAdmin.markdownHelp')" />
        <label class="review"><input v-model="documentsDraft.legalReviewed" type="checkbox">{{ t('publicContentAdmin.legalReviewed') }}</label>
        <button type="button" :disabled="busy" @click="saveDocuments">{{ t('publicContentStructuredAdmin.saveDocuments') }}</button>
      </SurfaceCard>
      <SurfaceCard class="task11-disabled" data-task11-disabled aria-labelledby="task11-disabled-title"><h2 id="task11-disabled-title">{{ t('publicContentStructuredAdmin.releaseTools') }}</h2><p>{{ t('publicContentStructuredAdmin.releaseToolsDisabled') }}</p><div class="actions"><button type="button" disabled>{{ t('publicContentAdmin.preview') }}</button><button type="button" disabled>{{ t('publicContentAdmin.validate') }}</button><button type="button" disabled>{{ t('publicContentAdmin.publish') }}</button></div></SurfaceCard>
    </template>
    <SurfaceCard v-if="conflictBuffer" class="conflict" aria-labelledby="conflict-title"><h2 id="conflict-title">{{ t('publicContentStructuredAdmin.conflictTitle') }}</h2><p>{{ t('publicContentStructuredAdmin.conflictHelp') }}</p><div class="conflict-columns"><section><h3>{{ t('publicContentStructuredAdmin.localVersion') }}</h3><pre>{{ formatConflict(conflictBuffer.local) }}</pre></section><section><h3>{{ t('publicContentStructuredAdmin.serverVersion') }}</h3><pre>{{ formatConflict(conflictBuffer.server) }}</pre></section></div></SurfaceCard>
  </main>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue'
import { useRouter } from 'vue-router'
import { publicHomeContentAdminApi } from '@/api/publicHomeContentAdmin.js'
import { publicModelAdminApi } from '@/api/publicModelAdmin.js'
import { useI18n } from '@/composables/useI18n'
import { useUserStore } from '@/stores/user'
import AnnouncementEditor from '@/components/public-admin/AnnouncementEditor.vue'
import FaqEditor from '@/components/public-admin/FaqEditor.vue'
import FeaturedModelSelector from '@/components/public-admin/FeaturedModelSelector.vue'
import SafeMarkdownEditor from '@/components/public-admin/SafeMarkdownEditor.vue'
import PageHeader from '@/components/shell/PageHeader.vue'
import SurfaceCard from '@/components/shell/SurfaceCard.vue'
import StatusBadge from '@/components/shell/StatusBadge.vue'

const documentNames=['about','terms','privacy']
const homeSections=['announcements','faqs','featuredModels']
const { t } = useI18n(), router = useRouter(), userStore = useUserStore()
const heading = ref(null), homeDraft = ref(null), documentsDraft = ref(null), revision = ref(null), busy = ref(false), error = ref(null), validationProof = ref(null), conflictBuffer = ref(null)
const activeHomeSection = ref('announcements'), activeDocument = ref('about'), modelSearch = ref(''), modelResults = ref([]), searching = ref(false)
let readController = new AbortController(), writeController = new AbortController(), searchController = new AbortController(), readGeneration = 0, writeGeneration = 0, searchGeneration = 0, privilegeGeneration = 0
const clone = value => value == null ? value : structuredClone(toRaw(value))
const ready = computed(() => homeDraft.value && documentsDraft.value && homeDraft.value.revision === documentsDraft.value.revision && revision.value === homeDraft.value.revision)
const status = computed(() => busy.value ? t('publicContentAdmin.loading') : revision.value ? t('publicContentAdmin.revision', { revision: revision.value }) : '')
const errorText = computed(() => t(`publicContentStructuredAdmin.errors.${error.value?.code || 'request_failed'}`))
const announcementLabels = computed(() => labels('announcements')), faqLabels = computed(() => labels('faqs')), featuredLabels = computed(() => labels('featuredModels'))
const ownsPrivilege = generation => generation === privilegeGeneration && userStore.user?.role === 'root'

function labels(section) {
  const keys = section === 'announcements' ? ['title','itemTitle','body','effectiveAt','timePlaceholder','sortOrder','visible','hidden','hide','show','add','limit','moveUp','moveDown','remove','confirmTitle','confirm','cancel'] : section === 'faqs' ? ['title','question','answer','sortOrder','visible','hidden','hide','show','add','limit','moveUp','moveDown','remove','confirmTitle','confirm','cancel'] : ['title','search','searching','add','remove','moveUp','moveDown']
  return Object.fromEntries(keys.map(key => [key, t(`publicContentStructuredAdmin.${section}.${key}`)]))
}
function safeError(value) { try { const code = Object.getOwnPropertyDescriptor(value, 'code')?.value, requestId = Object.getOwnPropertyDescriptor(value, 'requestId')?.value; return { code: typeof code === 'string' && /^[a-z_]{1,64}$/.test(code) ? code : 'request_failed', requestId: typeof requestId === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(requestId) ? requestId : null } } catch { return { code: 'request_failed', requestId: null } } }
function clearValidationProof() { validationProof.value = null }
watch(documentsDraft, clearValidationProof, { deep: true })

async function load() {
  if (userStore.user?.role !== 'root') return null
  readController.abort(); readController = new AbortController()
  const controller = readController, own = ++readGeneration, privilege = privilegeGeneration
  busy.value = true; error.value = null; homeDraft.value = null; documentsDraft.value = null; revision.value = null
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const [home, documents] = await Promise.all([publicHomeContentAdminApi.getHomeDraft({ signal: controller.signal }), publicHomeContentAdminApi.getDocumentsDraft({ signal: controller.signal })])
      if (own !== readGeneration || controller.signal.aborted || !ownsPrivilege(privilege)) return null
      if (home.revision !== documents.revision) continue
      homeDraft.value = clone(home); documentsDraft.value = clone(documents); revision.value = home.revision; clearValidationProof()
      return { home: homeDraft.value, documents: documentsDraft.value }
    }
    error.value = { code: 'revision_conflict', requestId: null }; return null
  } catch (caught) { if (own === readGeneration && !controller.signal.aborted && ownsPrivilege(privilege)) error.value = safeError(caught); return null }
  finally { if (own === readGeneration && ownsPrivilege(privilege)) busy.value = false }
}

async function mutate(kind, local, operation, { deletes = false } = {}) {
  if (busy.value || !ready.value || userStore.user?.role !== 'root') return null
  clearValidationProof(); writeController.abort(); writeController = new AbortController()
  const controller = writeController, own = ++writeGeneration, privilege = privilegeGeneration, localCopy = clone(local)
  busy.value = true; error.value = null
  try {
    const output = await operation(revision.value, controller.signal)
    if (own !== writeGeneration || controller.signal.aborted || !ownsPrivilege(privilege)) return null
    if (deletes) { revision.value = output; busy.value = false; await load() }
    else if (kind === 'documents') { documentsDraft.value = clone(output); revision.value = output.revision; homeDraft.value = { ...clone(homeDraft.value), revision: output.revision } }
    else { homeDraft.value = clone(output); revision.value = output.revision; documentsDraft.value = { ...clone(documentsDraft.value), revision: output.revision } }
    conflictBuffer.value = null; clearValidationProof(); return output
  } catch (caught) {
    if (own !== writeGeneration || controller.signal.aborted || !ownsPrivilege(privilege)) return null
    const normalized = safeError(caught); error.value = normalized
    if (normalized.code === 'revision_conflict') { conflictBuffer.value = { kind, local: localCopy, server: null }; busy.value = false; await load(); if (ownsPrivilege(privilege) && ready.value && conflictBuffer.value?.kind === kind) conflictBuffer.value = { ...conflictBuffer.value, server: { home: clone(homeDraft.value), documents: clone(documentsDraft.value) } } }
    return null
  } finally { if (own === writeGeneration && ownsPrivilege(privilege)) busy.value = false }
}

const withoutGuid = value => { const { guid: _guid, ...rest } = value; return rest }
const createAnnouncement = value => mutate('announcement', value, (expectedRevision, signal) => publicHomeContentAdminApi.createAnnouncement({ expectedRevision, ...value }, { signal }))
const updateAnnouncement = value => mutate('announcement', value, (expectedRevision, signal) => publicHomeContentAdminApi.updateAnnouncement(value.guid, { expectedRevision, ...withoutGuid(value) }, { signal }))
const deleteAnnouncement = guid => mutate('announcement', { guid }, (expectedRevision, signal) => publicHomeContentAdminApi.deleteAnnouncement(guid, expectedRevision, { signal }), { deletes: true })
const createFAQ = value => mutate('faq', value, (expectedRevision, signal) => publicHomeContentAdminApi.createFAQ({ expectedRevision, ...value }, { signal }))
const updateFAQ = value => mutate('faq', value, (expectedRevision, signal) => publicHomeContentAdminApi.updateFAQ(value.guid, { expectedRevision, ...withoutGuid(value) }, { signal }))
const deleteFAQ = guid => mutate('faq', { guid }, (expectedRevision, signal) => publicHomeContentAdminApi.deleteFAQ(guid, expectedRevision, { signal }), { deletes: true })
const saveFeaturedModels = keys => mutate('featuredModels', keys, (expectedRevision, signal) => publicHomeContentAdminApi.saveFeaturedModels(expectedRevision, keys, { signal }))
const saveDocuments = () => mutate('documents', documentsDraft.value, (expectedRevision, signal) => publicHomeContentAdminApi.saveDocumentsDraft({ expectedRevision, about: documentsDraft.value.about, terms: documentsDraft.value.terms, privacy: documentsDraft.value.privacy, legalReviewed: documentsDraft.value.legalReviewed }, { signal }))

function sortBetween(items, index, direction) { const target = index + direction; if (target < 0 || target >= items.length) return null; const before = direction < 0 ? items[index - 2]?.sortOrder : items[index + 1]?.sortOrder, after = direction < 0 ? items[index - 1].sortOrder : items[index + 2]?.sortOrder; if (direction < 0) { if (before === undefined) return after > 0 ? Math.floor(after / 2) : null; return after - before > 1 ? before + Math.floor((after - before) / 2) : null } if (after === undefined) return before < 1000000 ? Math.min(1000000, before + 10) : null; return after - before > 1 ? before + Math.floor((after - before) / 2) : null }
function moveItem(kind, guid, direction) { const items = kind === 'announcement' ? homeDraft.value.announcements : homeDraft.value.faqs, index = items.findIndex(item => item.guid === guid), sortOrder = sortBetween(items, index, direction); if (sortOrder === null) { error.value = { code: 'sort_gap_required', requestId: null }; return } const item = { ...items[index], sortOrder }; return kind === 'announcement' ? updateAnnouncement(item) : updateFAQ(item) }
const moveAnnouncement = ({ guid, direction }) => moveItem('announcement', guid, direction)
const moveFAQ = ({ guid, direction }) => moveItem('faq', guid, direction)
function moveFeaturedModel({ modelKey, direction }) { const keys = [...homeDraft.value.featuredModelKeys], index = keys.indexOf(modelKey), target = index + direction; if (index < 0 || target < 0 || target >= keys.length) return; [keys[index], keys[target]] = [keys[target], keys[index]]; return saveFeaturedModels(keys) }

async function searchModels(value) {
  modelSearch.value = value; searchController.abort(); searchController = new AbortController()
  const controller = searchController, own = ++searchGeneration, privilege = privilegeGeneration; modelResults.value = []
  if (!value.trim() || userStore.user?.role !== 'root') { searching.value = false; return }
  searching.value = true
  try { const output = await publicModelAdminApi.list({ search: value, status: 'active', upstreamState: 'present', completeness: 'complete', page: 1, pageSize: 20 }, { signal: controller.signal }); if (own !== searchGeneration || controller.signal.aborted || !ownsPrivilege(privilege)) return; modelResults.value = output.items.map(model => ({ ...model, upstreamState: 'present', completeness: 'complete' })) }
  catch (caught) { if (own === searchGeneration && !controller.signal.aborted && ownsPrivilege(privilege)) error.value = safeError(caught) }
  finally { if (own === searchGeneration && ownsPrivilege(privilege)) searching.value = false }
}

function clearPrivilegedState() { readGeneration++; writeGeneration++; searchGeneration++; privilegeGeneration++; readController.abort(); writeController.abort(); searchController.abort(); homeDraft.value = null; documentsDraft.value = null; revision.value = null; validationProof.value = null; conflictBuffer.value = null; modelSearch.value = ''; modelResults.value = []; searching.value = false; busy.value = false; error.value = null }
watch(() => userStore.user?.role, role => { if (role !== 'root') { clearPrivilegedState(); void router.replace?.('/chat') } }, { flush: 'sync' })
function formatConflict(value) { return value === null ? t('publicContentAdmin.loading') : JSON.stringify(value, null, 2) }
onMounted(() => { heading.value?.focus(); void load() })
onBeforeUnmount(clearPrivilegedState)
</script>
