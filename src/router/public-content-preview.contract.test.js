import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { preview } from 'vite'
import { publicContentPreviewHeaders, publicContentPreviewProtection } from '../../scripts/public-content-preview-headers.mjs'

const browserDom=new JSDOM('<!doctype html><html><head></head><body></body></html>',{url:'https://local.test/'})
for(const key of ['window','document','location','history','navigator','Node','Element','HTMLElement','SVGElement','Event','MutationObserver'])Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:browserDom.window[key]})
const { routes } = await import('./index.js')

test('direct preview navigation is Root-only and has exact no-store/noindex headers',()=>{
 const route=routes.find(x=>x.path==='/admin/public-content/preview')
 assert.deepEqual(route.meta,{requiresAuth:true,rootOnly:true})
 assert.deepEqual(publicContentPreviewHeaders('/admin/public-content/preview'),{'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'})
 assert.equal(publicContentPreviewHeaders('/admin/public-content/preview/extra'),null)
})

test('real Vite Preview keeps protection after its static middleware sets cache headers',async()=>{
 const root=await mkdtemp(join(tmpdir(),'public-content-preview-')),outDir=join(root,'dist')
 await mkdir(outDir);await writeFile(join(outDir,'index.html'),'<!doctype html><title>preview</title>')
 const server=await preview({root,configFile:false,logLevel:'silent',plugins:[publicContentPreviewProtection()],preview:{host:'127.0.0.1',port:0,strictPort:false},build:{outDir}})
 try{const address=server.httpServer.address(),response=await fetch(`http://127.0.0.1:${address.port}/admin/public-content/preview?revision=2`);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-robots-tag'),'noindex, nofollow')}
 finally{await new Promise(resolve=>server.httpServer.close(resolve));await rm(root,{recursive:true,force:true})}
})

test('preview runtime installs and removes a robots meta element',async()=>{
 const source=await readFile(new URL('../views/PublicContentPreview.vue',import.meta.url),'utf8')
 assert.match(source,/robots\.name\s*=\s*['"]robots/)
 assert.match(source,/noindex, nofollow, noarchive/)
 assert.match(source,/robots\?\.remove\(\)/)
 const dom=new JSDOM('<meta name="robots" content="noindex, nofollow">')
 assert.equal(dom.window.document.querySelector('meta[name="robots"]').content,'noindex, nofollow')
})

test('preview visibly identifies unpublished content without weakening sanitization',async()=>{
 const source=await readFile(new URL('../views/PublicContentPreview.vue',import.meta.url),'utf8')
 assert.match(source,/class="preview-banner"/)
 assert.match(source,/role="status"/)
 assert.match(source,/renderSafePublicMarkdown/)
 assert.doesNotMatch(source,/v-html="documents/)
})

test('structured preview reuses the fixed Home and only the three Root draft/release sources', async () => {
 const source=await readFile(new URL('../views/PublicContentPreview.vue',import.meta.url),'utf8')
 const loader=await readFile(new URL('../api/publicContentAdmin.js',import.meta.url),'utf8')
 assert.match(source,/import Home from ['"]@\/views\/public\/Home\.vue['"]/)
 assert.match(loader,/getDocumentsDraft/)
 assert.match(loader,/previewHome/)
 assert.match(source,/publicPricingAdminApi/)
 assert.match(source,/priceReleaseGuid/)
 assert.doesNotMatch(source,/publicContentAdminApi\.preview|publicContentApi|getHomeConfig/)
 assert.match(source,/preview-draft-status/)
})

test('preview restores an existing robots directive rather than deleting page policy',async()=>{
 const source=await readFile(new URL('../views/PublicContentPreview.vue',import.meta.url),'utf8')
 assert.match(source,/previousRobotsContent/)
 assert.match(source,/robots\.content\s*=\s*previousRobotsContent/)
})

test('mounted structured preview renders fixed Home with a ready provider and restores robots', async () => {
 document.head.innerHTML='<meta name="robots" content="index, follow">';document.body.replaceChildren()
 const [{mount},{nextTick}]=await Promise.all([import('@vue/test-utils'),import('vue')])
 const source=await readFile(new URL('../views/PublicContentPreview.vue',import.meta.url),'utf8'),descriptor=parse(source,{filename:'PublicContentPreview.vue'}).descriptor
 const script=compileScript(descriptor,{id:'task11-preview',genDefaultAs:'__sfc__'}),template=compileTemplate({id:'task11-preview',filename:'PublicContentPreview.vue',source:descriptor.template.content,compilerOptions:{bindingMetadata:script.bindings}})
 assert.deepEqual(template.errors,[])
 const vueURL=new URL('../../node_modules/vue/index.mjs',import.meta.url).href,data=code=>`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
 const modules=new Map([
  ['vue',vueURL],['vue-router',data("export const useRoute=()=>({query:{revision:'5',priceReleaseGuid:'7'}})")],
  ['@/api/publicContentAdmin.js',data('export const loadStructuredContentPreview=args=>globalThis.__previewLoad(args)')],
  ['@/api/publicHomeContentAdmin.js',data('export const publicHomeContentAdminApi={name:"home"}')],
  ['@/api/publicPricingAdmin.js',data('export const publicPricingAdminApi={name:"pricing"}')],
  ['@/utils/public-content-validation.js',data('export const renderSafePublicMarkdown=value=>`<p>${value}</p>`')],
  ['@/composables/useI18n',data('export const useI18n=()=>({t:key=>key})')],
  ['@/views/public/Home.vue',data(`import{defineComponent,h,inject}from'${vueURL}';export default defineComponent({setup(){const p=inject('public-home-publication');return()=>h('section',{id:'home-title','data-status':p.homeContent.value.value.status,'data-featured':p.publication.value.featuredModels.value.length},'fixed home')}})`) ],
  ['@/components/public/PublicHeader.vue',data(`import{defineComponent,h}from'${vueURL}';export default defineComponent({setup:()=>()=>h('header')})`)],
  ['@/components/public/PublicFooter.vue',data(`import{defineComponent,h}from'${vueURL}';export default defineComponent({setup:()=>()=>h('footer')})`)],
 ])
 let code=`${script.content}\n${template.code}\n__sfc__.render=render\nexport default __sfc__`
 for(const[from,to]of modules)code=code.replaceAll(`from '${from}'`,`from '${to}'`).replaceAll(`from'${from}'`,`from'${to}'`).replaceAll(`from "${from}"`,`from "${to}"`)
 code=code.replace("import '@/styles/public-content.scss'",'')
 globalThis.__previewLoad=async()=>({revision:5,documents:{about:'A',terms:'T',privacy:'P'},home:{announcements:[],faqs:[],featuredModelKeys:[]},featuredModels:[]})
 const component=(await import(data(code))).default,wrapper=mount(component,{attachTo:document.body})
 for(let index=0;index<5;index++)await nextTick();await new Promise(resolve=>setTimeout(resolve,0));await nextTick()
 assert.equal(wrapper.get('#home-title').attributes('data-status'),'ready');assert.equal(wrapper.get('#home-title').attributes('data-featured'),'0')
 assert.equal(document.head.querySelector('meta[name="robots"]').content,'noindex, nofollow, noarchive')
 wrapper.unmount();assert.equal(document.head.querySelector('meta[name="robots"]').content,'index, follow')
 delete globalThis.__previewLoad
})
