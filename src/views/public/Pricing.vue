<script setup>
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PricingFilters from '@/components/public/PricingFilters.vue'
import PricingTable from '@/components/public/PricingTable.vue'
import PricingCards from '@/components/public/PricingCards.vue'
import PublicContentState from '@/components/public/PublicContentState.vue'
import { applyPricingPresentation, canonicalPricingQuery, canonicalPricingRouteQuery, isCanonicalPricingRouteQuery, loadPricingAuthSession, pricingAPIQuery, publicPricingAuthOptions } from '@/utils/public-pricing-query.js'
import { usePublicI18n } from '@/i18n/public-runtime.js'

const route = useRoute(); const router = useRouter(); const { store, ready } = inject('public-home-publication')
const { t } = usePublicI18n()
const drawerOpen = ref(false); const drawer = ref(null); const filterButton = ref(null); const query = computed(() => canonicalPricingQuery(route.query))
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
let searchTimer; let disposed = false; const auth = shallowRef(null); let stopAuth = null; let authProbe = null
const options = () => publicPricingAuthOptions(auth.value)
async function upgradeAuth(required) {
  if (auth.value || !required) return options().authenticated
  authProbe ||= loadPricingAuthSession(true, () => import('@/api/request.js'))
  const restored = await authProbe
  if (disposed || !restored) return false
  auth.value = restored; stopAuth = restored.subscribe(() => { void load() })
  return true
}
async function load() {
  await ready; if (disposed) return null
  await store.loadSite(options()); if (disposed || store.value.site.status !== 'ready') return null
  if (await upgradeAuth(protectedPrices.value || ['input', 'output'].includes(query.value.sort))) await store.loadSite(options())
  sortRequiresLogin.value = priceSortDisabled.value && ['input', 'output'].includes(query.value.sort)
  if (sortRequiresLogin.value || disposed) return null
  return store.loadModels(pricingAPIQuery(query.value), options())
}
function replaceQuery(patch) { clearTimeout(searchTimer); const next = canonicalPricingQuery({ ...query.value, ...patch }); return router.replace({ name: 'PublicPricing', query: canonicalPricingRouteQuery(next) }) }
function scheduleSearch(form) { clearTimeout(searchTimer); searchTimer = setTimeout(() => replaceQuery(form), 250) }
function closeDrawer() { drawerOpen.value = false; nextTick(() => filterButton.value?.focus()) }
function handleDrawerKey(event) { if (event.key === 'Escape') closeDrawer(); if (event.key === 'Tab') { const items = [...drawer.value.querySelectorAll('button,input,select')]; const first = items[0]; const last = items.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() } } }
watch(drawerOpen, async open => { if (open) { await nextTick(); drawer.value?.querySelector('button')?.focus() } })
watch(() => route.fullPath, load, { immediate: true })
onMounted(async () => { if (!isCanonicalPricingRouteQuery(route.query)) await replaceQuery({}) })
onBeforeUnmount(() => { disposed = true; clearTimeout(searchTimer); stopAuth?.(); store.cancel('models') })
</script>
<template><div class="pricing-page"><header class="pricing-heading"><p class="public-eyebrow">{{ t('pricingCatalog.eyebrow') }}</p><h1>{{ t('pricingCatalog.title') }}</h1><p>{{ t('pricingCatalog.intro') }}</p></header><p class="pricing-disclaimer" role="note">{{ t('pricingCatalog.disclaimer') }}</p>
  <button ref="filterButton" class="public-button pricing-filter-toggle" type="button" aria-haspopup="dialog" @click="drawerOpen=true">{{ t('pricingCatalog.filter') }}</button>
  <div class="pricing-layout"><aside class="pricing-sidebar" :aria-label="t('pricingCatalog.filter')"><PricingFilters :query="query" :providers="providers" :capabilities="capabilities" :endpoints="endpoints" :groups="groups" :price-sort-disabled="priceSortDisabled" @change="replaceQuery" @search="scheduleSearch" /></aside><section aria-labelledby="pricing-results"><h2 id="pricing-results" class="sr-only">{{ t('pricingCatalog.results') }}</h2><PublicContentState v-if="catalogStatus === 'loading' || catalogStatus === 'idle'" status="loading" /><section v-else-if="catalogStatus === 'login_required'" class="pricing-login-required" role="status">{{ t(sortRequiresLogin ? 'pricingCatalog.sortLoginRequired' : 'pricingCatalog.loginRequired') }}</section><PublicContentState v-else-if="catalogStatus === 'error'" status="error" :message="t('pricingCatalog.unavailable')" @retry="load" /><PublicContentState v-else-if="slot.status === 'ready-empty' || !models.length" status="empty" /><template v-else><PricingTable :models="models" /><PricingCards :models="models" /><nav class="pricing-pagination" :aria-label="t('pricingCatalog.pagination')"><button type="button" :disabled="query.page<=1" @click="replaceQuery({page:query.page-1})">{{ t('pricingCatalog.previous') }}</button><span>{{ t('pricingCatalog.page',{page:query.page,pages:pageCount}) }}</span><button type="button" :disabled="query.page>=pageCount" @click="replaceQuery({page:query.page+1})">{{ t('pricingCatalog.next') }}</button><label>{{ t('pricingCatalog.pageSize') }}<select :value="query.pageSize" @change="replaceQuery({pageSize:Number($event.target.value),page:1})"><option>20</option><option>50</option><option>100</option></select></label></nav></template></section></div>
  <div v-if="drawerOpen" class="pricing-drawer-backdrop" @click.self="closeDrawer"><section ref="drawer" class="pricing-drawer" role="dialog" aria-modal="true" aria-labelledby="pricing-filter-title" @keydown="handleDrawerKey"><header><h2 id="pricing-filter-title">{{ t('pricingCatalog.filter') }}</h2><button type="button" :aria-label="t('pricingCatalog.closeFilter')" @click="closeDrawer">×</button></header><PricingFilters :query="query" :providers="providers" :capabilities="capabilities" :endpoints="endpoints" :groups="groups" :price-sort-disabled="priceSortDisabled" @change="replaceQuery" @search="scheduleSearch" /></section></div>
