import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { publicModuleGraphPlugin } from './scripts/public-module-graph.mjs'

import { publicContentPreviewProtection } from './scripts/public-content-preview-headers.mjs'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const useMock = (process.env.VITE_USE_MOCK ?? env.VITE_USE_MOCK) === 'true'
  const aliases = [
    { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
  ]
  if (!useMock) {
    const productionMock = fileURLToPath(new URL('./src/api/production-api-sentinel.js', import.meta.url))
    aliases.unshift(
      { find: '@/api/mock', replacement: productionMock },
      { find: './mock', replacement: productionMock },
    )
  }

  return {
  plugins: [vue(), publicContentPreviewProtection(), publicModuleGraphPlugin()],
  build: { manifest: true },
  resolve: { alias: aliases },
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
      '^/admin/v2(?:/|\\?|$)': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  }
})
