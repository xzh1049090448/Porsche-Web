<template>
  <section class="not-found" aria-labelledby="not-found-title">
    <p class="status" aria-label="HTTP 状态码 404">404</p>
    <h1 id="not-found-title">页面不存在</h1>
    <p>你访问的公共页面不存在或尚未发布。</p>
    <RouterLink to="/">返回首页</RouterLink>
  </section>
</template>

<style scoped>
.not-found { max-width: 640px; margin: 12vh auto; padding: 32px; text-align: center; background: #fff; border: 1px solid #e5e7eb; border-radius: 16px; }
.status { margin: 0; color: #2563eb; font: 700 48px/1 monospace; }
h1 { margin: 16px 0 8px; }
p { color: #4b5563; }
a { display: inline-block; margin-top: 12px; color: #1d4ed8; }
</style>
