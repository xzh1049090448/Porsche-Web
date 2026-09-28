import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import * as validation from './public-content-validation.js'

const { validatePublicContentDraft, renderSafePublicMarkdown } = validation

const window=new JSDOM('<!doctype html><html><body></body></html>').window
const options={window}
const legal='# Terms\n\nVersion: 2026-09\n\nEffective Date: 2026-09-11\n\n## Scope\nText\n\n## Contact\n\nsupport@example.com'
test('accepts reviewed legal documents and exact local model references',()=>{
 const r=validatePublicContentDraft({home:'[Model](/pricing/model-a)',about:'# About',terms:legal,privacy:legal,legalReviewed:true},{modelKeys:['model-a'],...options})
 assert.deepEqual(r.issues,[])
})
test('rejects unsafe urls html events embeds remote images and broken model keys',()=>{
 for(const markdown of ['[x](javascript:alert(1))','<img src=x onerror=alert(1)>','<iframe src="/x">x</iframe>','![x](https://evil.test/x.png)','[x](/pricing/missing)']){
  assert.ok(validatePublicContentDraft({home:markdown,about:'# A',terms:legal,privacy:legal,legalReviewed:true},{modelKeys:['model-a'],...options}).issues.length)
 }
})
test('strict renderer removes executable markup and never fetches remote images',()=>{
 let fetched=false;globalThis.fetch=()=>{fetched=true;throw Error('no')}
 const html=renderSafePublicMarkdown('[ok](/pricing/model-a) <script>alert(1)</script> ![x](https://evil.test/x.png)',options)
 assert.doesNotMatch(html,/script|evil\.test/i);assert.equal(fetched,false)
})
test('legal review and required metadata are explicit blockers',()=>{
 const r=validatePublicContentDraft({home:'# H',about:'# A',terms:'# T',privacy:'# P',legalReviewed:false},{modelKeys:[],...options})
 assert.ok(r.issues.some(x=>x.code==='legal_review_required'))
 assert.ok(r.issues.some(x=>x.code==='legal_metadata_required'))
})

test('backend sanitizer parity corpus preserves exact safe and unsafe cases',()=>{
 const cases=[
  ['script','<ScRiPt>alert(1)</sCrIpT>','unsafe_html'],['event','<p OnClIcK="alert(1)">click</p>','unsafe_html'],['iframe','<iframe src="/assets/a"></iframe>','unsafe_html'],['end-tag','</script>','unsafe_html'],
  ['javascript','[x](javascript:alert(1))','unsafe_url'],['angle','[x](<javascript:alert(1)>)','unsafe_url'],['data','[x](data:text/html;base64,WA==)','unsafe_url'],['relative','[x](//evil.example/path)','unsafe_url'],['percent','[x](j%61v%61script%3Aalert(1))','unsafe_url'],['entity','[x](jav&#x61;script&#58;alert(1))','unsafe_url'],['soft-break','[x](java\nscript:alert(1))','unsafe_url'],['tab','[x](java\tscript:alert(1))','unsafe_url'],['unicode-space','[x](java\u2003script:alert(1))','unsafe_url'],['cf','[x](java\u200bscript:alert(1))','unsafe_url'],['backslash','![x](\\\\169.254.169.254/latest/meta-data)','unsafe_url'],
  ['remote-image','![x](https://169.254.169.254/latest/meta-data)','unsafe_remote_image'],['nested-image','![x[y]](https://169.254.169.254/latest/meta-data)','unsafe_remote_image'],['reference-image','![logo][metadata]\n\n[metadata]: https://169.254.169.254/latest/meta-data','unsafe_remote_image'],['shortcut','[click]\n\n[click]: javascript:alert(1)','unsafe_url'],['escaped-colon','[x](javascript\\:alert(1))','unsafe_url'],['invalid-fence','``` markdown `\n<script>alert(1)</script>','unsafe_html'],['deep-percent','[x](j%25252561vascript%2525253Aalert(1))','unsafe_url'],['nfkc','[x](ｊａｖａｓｃｒｉｐｔ：alert(1))','unsafe_url'],['file','[x](file:///etc/passwd)','unsafe_url'],['blob','[x](blob:https://example.test/id)','unsafe_url'],['ftp','[x](ftp://example.test/a)','unsafe_url'],
 ]
 for(const[name,home,code]of cases){const result=validatePublicContentDraft({home,about:'Safe',terms:legal,privacy:legal,legalReviewed:true},{modelKeys:[],...options});assert.ok(result.issues.some(x=>x.field==='documents.home.body'&&x.code===code),`${name}: ${JSON.stringify(result.issues)}`)}
 for(const home of ['The javascript: URL scheme is not permitted in links.','`![x](https://169.254.169.254/latest/meta-data)`','\\![x](https://169.254.169.254/latest/meta-data)','```markdown\n![x](https://169.254.169.254/latest/meta-data)\n```','<https://example.test/docs>','![logo](</assets/logo.svg>)','![encoded](/assets/%61.png)','![dot](/assets/a%2epng)']){const result=validatePublicContentDraft({home,about:'Safe',terms:legal,privacy:legal,legalReviewed:true},{modelKeys:[],...options});assert.equal(result.issues.filter(x=>x.field==='documents.home.body').length,0,home)}
})
test('canonical URL decoding reaches stability or fails closed without accepting a partial decode',()=>{const nest=(value,count)=>{for(let i=0;i<count;i++)value=encodeURIComponent(value);return value};for(const depth of [9,10,12,63,65,512]){const out=validatePublicContentDraft({home:`[x](${nest('javascript:alert(1)',depth)})`,about:'Safe',terms:legal,privacy:legal,legalReviewed:true},{modelKeys:[],...options});assert.deepEqual(out.issues.filter(x=>x.code==='unsafe_url').map(x=>x.field),['documents.home.body'],`depth ${depth}`)}const malformed=validatePublicContentDraft({home:'[x](%zz)',about:'Safe',terms:legal,privacy:legal,legalReviewed:true},{modelKeys:[],...options});assert.deepEqual(malformed.issues.filter(x=>x.code==='unsafe_url').map(x=>x.field),['documents.home.body'])})

