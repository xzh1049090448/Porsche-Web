import createDOMPurify from 'dompurify'
import { marked } from 'marked'

const MODEL_PATH = /^\/pricing\/([A-Za-z0-9][A-Za-z0-9._-]*)$/
const controlOrSlashBypass = /[\u0000-\u001f\u007f\\]/
export function selectCuratedModels(keys, catalog) { const byKey = new Map((Array.isArray(catalog) ? catalog : []).map(model => [model?.modelKey, model])); const seen = new Set(); return (Array.isArray(keys) ? keys : []).filter(key => typeof key === 'string' && !seen.has(key) && seen.add(key)).map(key => byKey.get(key)).filter(Boolean) }
function decoded(value) { let result = value; for (let i = 0; i < 3; i++) { try { const next = decodeURIComponent(result); if (next === result) break; result = next } catch { return '' } } return result }
export function safePublishedHref(value, allowedExternal = []) {
  if (typeof value !== 'string' || !value || value === '#' || controlOrSlashBypass.test(value)) return false
  const clean = decoded(value.trim()); if (!clean || clean.startsWith('//') || controlOrSlashBypass.test(clean)) return false
  if (clean.startsWith('#')) return /^#[A-Za-z][A-Za-z0-9._:-]*$/.test(clean)
  if (clean.startsWith('/')) {
    const path = clean.split(/[?#]/, 1)[0]
    return ['/', '/pricing', '/about', '/terms', '/privacy', '/chat', '/login', '/register'].includes(path) || MODEL_PATH.test(path)
  }
  let url; try { url = new URL(clean) } catch { return false }
  if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return false
  return allowedExternal.includes(clean)
}
function externalLinks(markdown) { return [...markdown.matchAll(/\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)(?:\s+['"][^'"]*['"])?\)/gi)].map(match => match[1]).filter(value => { try { return ['http:', 'https:', 'mailto:'].includes(new URL(value).protocol) } catch { return false } }) }
function sectionName(text) { const value = text.trim().toLowerCase(); if (/优势|advantage|benefit/.test(value)) return 'advantages'; if (/支持模型|模型|models?/.test(value)) return 'models'; if (/公告|announcement|notice/.test(value)) return 'announcements'; if (/常见问题|faq|questions?/.test(value)) return 'faq'; if (/演示|demo|preview/.test(value)) return 'demo'; if (/开始|立即|cta|get started/.test(value)) return 'cta'; if (/联系|contact/.test(value)) return 'contact'; return 'other' }

export function createPublishedDocumentCodec({ window = globalThis.window } = {}) {
  if (!window?.document) throw new Error('public_document_window_required')
  const purifier = typeof createDOMPurify.sanitize === 'function' ? createDOMPurify : createDOMPurify(window)
  function decode(markdown) {
    if (typeof markdown !== 'string') throw new Error('invalid_public_document')
    const allowedExternal = [...new Set(externalLinks(markdown))]
    const cleaned = purifier.sanitize(marked.parse(markdown), { USE_PROFILES: { html: true }, FORBID_TAGS: ['img', 'picture', 'svg', 'video', 'audio', 'iframe', 'object', 'embed', 'form', 'input'], FORBID_ATTR: ['style', 'src', 'srcset'] })
    const template = window.document.createElement('template'); template.innerHTML = cleaned
    for (const anchor of template.content.querySelectorAll('a[href]')) if (!safePublishedHref(anchor.getAttribute('href'), allowedExternal)) anchor.replaceWith(...anchor.childNodes)
    const headings = [...template.content.querySelectorAll('h1,h2,h3')]
    const title = headings.find(node => node.tagName === 'H1')?.textContent.trim() || ''
    const intro = window.document.createElement('div'); let introNode = template.content.firstChild; while (introNode && !(introNode.nodeType === 1 && introNode.tagName === 'H2')) { if (!(introNode.nodeType === 1 && introNode.tagName === 'H1')) intro.append(introNode.cloneNode(true)); introNode = introNode.nextSibling }
    const sections = { advantages: [], models: [], announcements: [], faq: [], demo: [], cta: [], contact: [], other: [] }
    for (const heading of headings.filter(node => node.tagName === 'H2')) {
      const name = sectionName(heading.textContent); const wrapper = window.document.createElement('div')
      let next = heading.nextSibling; while (next && !(next.nodeType === 1 && next.tagName === 'H2')) { wrapper.append(next.cloneNode(true)); next = next.nextSibling }
      sections[name].push(wrapper.innerHTML)
    }
    const modelKeys = []; for (const anchor of template.content.querySelectorAll('a[href]')) { const match = anchor.getAttribute('href').match(MODEL_PATH); if (match && !modelKeys.includes(match[1])) modelKeys.push(match[1]) }
    return { markdown, html: template.innerHTML, introHTML: intro.innerHTML, title, headings: headings.map(node => ({ level: Number(node.tagName[1]), text: node.textContent.trim() })), sections, modelKeys, allowedExternal }
  }
  function legal(document) {
    const version = document.markdown.match(/^[ \t]*(?:版本|version)[ \t]*[：:][ \t]*(\S.*?)[ \t]*$/im)?.[1]?.trim() || ''
    const effectiveDate = document.markdown.match(/^[ \t]*(?:生效日期|effective date)[ \t]*[：:][ \t]*(\S.*?)[ \t]*$/im)?.[1]?.trim() || ''
    const contactHTML = document.sections.contact.join(''); const holder = window.document.createElement('div'); holder.innerHTML = contactHTML
    const contact = holder.textContent.trim(); const toc = document.headings.filter(item => item.level === 2 && sectionName(item.text) !== 'contact')
    const bodyRoot = window.document.createElement('div'); bodyRoot.innerHTML = document.html
    const bodyPresent = [...bodyRoot.querySelectorAll('h2')].filter(heading => sectionName(heading.textContent) !== 'contact').some(heading => { let text = ''; let next = heading.nextSibling; while (next && !(next.nodeType === 1 && next.tagName === 'H2')) { text += next.textContent || ''; next = next.nextSibling } return Boolean(text.trim()) })
    return { ...document, version, effectiveDate, contact, toc, valid: Boolean(document.title && version && effectiveDate && bodyPresent && toc.length && contact) }
  }
  return { decode, legal }
}
