import { loadEnv } from 'vite'

const env = {
  ...loadEnv('production', process.cwd(), ''),
  ...process.env,
}

if (env.VITE_USE_MOCK !== 'false') {
  process.stderr.write('Production build requires VITE_USE_MOCK=false.\n')
  process.exitCode = 1
}
