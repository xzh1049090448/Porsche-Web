/** Build-time resource hints for guest routes; hints fetch and compile, never execute modules. */
export function guestStartupPreloadPlugin() {
  let base = '/'
  return {
    name: 'guest-startup-preload',
    apply: 'build',
    enforce: 'post',
    configResolved(config) { base = config.base },
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const html = bundle['index.html']
        if (!html || typeof html.source !== 'string') return
        const files = Object.entries(bundle)
        const fileFor = suffix => files.find(([, chunk]) => chunk.type === 'chunk' && chunk.facadeModuleId?.replaceAll('\\', '/').endsWith(suffix))?.[0]
        const common = ['/src/bootstrap/guest-ui.js', '/src/bootstrap/AuthApp.vue'].map(fileFor).filter(Boolean)
        const collect = roots => {
          const js = new Set(); const css = new Set()
          const visit = file => {
            if (js.has(file)) return
            const chunk = bundle[file]
            if (chunk?.type !== 'chunk') return
            js.add(file)
            for (const imported of chunk.imports || []) visit(imported)
            for (const style of chunk.viteMetadata?.importedCss || []) css.add(style)
          }
          roots.forEach(visit)
          // Shared guest shell styles are also imported by the bootstrap Promise.
          for (const [file, asset] of files) {
            if (asset.type === 'asset' && /(?:^|\/)(?:global|mobile|console-shell)-[^/]+\.css$/.test(file)) css.add(file)
          }
          return { js: [...js].map(file => base + file), css: [...css].map(file => base + file) }
        }
        const routes = {}
        for (const [route, suffix] of [['/login', '/src/views/Login.vue'], ['/register', '/src/views/Register.vue']]) {
          const entry = fileFor(suffix)
          if (entry) routes[route] = collect([...common, entry])
        }
        const serialized = JSON.stringify(routes).replaceAll('<', '\\u003c')
        const script = `<script>(function(){var hints=${serialized}[window.location.pathname];if(!hints)return;hints.js.forEach(function(href){var link=document.createElement('link');link.rel='modulepreload';link.crossOrigin='';link.href=href;document.head.appendChild(link)});hints.css.forEach(function(href){var link=document.createElement('link');link.rel='preload';link.setAttribute('as','style');link.href=href;document.head.appendChild(link)})})()</script>`
        html.source = html.source.replace('</head>', script + '</head>')
      },
    },
  }
}
