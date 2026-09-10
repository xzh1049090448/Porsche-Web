import createDOMPurify from 'dompurify'
import { marked } from 'marked'

const MODEL_PATH = /^\/pricing\/([A-Za-z0-9][A-Za-z0-9._-]*)$/
const controlOrSlashBypass = /[\u0000-\u001f\u007f\\]/
export function selectCuratedModels(keys, catalog) { const byKey = new Map((Array.isArray(catalog) ? catalog : []).map(model => [model?.modelKey, model])); const seen = new Set(); return (Array.isArray(keys) ? keys : []).filter(key => typeof key === 'string' && !seen.has(key) && seen.add(key)).map(key => byKey.get(key)).filter(Boolean) }
export function controlledAssetSrc(value) { return typeof value === 'string' && /^\/assets\/[A-Za-z0-9._/-]+$/.test(value) && !value.includes('%') && !value.includes('//') && !value.endsWith('/') && value.split('/').every(segment => segment !== '.' && segment !== '..') }
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
  if (!['http:', 'https:'].includes(url.protocol) || !url.host) return false
  return allowedExternal.includes(clean)
}
function externalLinks(markdown) { return [...markdown.matchAll(/\]\((https?:\/\/[^\s)]+)(?:\s+['"][^'"]*['"])?\)/gi)].map(match => match[1]).filter(value => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && Boolean(url.host) } catch { return false } }) }
function sectionName(text) { const value = text.trim().toLowerCase(); if (/优势|advantage|benefit/.test(value)) return 'advantages'; if (/支持模型|模型|models?/.test(value)) return 'models'; if (/公告|announcement|notice/.test(value)) return 'announcements'; if (/常见问题|faq|questions?/.test(value)) return 'faq'; if (/演示|demo|preview/.test(value)) return 'demo'; if (/导航|链接|navigation|links?/.test(value)) return 'links'; if (/开始|立即|cta|get started/.test(value)) return 'cta'; if (/联系|contact/.test(value)) return 'contact'; return 'other' }

