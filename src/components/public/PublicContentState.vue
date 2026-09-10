<script setup>
defineProps({ status: { type: String, required: true }, message: { type: String, default: '' } })
defineEmits(['retry'])
import { usePublicI18n } from '@/i18n/public-runtime.js'
const { t } = usePublicI18n()
</script>
<template>
  <div v-if="status === 'loading'" class="public-state" role="status" aria-live="polite"><span class="public-state__spinner" aria-hidden="true" />{{ t('loading') }}</div>
  <div v-else-if="status === 'preparing' || status === 'idle'" class="public-state" role="status"><h2>{{ t('preparing') }}</h2></div>
  <div v-else-if="status === 'empty' || status === 'ready-empty'" class="public-state" role="status"><h2>{{ t('empty') }}</h2></div>
  <div v-else-if="status === 'error' || status === 'not_found' || status === 'gone'" class="public-state" role="alert"><h2>{{ t('error') }}</h2><p v-if="message">{{ message }}</p><button class="public-button" type="button" @click="$emit('retry')">{{ t('retry') }}</button></div>
</template>
