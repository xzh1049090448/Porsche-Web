<template>
  <main ref="heading" class="page console-page public-content-admin" tabindex="-1" @input.capture="onDraftInteraction" @change.capture="onDraftInteraction">
    <PageHeader eyebrow="ROOT" :title="t('publicContentAdmin.title')" :description="t('publicContentAdmin.description')">
      <template #actions><StatusBadge v-if="busy || revision" :status="busy ? 'pending' : 'active'" :label="status" /><button type="button" :disabled="busy" @click="load">{{ t('publicContentAdmin.refresh') }}</button></template>
    </PageHeader>
    <p class="status" aria-live="polite">{{ status }}</p>
    <section v-if="error" class="error" role="alert">{{ errorText }}<span v-if="error.requestId"> · {{ error.requestId }}</span></section>
    <template v-if="ready">
      <nav class="tabs" :aria-label="t('publicContentStructuredAdmin.homeNavigation')"><button v-for="section in homeSections" :key="section" type="button" :aria-current="activeHomeSection === section ? 'page' : undefined" @click="activeHomeSection = section">{{ t(`publicContentStructuredAdmin.homeSections.${section}`) }}</button></nav>
      <AnnouncementEditor v-show="activeHomeSection === 'announcements'" data-editor="announcement" :items="homeDraft.announcements" :busy="busy" :create-ack="announcementCreateAck" :labels="announcementLabels" @create="createAnnouncement" @update="updateAnnouncement" @remove="deleteAnnouncement" @move="moveAnnouncement" />
      <FaqEditor v-show="activeHomeSection === 'faqs'" data-editor="faq" :items="homeDraft.faqs" :busy="busy" :create-ack="faqCreateAck" :labels="faqLabels" @create="createFAQ" @update="updateFAQ" @remove="deleteFAQ" @move="moveFAQ" />
      <FeaturedModelSelector v-show="activeHomeSection === 'featuredModels'" data-editor="featured-models" :selected="homeDraft.featuredModelKeys" :results="modelResults" :search="modelSearch" :searching="searching" :busy="busy" :labels="featuredLabels" @search="searchModels" @save="saveFeaturedModels" @move="moveFeaturedModel" />
      <SurfaceCard class="document-editor" aria-labelledby="document-editor-title">
        <h2 id="document-editor-title">{{ t('publicContentStructuredAdmin.documentEditor') }}</h2>
        <nav class="tabs" :aria-label="t('publicContentStructuredAdmin.documentNavigation')"><button v-for="name in documentNames" :key="name" type="button" :aria-current="activeDocument === name ? 'page' : undefined" @click="activeDocument = name">{{ t(`publicContentAdmin.documents.${name}`) }}</button></nav>
        <SafeMarkdownEditor :id="`content-${activeDocument}`" v-model="documentsDraft[activeDocument]" :label="t(`publicContentAdmin.documents.${activeDocument}`)" :help="t('publicContentAdmin.markdownHelp')" />
        <label class="review"><input v-model="documentsDraft.legalReviewed" type="checkbox">{{ t('publicContentAdmin.legalReviewed') }}</label>
        <button type="button" :disabled="busy" @click="saveDocuments">{{ t('publicContentStructuredAdmin.saveDocuments') }}</button>
      </SurfaceCard>
      <SurfaceCard class="release-tools" data-task11-release-tools aria-labelledby="release-tools-title">
        <h2 id="release-tools-title">{{ t('publicContentStructuredAdmin.releaseTools') }}</h2>
        <label for="price-release-guid">{{ t('publicPricingAdmin.release') }}</label>
        <input id="price-release-guid" v-model.trim="priceReleaseGuid" inputmode="numeric" autocomplete="off">
        <div class="actions">
          <button type="button" :disabled="busy || !previewEnabled" data-action="preview" @click="openPreview">{{ t('publicContentAdmin.preview') }}</button>
          <button type="button" :disabled="busy || !ready" data-action="validate" @click="validateForPublication">{{ t('publicContentAdmin.validate') }}</button>
        </div>
        <ol v-if="validationResult?.issues?.length" class="validation-issues"><li v-for="issue in validationResult.issues" :key="`${issue.field}:${issue.code}`">{{ issue.field }} · {{ issue.code }}</li></ol>
        <label for="publish-password">{{ t('publicContentAdmin.password') }}</label>
        <input id="publish-password" v-model="publishPassword" data-publication-secret type="password" autocomplete="current-password">
        <button type="button" :disabled="busy || workflow.busy || !publishEnabled || !publishPassword" data-action="publish" @click="publishContent">{{ t('publicContentAdmin.publish') }}</button>
        <p v-if="workflow.pendingRecovery" role="status">{{ t('publicContentAdmin.pendingRecovery') }}</p>
      </SurfaceCard>
      <ContentReleaseHistory :items="historyItems" :total="historyTotal" :busy="workflow.busy || historyLoading" :restore-disabled="!ready" @restore="beginRestore" @more="loadMoreHistory" />
    </template>
    <SurfaceCard v-if="conflictBuffer" class="conflict" aria-labelledby="conflict-title"><h2 id="conflict-title">{{ t('publicContentStructuredAdmin.conflictTitle') }}</h2><p>{{ t('publicContentStructuredAdmin.conflictHelp') }}</p><div class="conflict-columns"><section><h3>{{ t('publicContentStructuredAdmin.localVersion') }}</h3><pre>{{ formatConflict(conflictBuffer.local) }}</pre></section><section><h3>{{ t('publicContentStructuredAdmin.serverVersion') }}</h3><pre>{{ formatConflict(conflictBuffer.server) }}</pre></section></div></SurfaceCard>
    <dialog ref="restoreDialog" aria-labelledby="restore-title" @cancel.prevent="cancelRestore" @close="restoreFocus"><h2 id="restore-title">{{ t('publicContentAdmin.restore') }}</h2><label for="restore-password">{{ t('publicContentAdmin.password') }}</label><input id="restore-password" v-model="restorePassword" data-publication-secret type="password" autocomplete="current-password"><div class="actions"><button type="button" @click="cancelRestore">{{ t('common.cancel') }}</button><button type="button" :disabled="workflow.busy || !restorePassword" data-action="confirm-restore" @click="confirmRestore">{{ t('publicContentAdmin.restore') }}</button></div></dialog>
  </main>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, toRaw, watch } from 'vue'
