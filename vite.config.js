import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { publicModuleGraphPlugin } from './scripts/public-module-graph.mjs'

import { publicContentPreviewHeaders } from './scripts/public-content-preview-headers.mjs'

function publicContentPreviewProtection() {
  const install = server => {
    server.middlewares.use((req, res, next) => {
      const headers = publicContentPreviewHeaders(new URL(req.url || '/', 'http://local.invalid').pathname)
      if (headers) for (const [name, value] of Object.entries(headers)) res.setHeader(name, value)
      next()
    })
  }
  return { name: 'public-content-preview-protection', configureServer: install, configurePreviewServer: install }
}

export default defineConfig({
  plugins: [vue(), publicContentPreviewProtection(), publicModuleGraphPlugin()],
  build: { manifest: true },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '^/api(?:/|\\?|$)': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes, req) => {
            if (req.url?.includes('/chat/compare')) {
              proxyRes.headers['cache-control'] = 'no-cache'
              proxyRes.headers['x-accel-buffering'] = 'no'
            }
          })
        },
      },
    },
  },
})
