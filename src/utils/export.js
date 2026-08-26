/** 导出对话为 Markdown */
export function exportToMarkdown(conversation) {
  const lines = [`# ${conversation.title || '对话记录'}`, '', `> 导出时间：${new Date().toLocaleString('zh-CN')}`, '']

  for (const msg of conversation.messages || []) {
    const role = msg.role === 'user' ? '**用户**' : '**助手**'
    lines.push(`### ${role}`, '', msg.content, '')
  }

  return lines.join('\n')
}

export function downloadFile(content, filename, mime = 'text/markdown;charset=utf-8') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function escapeHTML(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 简易 PDF：通过打印窗口（浏览器原生） */
export function exportToPdf(conversation) {
  const title = escapeHTML(conversation.title || '对话记录')
  const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>${title}</title>
<style>
  body { font-family: "Microsoft YaHei", sans-serif; padding: 24px; line-height: 1.6; }
  h1 { font-size: 20px; }
  .msg { margin: 16px 0; padding: 12px; border-radius: 8px; }
  .user { background: #ecf5ff; }
  .assistant { background: #f0f9eb; }
  .badge { font-size: 12px; color: #67c23a; margin-top: 8px; }
</style></head>
<body>
  <h1>${title}</h1>
  <p style="color:#909399;font-size:12px">导出时间：${new Date().toLocaleString('zh-CN')}</p>
  ${(conversation.messages || [])
    .map(
      (m) => {
        const role = m.role === 'user' ? 'user' : 'assistant'
        const content = escapeHTML(m.content).replace(/\n/g, '<br>')
        return `
    <div class="msg ${role}">
      <strong>${role === 'user' ? '用户' : '助手'}</strong>
      <div>${content}</div>
    </div>`
      }
    )
    .join('')}
</body></html>`
  const win = window.open('', '_blank')
  win.document.write(html)
  win.document.close()
  win.onload = () => {
    win.print()
  }
}