export function createPublishedDocumentCodec({ window = globalThis.window } = {}) {
  if (!window?.document) throw new Error('public_document_window_required')
  const purifier = typeof createDOMPurify.sanitize === 'function' ? createDOMPurify : createDOMPurify(window)
  function decode(markdown) {
    if (typeof markdown !== 'string') throw new Error('invalid_public_document')
    const allowedExternal = [...new Set(externalLinks(markdown))]
    const cleaned = purifier.sanitize(marked.parse(markdown), { USE_PROFILES: { html: true }, FORBID_TAGS: ['picture', 'svg', 'video', 'audio', 'iframe', 'object', 'embed', 'form', 'input'], FORBID_ATTR: ['style', 'srcset'] })
    const template = window.document.createElement('template'); template.innerHTML = cleaned
    for (const anchor of template.content.querySelectorAll('a[href]')) if (!safePublishedHref(anchor.getAttribute('href'), allowedExternal)) anchor.replaceWith(...anchor.childNodes)
    for (const image of template.content.querySelectorAll('img')) { image.removeAttribute('srcset'); if (!controlledAssetSrc(image.getAttribute('src'))) image.remove() }
    const headings = [...template.content.querySelectorAll('h1,h2,h3')]
    const title = headings.find(node => node.tagName === 'H1')?.textContent.trim() || ''
    const intro = window.document.createElement('div'); let introNode = template.content.firstChild; while (introNode && !(introNode.nodeType === 1 && introNode.tagName === 'H2')) { if (!(introNode.nodeType === 1 && introNode.tagName === 'H1')) intro.append(introNode.cloneNode(true)); introNode = introNode.nextSibling }
    const sections = { advantages: [], models: [], announcements: [], faq: [], demo: [], links: [], cta: [], contact: [], other: [] }
    for (const heading of headings.filter(node => node.tagName === 'H2')) {
      const name = sectionName(heading.textContent); const wrapper = window.document.createElement('div')
      let next = heading.nextSibling; while (next && !(next.nodeType === 1 && next.tagName === 'H2')) { if (!(next.nodeType === 1 && next.tagName === 'H1')) wrapper.append(next.cloneNode(true)); next = next.nextSibling }
      sections[name].push(wrapper.innerHTML)
    }
    const modelKeys = []; const modelAssets = {}; for (const anchor of template.content.querySelectorAll('a[href]')) { const match = anchor.getAttribute('href').match(MODEL_PATH); if (match && !modelKeys.includes(match[1])) modelKeys.push(match[1]); const asset = anchor.querySelector('img')?.getAttribute('src'); if (match && controlledAssetSrc(asset) && !modelAssets[match[1]]) modelAssets[match[1]] = asset }
    const body = template.content.cloneNode(true); for (const heading of body.querySelectorAll('h1')) heading.remove()
    const advantageCards = []; const advantageHeading = [...template.content.querySelectorAll('h2')].find(node => sectionName(node.textContent) === 'advantages')
    if (advantageHeading) { let current = null; let next = advantageHeading.nextSibling; while (next && !(next.nodeType === 1 && next.tagName === 'H2')) { if (next.nodeType === 1 && next.tagName === 'H3') { current = advantageCards.length < 8 ? { title: next.textContent.trim(), html: '' } : null; if (current) advantageCards.push(current) } else if (current) { const holder = window.document.createElement('div'); holder.append(next.cloneNode(true)); current.html += holder.innerHTML } next = next.nextSibling } }
    const linkHeading = [...template.content.querySelectorAll('h2')].find(node => sectionName(node.textContent) === 'links'); const shellLinks = []
    if (linkHeading) { let next = linkHeading.nextSibling; while (next && !(next.nodeType === 1 && next.tagName === 'H2')) { if (next.nodeType === 1) for (const anchor of next.matches('a[href]') ? [next] : next.querySelectorAll('a[href]')) shellLinks.push({ label: anchor.textContent.trim(), href: anchor.getAttribute('href'), placement: /联系|contact/i.test(anchor.textContent) ? 'contact' : 'header' }); next = next.nextSibling } }
    return { markdown, html: template.innerHTML, bodyHTML: (() => { const holder = window.document.createElement('div'); holder.append(body); return holder.innerHTML })(), introHTML: intro.innerHTML, title, headings: headings.map(node => ({ level: Number(node.tagName[1]), text: node.textContent.trim() })), sections, advantageCards, shellLinks, modelKeys, modelAssets, allowedExternal }
  }
  function legal(document) {
    const version = document.markdown.match(/^[ \t]*(?:版本|version)[ \t]*[：:][ \t]*(\S.*?)[ \t]*$/im)?.[1]?.trim() || ''
    const effectiveDate = document.markdown.match(/^[ \t]*(?:生效日期|effective date)[ \t]*[：:][ \t]*(\S.*?)[ \t]*$/im)?.[1]?.trim() || ''
    const contactHTML = document.sections.contact.join(''); const holder = window.document.createElement('div'); holder.innerHTML = contactHTML
    const contact = holder.textContent.trim(); const toc = document.headings.filter(item => item.level === 2 && sectionName(item.text) !== 'contact')
    const bodyRoot = window.document.createElement('div'); bodyRoot.innerHTML = document.bodyHTML
    const bodyPresent = [...bodyRoot.querySelectorAll('h2')].filter(heading => sectionName(heading.textContent) !== 'contact').some(heading => { let text = ''; let next = heading.nextSibling; while (next && !(next.nodeType === 1 && next.tagName === 'H2')) { text += next.textContent || ''; next = next.nextSibling } return Boolean(text.trim()) })
    for (const paragraph of [...bodyRoot.querySelectorAll('p')]) if (/^\s*(?:版本|version|生效日期|effective date)\s*[：:]/i.test(paragraph.textContent)) paragraph.remove()
    const contactHeadings = [...bodyRoot.querySelectorAll('h2')].filter(heading => sectionName(heading.textContent) === 'contact'); for (const contactHeading of contactHeadings) { let next = contactHeading.nextSibling; while (next && !(next.nodeType === 1 && next.tagName === 'H2')) { const remove = next; next = next.nextSibling; remove.remove() } contactHeading.remove() }
    let index = 0; for (const heading of bodyRoot.querySelectorAll('h2')) heading.id = `legal-section-${++index}`
    return { ...document, version, effectiveDate, contact, toc: toc.map((item, itemIndex) => ({ ...item, id: `legal-section-${itemIndex + 1}` })), legalBodyHTML: bodyRoot.innerHTML, valid: Boolean(document.title && version && effectiveDate && bodyPresent && toc.length && contact) }
  }
  return { decode, legal }
}