import { useRouter } from 'vue-router'
import { canonicalStructuredContent, createContentPublicationCoordinator, createStructuredContentValidationProof, publicContentAdminApi, structuredContentValidationProofMatches } from '@/api/publicContentAdmin.js'
import { publicHomeContentAdminApi } from '@/api/publicHomeContentAdmin.js'
import { publicModelAdminApi } from '@/api/publicModelAdmin.js'
import { publicPricingAdminApi } from '@/api/publicPricingAdmin.js'
import { validateStructuredPublicContent } from '@/utils/public-content-validation.js'
import { useI18n } from '@/composables/useI18n'
import { useUserStore } from '@/stores/user'
import AnnouncementEditor from '@/components/public-admin/AnnouncementEditor.vue'
import FaqEditor from '@/components/public-admin/FaqEditor.vue'
import FeaturedModelSelector from '@/components/public-admin/FeaturedModelSelector.vue'
import SafeMarkdownEditor from '@/components/public-admin/SafeMarkdownEditor.vue'
import PageHeader from '@/components/shell/PageHeader.vue'
import SurfaceCard from '@/components/shell/SurfaceCard.vue'
import StatusBadge from '@/components/shell/StatusBadge.vue'
import ContentReleaseHistory from '@/components/public-admin/ContentReleaseHistory.vue'

const documentNames=['about','terms','privacy']
const homeSections=['announcements','faqs','featuredModels']
const { t } = useI18n(), router = useRouter(), userStore = useUserStore()
const heading = ref(null), homeDraft = ref(null), documentsDraft = ref(null), revision = ref(null), busy = ref(false), error = ref(null), validationProof = ref(null), validationResult = ref(null), conflictBuffer = ref(null), savedCanonical = ref(null)
const activeHomeSection = ref('announcements'), activeDocument = ref('about'), modelSearch = ref(''), modelResults = ref([]), searching = ref(false)
const announcementCreateAck = ref(0), faqCreateAck = ref(0)
const priceReleaseGuid = ref(''), publishPassword = ref(''), restorePassword = ref(''), restoreTarget = ref(null), restoreDialog = ref(null), historyItems = ref([]), historyTotal = ref(0), historyLoading = ref(false)
const workflow = reactive({ busy:false,error:null,conflict:false,pendingRecovery:false,attempt:null })
const publicationCoordinator = createContentPublicationCoordinator({ api: publicContentAdminApi, state: workflow })
let readController = new AbortController(), writeController = new AbortController(), searchController = new AbortController(), validationController = new AbortController(), historyController = new AbortController(), readGeneration = 0, writeGeneration = 0, searchGeneration = 0, validationGeneration = 0, historyGeneration = 0, privilegeGeneration = 0
let restoreTrigger = null
const clone = value => value == null ? value : structuredClone(toRaw(value))
const ready = computed(() => homeDraft.value && documentsDraft.value && homeDraft.value.revision === documentsDraft.value.revision && revision.value === homeDraft.value.revision)
const status = computed(() => busy.value ? t('publicContentAdmin.loading') : revision.value ? t('publicContentAdmin.revision', { revision: revision.value }) : '')
const errorText = computed(() => t(`publicContentStructuredAdmin.errors.${error.value?.code || 'request_failed'}`))
const announcementLabels = computed(() => labels('announcements')), faqLabels = computed(() => labels('faqs')), featuredLabels = computed(() => labels('featuredModels'))
const ownsPrivilege = generation => generation === privilegeGeneration && userStore.user?.role === 'root'
const currentStructured = () => ({ revision: revision.value, documents: clone(documentsDraft.value), home: clone(homeDraft.value) })
const currentCanonical = () => canonicalStructuredContent(currentStructured())
const validPriceGuid = value => /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n
const previewEnabled = computed(() => { try { return ready.value && currentCanonical() === savedCanonical.value && validPriceGuid(priceReleaseGuid.value) } catch { return false } })
const publishEnabled = computed(() => { try { return previewEnabled.value && structuredContentValidationProofMatches(validationProof.value,currentStructured(),savedCanonical.value,priceReleaseGuid.value) } catch { return false } })

