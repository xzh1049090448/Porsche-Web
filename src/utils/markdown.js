import { marked } from 'marked'
import DOMPurify from 'dompurify'

marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    link({ href, title, text }) {
      const titleAttr = title ? ` title="${title}"` : ''
      return `<a href="${href}" target="_blank" rel="noopener noreferrer"${titleAttr}>${text}</a>`
    },
  },
})

/** 流式输出时补全未闭合的代码块，避免整段渲染错乱 */
function closeOpenCodeFences(text) {
  const count = (text.match(/```/g) || []).length
  return count % 2 !== 0 ? `${text}\n\`\`\`` : text
}

/**
 * 将 Markdown 转为安全 HTML
 * @param {string} text
 * @param {{ streaming?: boolean }} options
 */
export function renderMarkdown(text, options = {}) {
  if (!text) return ''

  let source = text
  if (options.streaming) {
    source = closeOpenCodeFences(source)
  }

  const raw = marked.parse(source, { async: false })
  return DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel'],
  })
}
