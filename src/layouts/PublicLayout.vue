<template>
  <div class="public-layout">
    <a class="skip-link" href="#public-content">跳到主要内容</a>
    <header class="public-header">
      <RouterLink class="brand" to="/" aria-label="AI 模型中转站首页">AI 模型中转站</RouterLink>
      <nav aria-label="公共页面导航">
        <RouterLink to="/pricing">模型价格</RouterLink>
        <RouterLink to="/about">关于</RouterLink>
        <RouterLink to="/chat">进入控制台</RouterLink>
      </nav>
    </header>
    <main id="public-content" tabindex="-1">
      <RouterView />
    </main>
    <footer class="public-footer">
      <RouterLink to="/terms">服务协议</RouterLink>
      <RouterLink to="/privacy">隐私政策</RouterLink>
    </footer>
  </div>
</template>

<style scoped>
.public-layout { min-height: 100vh; background: #f8fafc; color: #111827; }
.public-header, .public-footer { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 16px 24px; }
.public-header { border-bottom: 1px solid #e5e7eb; background: #fff; }
.public-header nav, .public-footer { display: flex; gap: 20px; }
.brand { font-weight: 700; }
#public-content { min-height: calc(100vh - 130px); padding: 24px; }
a { color: #1d4ed8; }
.skip-link { position: fixed; left: 12px; top: -60px; z-index: 100; padding: 8px 12px; background: #fff; }
.skip-link:focus { top: 12px; }
@media (max-width: 767px) {
  .public-header { align-items: flex-start; }
  .public-header nav { flex-wrap: wrap; justify-content: flex-end; gap: 12px; }
}
</style>