function labels(section) {
  const keys = section === 'announcements' ? ['title','itemTitle','body','effectiveAt','timePlaceholder','sortOrder','visible','hidden','hide','show','add','limit','moveUp','moveDown','edit','editItem','saveEdit','cancelEdit','remove','confirmTitle','confirm','cancel'] : section === 'faqs' ? ['title','question','answer','sortOrder','visible','hidden','hide','show','add','limit','moveUp','moveDown','edit','editItem','saveEdit','cancelEdit','remove','confirmTitle','confirm','cancel'] : ['title','search','searching','add','remove','moveUp','moveDown']
  return Object.fromEntries(keys.map(key => [key, t(`publicContentStructuredAdmin.${section}.${key}`)]))
}
function safeError(value) { try { const code = Object.getOwnPropertyDescriptor(value, 'code')?.value, requestId = Object.getOwnPropertyDescriptor(value, 'requestId')?.value; return { code: typeof code === 'string' && /^[a-z_]{1,64}$/.test(code) ? code : 'request_failed', requestId: typeof requestId === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(requestId) ? requestId : null } } catch { return { code: 'request_failed', requestId: null } } }
function clearValidationProof() { validationGeneration++; validationController.abort(); validationProof.value = null; validationResult.value = null }
function onDraftInteraction(event) { if (event?.target?.closest?.('[data-publication-secret]')) return; clearValidationProof() }
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
      homeDraft.value = clone(home); documentsDraft.value = clone(documents); revision.value = home.revision; clearValidationProof(); savedCanonical.value = currentCanonical()
      return { home: homeDraft.value, documents: documentsDraft.value }
    }
    error.value = { code: 'revision_conflict', requestId: null }; return null
  } catch (caught) { if (own === readGeneration && !controller.signal.aborted && ownsPrivilege(privilege)) error.value = safeError(caught); return null }
  finally { if (own === readGeneration && ownsPrivilege(privilege)) busy.value = false }
}

async function mutate(kind, local, operation, { deletes = false } = {}) {
  if (busy.value || workflow.busy || !ready.value || userStore.user?.role !== 'root') return null
  clearValidationProof(); writeController.abort(); writeController = new AbortController()
  const controller = writeController, own = ++writeGeneration, privilege = privilegeGeneration, localCopy = clone(local)
  busy.value = true; error.value = null
  try {
    const output = await operation(revision.value, controller.signal)
    if (own !== writeGeneration || controller.signal.aborted || !ownsPrivilege(privilege)) return null
    if (deletes) { revision.value = output; busy.value = false; await load() }
    else if (kind === 'documents') { documentsDraft.value = clone(output); revision.value = output.revision; homeDraft.value = { ...clone(homeDraft.value), revision: output.revision } }
    else { homeDraft.value = clone(output); revision.value = output.revision; documentsDraft.value = { ...clone(documentsDraft.value), revision: output.revision } }
    conflictBuffer.value = null; clearValidationProof(); savedCanonical.value = currentCanonical(); return output
  } catch (caught) {
    if (own !== writeGeneration || controller.signal.aborted || !ownsPrivilege(privilege)) return null
    const normalized = safeError(caught); error.value = normalized
    if (normalized.code === 'revision_conflict') { conflictBuffer.value = { kind, local: localCopy, server: null }; busy.value = false; await load(); if (ownsPrivilege(privilege) && ready.value && conflictBuffer.value?.kind === kind) conflictBuffer.value = { ...conflictBuffer.value, server: { home: clone(homeDraft.value), documents: clone(documentsDraft.value) } } }
    return null
  } finally { if (own === writeGeneration && ownsPrivilege(privilege)) busy.value = false }
}