const structured = () => ({ revision: 5, documents: { revision: 5, about: '# About', terms: legal, privacy: legal, legalReviewed: true }, home: { revision: 5, announcements: [{ guid: '1', title: 'News', bodyMarkdown: 'Safe', effectiveAt: null, isVisible: true, sortOrder: 1 }], faqs: [{ guid: '2', question: 'Q?', answerMarkdown: 'Safe', isVisible: false, sortOrder: 1 }], featuredModelKeys: ['model-a'] } })
const priceRelease = () => ({ release: { guid: '7', version: 3 }, items: [{ modelKey: 'model-a', releaseVersion: 3 }] })

test('structured validation covers documents home markdown and bound price release', () => {
 assert.equal(typeof validation.validateStructuredPublicContent, 'function')
 const result = validation.validateStructuredPublicContent(structured(), { priceRelease: priceRelease(), ...options })
 assert.deepEqual(result.issues, [])
 for (const mutate of [
  value => { value.home.announcements[0].bodyMarkdown = '[x](javascript:alert(1))' },
  value => { value.home.faqs[0].answerMarkdown = '![x](https://evil.test/x.png)' },
  value => { value.documents.about = '<iframe src="/x"></iframe>' },
 ]) {
  const value = structured(); mutate(value)
  assert.equal(validation.validateStructuredPublicContent(value, { priceRelease: priceRelease(), ...options }).valid, false)
 }
})

test('structured validation rejects count limits and incomplete mixed-version featured releases', () => {
 const tooMany = structured(); tooMany.home.announcements = Array.from({ length: 21 }, (_, index) => ({ guid: String(index + 1), title: 'N', bodyMarkdown: 'B', effectiveAt: null, isVisible: true, sortOrder: index }))
 assert.ok(validation.validateStructuredPublicContent(tooMany, { priceRelease: { release: { guid: '7', version: 3 }, items: [] }, ...options }).issues.some(issue => issue.code === 'announcement_limit_exceeded'))
 const duplicate = priceRelease(); duplicate.items.push({ modelKey: 'model-a', releaseVersion: 3 })
 assert.ok(validation.validateStructuredPublicContent(structured(), { priceRelease: duplicate, ...options }).issues.some(issue => issue.code === 'featured_model_invalid'))
 const mixed = priceRelease(); mixed.items[0].releaseVersion = 2
 assert.ok(validation.validateStructuredPublicContent(structured(), { priceRelease: mixed, ...options }).issues.some(issue => issue.code === 'price_release_mismatch'))
})
