<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { createPublicContentState } from '@/stores/publicContent.js'
import PublicContentState from '@/components/public/PublicContentState.vue'

const state = createPublicContentState()
const dismissed = ref(new Set())
const announcementDialog = ref(null)
let previousFocus = null
const parse = value => { try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' ? parsed : null } catch { return null } }
const home = computed(() => parse(state.value.home.data?.document) || {})
const configured = computed(() => typeof home.value.title === 'string' && home.value.title.trim().length > 0)
const models = computed(() => state.value.models.data?.items || [])
const advantages = computed(() => Array.isArray(home.value.advantages) ? home.value.advantages.slice(0, 8) : [])
const announcements = computed(() => Array.isArray(home.value.announcements) ? home.value.announcements.filter(item => item?.version && item?.title && !dismissed.value.has(String(item.version))) : [])
const faqs = computed(() => Array.isArray(home.value.faqs) ? home.value.faqs.filter(item => item?.question && item?.answer) : [])
const load = async () => Promise.allSettled([state.loadSite(), state.loadHome(), state.loadModels({ page: 1, pageSize: 20 })])
const announcementKey = version => `public_announcement_read:${state.value.home.data?.releaseVersion}:${version}`
function dismiss(version) { try { localStorage.setItem(announcementKey(version), 'read') } catch {}; dismissed.value = new Set([...dismissed.value, String(version)]); nextTick(() => previousFocus?.isConnected && previousFocus.focus()) }
function restoreReadState() { for (const item of Array.isArray(home.value.announcements) ? home.value.announcements : []) { try { if (localStorage.getItem(announcementKey(item.version)) === 'read') dismissed.value.add(String(item.version)) } catch {} } dismissed.value = new Set(dismissed.value) }
function handleDialogKey(event) { if (event.key === 'Escape') dismiss(announcements.value[0].version); if (event.key === 'Tab') { event.preventDefault(); announcementDialog.value?.querySelector('button')?.focus() } }
watch(() => announcements.value[0]?.version, async version => { if (!version) return; previousFocus = document.activeElement; await nextTick(); announcementDialog.value?.querySelector('button')?.focus() })
onMounted(async () => { await load(); restoreReadState() })
onUnmounted(() => { state.cancel('site'); state.cancel('home'); state.cancel('models') })
</script>

<template>
  <div class="public-home">
    <PublicContentState v-if="state.value.home.status !== 'ready'" :status="state.value.home.status" @retry="load" />
    <PublicContentState v-else-if="!configured" status="preparing" />
    <template v-else>
      <section class="public-hero" data-section="hero" aria-labelledby="home-title">
        <div><p v-if="home.eyebrow" class="public-eyebrow">{{ home.eyebrow }}</p><h1 id="home-title">{{ home.title }}</h1><p class="public-lead">{{ home.subtitle }}</p><div class="public-actions"><RouterLink class="public-button" to="/chat">进入控制台</RouterLink><RouterLink class="public-button public-button--secondary" to="/pricing">查看模型价格</RouterLink></div></div>
        <aside v-if="home.demo" class="public-demo" aria-label="产品演示"><span class="public-demo__label">演示内容</span><h2>{{ home.demo.title }}</h2><p>{{ home.demo.description }}</p></aside>
      </section>
      <section id="advantages" class="public-section" data-section="advantages" aria-labelledby="advantages-title"><p class="public-eyebrow">产品优势</p><h2 id="advantages-title">{{ home.advantagesTitle || '已发布的产品能力' }}</h2><div v-if="advantages.length" class="public-card-grid"><article v-for="item in advantages" :key="item.title" class="public-card"><h3>{{ item.title }}</h3><p>{{ item.description }}</p></article></div><PublicContentState v-else status="empty" /></section>
      <section id="models" class="public-section" data-section="models" aria-labelledby="models-title"><p class="public-eyebrow">支持模型</p><h2 id="models-title">已发布模型目录</h2><div v-if="models.length" class="public-model-wall"><RouterLink v-for="model in models" :key="model.modelKey" :to="`/pricing/${model.modelKey}`">{{ model.displayName }}<small>{{ model.provider }}</small></RouterLink></div><PublicContentState v-else :status="state.value.models.status" @retry="load" /></section>
      <section class="public-section public-info-grid" data-section="announcements-faq" aria-label="公告与常见问题"><div><h2>公告</h2><p v-if="!announcements.length" class="public-muted">暂无未读公告。</p><p v-else class="public-muted">有 {{ announcements.length }} 条未读公告。</p></div><div><h2>常见问题</h2><details v-for="item in faqs" :key="item.question"><summary>{{ item.question }}</summary><p>{{ item.answer }}</p></details><p v-if="!faqs.length" class="public-muted">暂无已发布的常见问题。</p></div></section>
      <section class="public-cta" data-section="cta" aria-labelledby="cta-title"><div><h2 id="cta-title">{{ home.cta?.title }}</h2><p>{{ home.cta?.description }}</p></div><RouterLink class="public-button public-button--light" to="/chat">进入控制台</RouterLink></section>
      <div v-if="announcements[0]" class="public-announcement-backdrop"><section ref="announcementDialog" class="public-notice" role="dialog" aria-modal="true" aria-labelledby="announcement-title" tabindex="-1" @keydown="handleDialogKey"><span>公告版本 {{ announcements[0].version }}</span><h2 id="announcement-title">{{ announcements[0].title }}</h2><p>{{ announcements[0].body }}</p><button class="public-button" type="button" @click="dismiss(announcements[0].version)">知道了</button></section></div>
    </template>
  </div>
</template>