const withoutGuid = value => { const { guid: _guid, ...rest } = value; return rest }
async function createAnnouncement(value) { const output = await mutate('announcement', value, (expectedRevision, signal) => publicHomeContentAdminApi.createAnnouncement({ expectedRevision, ...value }, { signal })); if (output) announcementCreateAck.value++; return output }
const updateAnnouncement = value => mutate('announcement', value, (expectedRevision, signal) => publicHomeContentAdminApi.updateAnnouncement(value.guid, { expectedRevision, ...withoutGuid(value) }, { signal }))
const deleteAnnouncement = guid => mutate('announcement', { guid }, (expectedRevision, signal) => publicHomeContentAdminApi.deleteAnnouncement(guid, expectedRevision, { signal }), { deletes: true })
async function createFAQ(value) { const output = await mutate('faq', value, (expectedRevision, signal) => publicHomeContentAdminApi.createFAQ({ expectedRevision, ...value }, { signal })); if (output) faqCreateAck.value++; return output }
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

async function validateForPublication() {
  if (!previewEnabled.value || userStore.user?.role !== 'root') return null
  clearValidationProof(); validationController = new AbortController()
  const controller = validationController, own = ++validationGeneration, privilege = privilegeGeneration
  let snapshot, canonical, target
  try { snapshot = currentStructured(); canonical = canonicalStructuredContent(snapshot); target = priceReleaseGuid.value }
  catch { error.value = { code: 'validation_failed', requestId: null }; return null }
  busy.value = true; error.value = null
  try {
    const pricing = await publicPricingAdminApi.getRelease(target, { signal: controller.signal })
    if (own !== validationGeneration || controller.signal.aborted || !ownsPrivilege(privilege) || target !== priceReleaseGuid.value || canonical !== currentCanonical()) return null
    const local = validateStructuredPublicContent(snapshot, { priceRelease: pricing, priceReleaseGuid: target })
    if (!local.valid) { validationResult.value = local; return null }
    const server = await publicContentAdminApi.validate(snapshot.revision, { signal: controller.signal })
    if (own !== validationGeneration || controller.signal.aborted || !ownsPrivilege(privilege) || target !== priceReleaseGuid.value || canonical !== currentCanonical() || canonical !== savedCanonical.value) return null
    validationResult.value = server
    if (!server.valid) return null
    validationProof.value = await createStructuredContentValidationProof(snapshot, target, { valid: true })
    if (own !== validationGeneration || controller.signal.aborted || !ownsPrivilege(privilege) || canonical !== currentCanonical() || target !== priceReleaseGuid.value) validationProof.value = null
    return validationProof.value
  } catch (caught) { if (own === validationGeneration && !controller.signal.aborted && ownsPrivilege(privilege)) error.value = safeError(caught); return null }
  finally { if (own === validationGeneration && ownsPrivilege(privilege)) busy.value = false }
}

function openPreview() {
  if (!previewEnabled.value) return
  const location = router.resolve?.({ path: '/admin/public-content/preview', query: { revision: String(revision.value), priceReleaseGuid: priceReleaseGuid.value } })?.href
  if (location) window.open(location, '_blank', 'noopener,noreferrer')
}

async function loadHistory({ append = false } = {}) {
  if (userStore.user?.role !== 'root') return null
  historyController.abort(); historyController = new AbortController()
  const controller = historyController, own = ++historyGeneration, privilege = privilegeGeneration
  historyLoading.value = true
  try { const page = append ? Math.floor(historyItems.value.length / 20) + 1 : 1, output = await publicContentAdminApi.listReleases({ page, pageSize:20, signal:controller.signal }); if (own !== historyGeneration || controller.signal.aborted || !ownsPrivilege(privilege)) return null; historyItems.value = append ? [...historyItems.value,...output.items] : [...output.items]; historyTotal.value = output.total; return output }
  catch (caught) { if (own === historyGeneration && !controller.signal.aborted && ownsPrivilege(privilege)) error.value = safeError(caught); return null }
  finally { if (own === historyGeneration && ownsPrivilege(privilege)) historyLoading.value = false }
}
const loadMoreHistory = () => loadHistory({ append:true })

