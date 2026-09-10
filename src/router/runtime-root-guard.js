import { watch } from 'vue'

export function installRuntimeRootGuard({ route, userStore, router, cancelAdmin = () => {} }) {
  return watch(
    () => [route.meta?.rootOnly === true, userStore.user?.role],
    ([rootOnly, role]) => {
      if (!rootOnly || role === 'root') return
      cancelAdmin()
      void router.replace({ path: '/chat', replace: true })
    },
    { immediate: true, flush: 'sync' },
  )
}
