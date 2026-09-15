<template>
  <section class="structured-editor" data-editor="faq" aria-labelledby="faq-editor-title">
    <header><div><h2 id="faq-editor-title">{{ labels.title }}</h2><p>{{ items.length }} / {{ MAX_FAQS }}</p></div></header>
    <form class="editor-form" @submit.prevent="submitCreate">
      <label>{{ labels.question }}<input v-model="createForm.question" maxlength="200" :disabled="busy || atLimit"></label>
      <label>{{ labels.answer }}<textarea v-model="createForm.answerMarkdown" :disabled="busy || atLimit"></textarea></label>
      <label>{{ labels.sortOrder }}<input v-model.number="createForm.sortOrder" type="number" min="0" max="1000000" :disabled="busy || atLimit"></label>
      <label class="inline-check"><input v-model="createForm.isVisible" type="checkbox" :disabled="busy || atLimit">{{ labels.visible }}</label>
      <button type="submit" :disabled="busy || atLimit || !validFAQ(createForm)">{{ labels.add }}</button>
    </form>
    <p v-if="atLimit" class="editor-limit" role="status">{{ labels.limit }}</p>
    <ol class="editor-items">
      <li v-for="(item, index) in items" :key="item.guid" class="editor-item">
        <div class="editor-order-actions">
          <button type="button" :aria-label="labels.moveUp" :disabled="busy || index === 0" @click="$emit('move', { guid: item.guid, direction: -1 })">↑</button>
          <button type="button" :aria-label="labels.moveDown" :disabled="busy || index === items.length - 1" @click="$emit('move', { guid: item.guid, direction: 1 })">↓</button>
        </div>
        <strong>{{ item.question }}</strong><span>{{ item.isVisible ? labels.visible : labels.hidden }}</span>
        <button type="button" :disabled="busy" @click="$emit('update', { ...item, isVisible: !item.isVisible })">{{ item.isVisible ? labels.hide : labels.show }}</button>
        <button type="button" :disabled="busy" @click="openDelete(item, $event)">{{ labels.remove }}</button>
      </li>
    </ol>
    <dialog ref="deleteDialog" class="responsive-dialog" aria-labelledby="faq-delete-title" @cancel.prevent="closeDelete" @close="restoreDeleteFocus" @keydown="trapDeleteFocus">
      <h3 id="faq-delete-title">{{ labels.confirmTitle }}</h3><p>{{ pendingDelete?.question }}</p>
      <button ref="confirmButton" type="button" @click="confirmDelete">{{ labels.confirm }}</button>
      <button ref="cancelButton" type="button" @click="closeDelete">{{ labels.cancel }}</button>
    </dialog>
  </section>
</template>

<script setup>
import { computed, nextTick, reactive, ref } from 'vue'

const MAX_FAQS = 50
const MAX_BODY_BYTES = 16384
const MAX_SORT = 1000000
const INVALID_SCALAR = /(?:[\uD800-\uDBFF](?![\uDC00-\uDFFF]))|(?:(?<![\uD800-\uDBFF])[\uDC00-\uDFFF])|\uFFFD/
const CONTROL = /[\p{Cc}\p{Cf}]/u
const props = defineProps({ items: { type: Array, default: () => [] }, busy: Boolean, labels: { type: Object, required: true } })
const emit = defineEmits(['create', 'update', 'remove', 'move'])
const createForm = reactive({ question: '', answerMarkdown: '', isVisible: true, sortOrder: 0 })
const deleteDialog = ref(null), confirmButton = ref(null), cancelButton = ref(null), pendingDelete = ref(null), deleteTrigger = ref(null)
const atLimit = computed(() => props.items.length >= MAX_FAQS)
const scalarSafe = value => typeof value === 'string' && !INVALID_SCALAR.test(value) && ![...value].some(character => { const code = character.codePointAt(0); return code >= 0xfdd0 && code <= 0xfdef || (code & 0xffff) >= 0xfffe })
const plainText = (value, max) => scalarSafe(value) && value.trim().length > 0 && [...value].length <= max && ![...value].some(character => CONTROL.test(character))
const markdown = value => scalarSafe(value) && new TextEncoder().encode(value).length <= MAX_BODY_BYTES && ![...value].some(character => ['\t', '\n', '\r'].includes(character) ? false : CONTROL.test(character))
const validFAQ = value => plainText(value.question, 200) && markdown(value.answerMarkdown) && typeof value.isVisible === 'boolean' && Number.isSafeInteger(value.sortOrder) && value.sortOrder >= 0 && value.sortOrder <= MAX_SORT
function submitCreate() { if (!props.busy && !atLimit.value && validFAQ(createForm)) emit('create', { ...createForm }) }
function openDelete(item, event) { pendingDelete.value = item; deleteTrigger.value = event.currentTarget; deleteDialog.value?.showModal(); nextTick(() => confirmButton.value?.focus()) }
function closeDelete() { deleteDialog.value?.close() }
function confirmDelete() { if (pendingDelete.value) emit('remove', pendingDelete.value.guid); closeDelete() }
function restoreDeleteFocus() { const trigger = deleteTrigger.value; pendingDelete.value = null; deleteTrigger.value = null; nextTick(() => trigger?.isConnected && trigger.focus()) }
function trapDeleteFocus(event) { if (event.key !== 'Tab') return; const first = confirmButton.value, last = cancelButton.value; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() } }
</script>