async function publishContent() {
  if (!publishEnabled.value || workflow.busy || !publishPassword.value) return null
  const target = priceReleaseGuid.value, expectedRevision = revision.value, password = publishPassword.value
  publishPassword.value = ''
  const output = await publicationCoordinator.publish(target, expectedRevision, password)
  if (!ownsPrivilege(privilegeGeneration)) return null
  if (!output) { const normalized = workflow.error ? safeError(workflow.error) : null; error.value = normalized ?? error.value; if (normalized?.code === 'validation_failed') clearValidationProof(); if (workflow.conflict) { clearValidationProof(); conflictBuffer.value = { kind:'publish', local:{ revision:expectedRevision, priceReleaseGuid:target }, server:null }; await load(); if (ready.value && conflictBuffer.value?.kind === 'publish') conflictBuffer.value = { ...conflictBuffer.value, server:{ home:clone(homeDraft.value), documents:clone(documentsDraft.value) } } } return null }
  clearValidationProof(); await load(); await loadHistory(); return output
}

async function beginRestore(release, event) { if (!ready.value || workflow.busy) return; const candidate = event?.currentTarget; restoreTrigger = candidate instanceof HTMLElement ? candidate : null; restoreTarget.value = release; restorePassword.value = ''; restoreDialog.value?.showModal?.(); await nextTick(); if (restoreDialog.value?.open) restoreDialog.value.querySelector('#restore-password')?.focus() }
function restoreFocus() { const trigger = restoreTrigger; restoreTrigger = null; void nextTick(() => { if (trigger?.isConnected && !trigger.disabled) trigger.focus(); else if (heading.value?.isConnected) heading.value.focus() }) }
function cancelRestore() { restorePassword.value = ''; restoreTarget.value = null; if (restoreDialog.value?.open) restoreDialog.value.close(); else restoreFocus() }
async function confirmRestore() {
  if (!restoreTarget.value || !restorePassword.value || workflow.busy || !ready.value) return null
  const target = restoreTarget.value.guid, expectedRevision = revision.value, password = restorePassword.value
  restorePassword.value = ''
  const pending = publicationCoordinator.restore(target, expectedRevision, password)
  if (restoreDialog.value?.open) restoreDialog.value.close(); else restoreFocus()
  const output = await pending
  restoreTarget.value = null
  if (!ownsPrivilege(privilegeGeneration)) return null
  if (!output) { error.value = workflow.error ? safeError(workflow.error) : error.value; if (workflow.conflict) { clearValidationProof(); conflictBuffer.value = { kind:'restore', local:{ releaseGuid:target, revision:expectedRevision }, server:null }; await load(); if (ready.value && conflictBuffer.value?.kind === 'restore') conflictBuffer.value = { ...conflictBuffer.value, server:{ home:clone(homeDraft.value), documents:clone(documentsDraft.value) } } } return null }
  clearValidationProof(); await load(); await loadHistory(); return output
}

watch(priceReleaseGuid, () => { if (workflow.pendingRecovery) { publicationCoordinator.abandon(); error.value = { code:'attempt_binding_changed', requestId:null } } clearValidationProof() })
watch(revision, () => { if (workflow.pendingRecovery) { publicationCoordinator.abandon(); error.value = { code:'attempt_binding_changed', requestId:null }; clearValidationProof() } })

function clearPrivilegedState() { readGeneration++; writeGeneration++; searchGeneration++; validationGeneration++; historyGeneration++; privilegeGeneration++; readController.abort(); writeController.abort(); searchController.abort(); validationController.abort(); historyController.abort(); publicationCoordinator.cancel(); homeDraft.value = null; documentsDraft.value = null; revision.value = null; savedCanonical.value = null; validationProof.value = null; validationResult.value = null; conflictBuffer.value = null; modelSearch.value = ''; modelResults.value = []; searching.value = false; historyItems.value = []; historyTotal.value = 0; historyLoading.value = false; publishPassword.value = ''; restorePassword.value = ''; restoreTarget.value = null; restoreTrigger = null; if (restoreDialog.value?.open) restoreDialog.value.close(); if (heading.value?.isConnected) heading.value.focus(); busy.value = false; error.value = null }
watch(() => userStore.user?.role, role => { if (role !== 'root') { clearPrivilegedState(); void router.replace?.('/chat') } }, { flush: 'sync' })
function formatConflict(value) { return value === null ? t('publicContentAdmin.loading') : JSON.stringify(value, null, 2) }
onMounted(() => { heading.value?.focus(); void load(); void loadHistory() })
onBeforeUnmount(clearPrivilegedState)
</script>
