<script>
import { h } from 'vue'
import { usePublicI18n } from '@/i18n/public-runtime.js'
export default {
  props: { status: { type: String, required: true }, message: { type: String, default: '' } },
  emits: ['retry'],
  setup(props, { emit }) {
    const { t } = usePublicI18n()
    return () => {
      if (props.status === 'loading') return h('div', { class: 'public-state', role: 'status', 'aria-live': 'polite' }, [h('span', { class: 'public-state__spinner', 'aria-hidden': 'true' }), t('loading')])
      if (['preparing', 'idle'].includes(props.status)) return h('div', { class: 'public-state', role: 'status' }, [h('h2', t('preparing'))])
      if (['empty', 'ready-empty'].includes(props.status)) return h('div', { class: 'public-state', role: 'status' }, [h('h2', t('empty'))])
      if (['error', 'not_found', 'gone'].includes(props.status)) return h('div', { class: 'public-state public-state--error', role: 'alert' }, [h('h2', t('error')), props.message && h('p', props.message), h('button', { class: 'public-button', type: 'button', onClick: () => emit('retry') }, t('retry'))])
    }
  },
}
</script>
