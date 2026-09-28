<template>
  <section class="public-not-found" aria-labelledby="not-found-title">
    <p class="public-not-found__status" aria-label="HTTP 状态码 404">404</p>
    <h1 id="not-found-title">页面不存在</h1>
    <p>你访问的公共页面不存在或尚未发布。</p>
    <RouterLink to="/">返回首页</RouterLink>
  </section>
</template>
<script setup>import '@/styles/public-content.scss'</script>
