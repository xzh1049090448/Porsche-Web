<script setup>
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PricingFilters from '@/components/public/PricingFilters.vue'
import PricingTable from '@/components/public/PricingTable.vue'
import PricingCards from '@/components/public/PricingCards.vue'
import PublicContentState from '@/components/public/PublicContentState.vue'
import { applyPricingPresentation, canonicalPricingQuery, canonicalPricingRouteQuery, isCanonicalPricingRouteQuery, loadPricingAuthSession, pricingAPIQuery, publicPricingAuthOptions } from '@/utils/public-pricing-query.js'
import { usePublicI18n } from '@/i18n/public-runtime.js'
import '@/styles/public-pricing.scss'

const route = useRoute(); const router = useRouter(); const { store, ready } = inject('public-home-publication')
const { t } = usePublicI18n()
const drawerOpen = ref(false); const drawer = ref(null); const filterButton = ref(null); const pageHeading = ref(null); const query = computed(() => canonicalPricingQuery(route.query))
const slot = computed(() => store.value.models)
const sortRequiresLogin = ref(false)
const protectedPrices = computed(() => store.value.site.data?.priceVisibility === 'authenticated_only')
const priceSortDisabled = computed(() => !options().authenticated && protectedPrices.value)
const catalogStatus = computed(() => sortRequiresLogin.value ? 'login_required' : store.value.site.status === 'error' ? 'error' : store.value.site.status === 'ready' ? slot.value.status : 'loading')
const models = computed(() => applyPricingPresentation(slot.value.data?.items || [], query.value))
const providers = computed(() => slot.value.data?.facets?.providers || [])
const capabilities = computed(() => slot.value.data?.facets?.capabilities || [])
const endpoints = computed(() => slot.value.data?.facets?.endpointTypes || [])
const groups = computed(() => slot.value.data?.facets?.publicDisplayGroups || [])
const pageCount = computed(() => Math.max(1, Math.ceil((slot.value.data?.total || 0) / query.value.pageSize)))
const resultRange = computed(() => {
  const total = slot.value.data?.total || 0
  if (!total) return '0'
  const first = (query.value.page - 1) * query.value.pageSize + 1
  return `${first}–${Math.min(total, first + models.value.length - 1)} / ${total}`
})
let searchTimer; let disposed = false; const auth = shallowRef(null); let stopAuth = null; let authProbe = null; let desktopQuery = null; let loadGeneration = 0
const options = () => publicPricingAuthOptions(auth.value)
async function upgradeAuth(required) {
  if (auth.value || !required) return options().authenticated
  authProbe ||= loadPricingAuthSession(true, () => import('@/api/request.js'))
  const restored = await authProbe
  if (disposed || !restored) return false
  auth.value = restored; stopAuth = restored.subscribe(() => { void requestLoad() })
  return true
}
async function load(generation) {
  await ready; if (disposed || generation !== loadGeneration) return null
  await store.loadSite(options()); if (disposed || generation !== loadGeneration || store.value.site.status !== 'ready') return null
  if (await upgradeAuth(protectedPrices.value || ['input', 'output'].includes(query.value.sort))) await store.loadSite(options())
  if (disposed || generation !== loadGeneration) return null
  sortRequiresLogin.value = priceSortDisabled.value && ['input', 'output'].includes(query.value.sort)
  if (sortRequiresLogin.value || disposed) return null
  return store.loadModels(pricingAPIQuery(query.value), options())
}
function requestLoad() {
  if (loadGeneration) store.cancel('models')
  const generation = ++loadGeneration
  return load(generation)
}
function replaceQuery(patch) { clearTimeout(searchTimer); const next = canonicalPricingQuery({ ...query.value, ...patch }); return router.replace({ name: 'PublicPricing', query: canonicalPricingRouteQuery(next) }) }
function scheduleSearch(form) { clearTimeout(searchTimer); searchTimer = setTimeout(() => replaceQuery(form), 250) }
function restoreDrawerFocus() {
  filterButton.value?.focus()
  if (document.activeElement !== filterButton.value) pageHeading.value?.focus()
}
function closeDrawer() { drawerOpen.value = false; nextTick(restoreDrawerFocus) }
function handleDesktopChange(event) { if (event.matches && drawerOpen.value) closeDrawer() }
function handleDrawerKey(event) { if (event.key === 'Escape') closeDrawer(); if (event.key === 'Tab') { const items = [...drawer.value.querySelectorAll('button,input,select')]; const first = items[0]; const last = items.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() } } }
watch(drawerOpen, async open => { if (open) { await nextTick(); drawer.value?.querySelector('button')?.focus() } })
watch(() => route.fullPath, requestLoad, { immediate: true })
onMounted(async () => {
  desktopQuery = window.matchMedia?.('(min-width: 768px)') || null
  desktopQuery?.addEventListener('change', handleDesktopChange)
  if (!isCanonicalPricingRouteQuery(route.query)) await replaceQuery({})
})
onBeforeUnmount(() => { disposed = true; loadGeneration++; clearTimeout(searchTimer); stopAuth?.(); desktopQuery?.removeEventListener('change', handleDesktopChange); store.cancel('models') })
</script>
<template><div class="pricing-page"><header class="pricing-heading"><p class="public-eyebrow">{{ t('pricingCatalog.eyebrow') }}</p><h1 ref="pageHeading" tabindex="-1">{{ t('pricingCatalog.title') }}</h1><p>{{ t('pricingCatalog.intro') }}</p></header><p class="pricing-disclaimer" role="note">{{ t('pricingCatalog.disclaimer') }}</p>
  <div class="pricing-toolbar"><output class="pricing-results-count" aria-live="polite">{{ resultRange }}</output><div class="pricing-toolbar-controls"><label class="pricing-search"><span class="sr-only">{{ t('pricingCatalog.search') }}</span><input name="search" type="search" :value="query.search" :placeholder="t('pricingCatalog.searchHint')" @input="scheduleSearch({ search: $event.target.value, page: 1 })" /></label><button ref="filterButton" class="public-button pricing-filter-toggle" type="button" aria-haspopup="dialog" aria-controls="pricing-filter-drawer" :aria-expanded="drawerOpen" @click="drawerOpen=true">{{ t('pricingCatalog.filter') }}</button></div></div>
  <div class="pricing-layout"><aside class="pricing-sidebar" :aria-label="t('pricingCatalog.filter')"><header class="pricing-sidebar-heading"><h2>{{ t('pricingCatalog.filter') }}</h2></header><PricingFilters :query="query" :providers="providers" :capabilities="capabilities" :endpoints="endpoints" :groups="groups" :price-sort-disabled="priceSortDisabled" @change="replaceQuery" /></aside><section class="pricing-results" aria-labelledby="pricing-results"><h2 id="pricing-results" class="sr-only">{{ t('pricingCatalog.results') }}</h2><PublicContentState v-if="catalogStatus === 'loading' || catalogStatus === 'idle'" status="loading" /><section v-else-if="catalogStatus === 'login_required'" class="pricing-login-required" role="status">{{ t(sortRequiresLogin ? 'pricingCatalog.sortLoginRequired' : 'pricingCatalog.loginRequired') }}</section><PublicContentState v-else-if="catalogStatus === 'error'" status="error" :message="t('pricingCatalog.unavailable')" @retry="requestLoad" /><PublicContentState v-else-if="slot.status === 'ready-empty' || !models.length" status="empty" /><template v-else><PricingTable :models="models" /><PricingCards :models="models" /><nav class="pricing-pagination" :aria-label="t('pricingCatalog.pagination')"><button type="button" :disabled="query.page<=1" @click="replaceQuery({page:query.page-1})">{{ t('pricingCatalog.previous') }}</button><span>{{ t('pricingCatalog.page',{page:query.page,pages:pageCount}) }}</span><button type="button" :disabled="query.page>=pageCount" @click="replaceQuery({page:query.page+1})">{{ t('pricingCatalog.next') }}</button><label>{{ t('pricingCatalog.pageSize') }}<select :value="query.pageSize" @change="replaceQuery({pageSize:Number($event.target.value),page:1})"><option>20</option><option>50</option><option>100</option></select></label></nav></template></section></div>
  <div v-if="drawerOpen" class="pricing-drawer-backdrop" @click.self="closeDrawer"><section id="pricing-filter-drawer" ref="drawer" class="pricing-drawer" role="dialog" aria-modal="true" aria-labelledby="pricing-filter-title" @keydown="handleDrawerKey"><header><h2 id="pricing-filter-title">{{ t('pricingCatalog.filter') }}</h2><button type="button" :aria-label="t('pricingCatalog.closeFilter')" @click="closeDrawer">×</button></header><PricingFilters :query="query" :providers="providers" :capabilities="capabilities" :endpoints="endpoints" :groups="groups" :price-sort-disabled="priceSortDisabled" @change="replaceQuery" /></section></div>
</div></template>
