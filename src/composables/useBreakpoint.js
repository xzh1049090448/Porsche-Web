import { ref, computed, onMounted, onUnmounted } from 'vue'

export const BREAKPOINT_MOBILE = 768
export const BREAKPOINT_TABLET = 992

export function useBreakpoint() {
  const width = ref(typeof window !== 'undefined' ? window.innerWidth : 1200)

  function update() {
    width.value = window.innerWidth
  }

  onMounted(() => {
    update()
    window.addEventListener('resize', update)
  })

  onUnmounted(() => {
    window.removeEventListener('resize', update)
  })

  const isMobile = computed(() => width.value <= BREAKPOINT_MOBILE)
  const isTablet = computed(() => width.value <= BREAKPOINT_TABLET)
  const isDesktop = computed(() => width.value > BREAKPOINT_TABLET)

  return { width, isMobile, isTablet, isDesktop }
}
