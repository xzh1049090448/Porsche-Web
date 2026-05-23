/** 导出对话为 Markdown */
export function exportToMarkdown(conversation) {
  const lines = [`# ${conversation.title || '对话记录'}`, '', `> 导出时间：${new Date().toLocaleString('zh-CN')}`, '']

  for (const msg of conversation.messages || []) {
    const role = msg.role === 'user' ? '**用户**' : '**助手**'
    lines.push(`### ${role}`, '', msg.content, '')
    if (msg.datasetUsed) {
      lines.push(`> ${msg.datasetBadge || '基于专属数据集生成'}`, '')
    }
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

/** 简易 PDF：通过打印窗口（浏览器原生） */
export function exportToPdf(conversation) {
  const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>${conversation.title || '对话记录'}</title>
<style>
  body { font-family: "Microsoft YaHei", sans-serif; padding: 24px; line-height: 1.6; }
  h1 { font-size: 20px; }
  .msg { margin: 16px 0; padding: 12px; border-radius: 8px; }
  .user { background: #ecf5ff; }
  .assistant { background: #f0f9eb; }
  .badge { font-size: 12px; color: #67c23a; margin-top: 8px; }
</style></head>
<body>
  <h1>${conversation.title || '对话记录'}</h1>
  <p style="color:#909399;font-size:12px">导出时间：${new Date().toLocaleString('zh-CN')}</p>
  ${(conversation.messages || [])
    .map(
      (m) => `
    <div class="msg ${m.role}">
      <strong>${m.role === 'user' ? '用户' : '助手'}</strong>
      <div>${m.content.replace(/\n/g, '<br>')}</div>
      ${m.datasetUsed ? `<div class="badge">本回答基于已确权跨境电商专属数据集生成</div>` : ''}
    </div>`
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
