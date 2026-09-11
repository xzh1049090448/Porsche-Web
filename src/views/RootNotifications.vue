<template>
  <section class="notifications-page" aria-labelledby="notifications-title">
    <header><div><p class="eyebrow">ROOT</p><h1 id="notifications-title">{{ t('rootNotifications.title') }}</h1><p>{{ t('rootNotifications.description') }}</p></div><el-button :loading="store.loading" @click="store.refresh">{{ t('rootNotifications.refresh') }}</el-button></header>
    <el-alert v-if="store.error" role="alert" :title="errorText(store.error)" type="error" show-icon :closable="false" />
    <el-alert v-if="store.mutationError" role="alert" :title="errorText(store.mutationError)" type="error" show-icon :closable="false" />
    <div class="receipt-summary" aria-live="polite">{{ t('rootNotifications.unread', {count:store.unreadCount}) }}</div>
    <div class="notification-groups">
      <section v-for="group in groups" :key="group.state" class="notification-group" :aria-labelledby="`notification-${group.state}`">
        <h2 :id="`notification-${group.state}`">{{ t(`rootNotifications.groups.${group.state}`) }} <span>{{ group.total }}</span></h2>
        <p v-if="!store.loading&&!group.items.length" class="empty">{{ t('rootNotifications.empty') }}</p>
        <article v-for="item in group.items" :key="item.guid" class="notification-card" :class="{unread:!item.read}">
          <div><h3>{{ t(`rootNotifications.types.${item.type}`) }}</h3><p>{{ formatTime(item.updatedAt) }}</p><div class="states"><el-tag size="small" :type="item.read?'info':'warning'">{{ t(item.read?'rootNotifications.read':'rootNotifications.unreadState') }}</el-tag><el-tag size="small" :type="item.acknowledged?'success':'info'">{{ t(item.acknowledged?'rootNotifications.acknowledged':'rootNotifications.unacknowledged') }}</el-tag></div></div>
          <div class="actions"><el-button v-if="!item.read" :loading="pending(item,'markRead')" @click="store.markRead(item.guid)">{{ t('rootNotifications.markRead') }}</el-button><el-button v-if="!item.acknowledged" type="primary" :loading="pending(item,'acknowledge')" @click="store.acknowledge(item.guid)">{{ t('rootNotifications.acknowledge') }}</el-button></div>
        </article>
      </section>
    </div>
  </section>
</template>
<script setup>
import {computed} from 'vue'
import {useI18n} from '@/composables/useI18n'
import {useRootNotificationsStore} from '@/stores/rootNotifications'
const {t}=useI18n(),store=useRootNotificationsStore()
const groups=computed(()=>[{state:'active',items:store.active,total:store.activeTotal},{state:'resolved',items:store.resolved,total:store.resolvedTotal}])
const pending=(item,kind)=>Boolean(store.pendingReceipts[item.guid]?.[kind])
const formatTime=value=>new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value))
const errorText=error=>t(`rootNotifications.errors.${error?.code??'request_failed'}`)
</script>
<style scoped lang="scss">
.notifications-page{max-width:1080px;margin:0 auto;padding:24px}.notifications-page>header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.eyebrow{color:#2563eb;font-weight:700}.receipt-summary{margin:16px 0;color:var(--text-secondary)}.notification-groups{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.notification-group{background:var(--card-bg);border:1px solid var(--border);border-radius:16px;padding:18px}.notification-group h2{display:flex;justify-content:space-between}.notification-card{display:flex;justify-content:space-between;gap:16px;padding:16px 0;border-top:1px solid var(--border)}.notification-card.unread{border-left:3px solid #2563eb;padding-left:12px}.notification-card h3{margin:0 0 6px}.notification-card p{color:var(--text-secondary)}.states,.actions{display:flex;gap:8px;flex-wrap:wrap}.actions{align-items:center}.empty{color:var(--text-secondary)}@media(max-width:768px){.notifications-page{padding:16px}.notification-groups{grid-template-columns:1fr}.notification-card{flex-direction:column}.actions :deep(.el-button){margin-left:0;flex:1}}
</style>