</div></template>
<style scoped>.pricing-page{width:min(1200px,calc(100% - 48px));margin:0 auto;padding:72px 0 96px}.pricing-heading{max-width:760px}.pricing-heading h1{margin:8px 0;font-size:clamp(36px,5vw,54px)}.pricing-heading p{color:var(--public-muted)}.pricing-disclaimer{margin:28px 0;padding:16px 20px;border-left:4px solid var(--public-primary);border-radius:8px;background:#eff6ff;color:#1e3a8a}.pricing-layout{display:grid;grid-template-columns:260px minmax(0,1fr);gap:24px}.pricing-sidebar{align-self:start;padding:20px;border:1px solid var(--public-border);border-radius:16px;background:var(--public-card)}.pricing-filter-toggle,.pricing-drawer,.pricing-drawer-backdrop{display:none}.pricing-pagination{display:flex;align-items:center;justify-content:flex-end;gap:14px;margin-top:22px}.pricing-pagination button,.pricing-pagination select{min-height:40px;padding:0 12px;border:1px solid var(--public-border);border-radius:8px;background:var(--public-card);color:var(--public-text)}.pricing-pagination :focus-visible,.pricing-filter-toggle:focus-visible{outline:3px solid var(--public-primary);outline-offset:2px}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}@media(max-width:767px){.pricing-page{width:calc(100% - 32px);padding-top:48px}.pricing-layout{display:block}.pricing-sidebar{display:none}.pricing-filter-toggle{display:inline-flex;margin-bottom:18px}.pricing-page :deep(.pricing-table-wrap){display:none}.pricing-pagination{align-items:stretch;flex-wrap:wrap;justify-content:center}.pricing-drawer-backdrop{position:fixed;inset:0;z-index:180;display:flex;justify-content:flex-end;background:rgba(15,23,42,.62)}.pricing-drawer{display:block;width:min(340px,90vw);height:100%;overflow:auto;padding:22px;background:var(--public-card);color:var(--public-text)}.pricing-drawer>header{display:flex;align-items:center;justify-content:space-between}.pricing-drawer>header button{min-width:44px;min-height:44px;border:0;background:transparent;color:inherit;font-size:28px}}/* 375px */@media(min-width:768px) and (max-width:1439px){.pricing-page{width:calc(100% - 40px)}}/* 768px */@media(min-width:1440px){.pricing-page{width:1200px}}/* 1440px */</style>
