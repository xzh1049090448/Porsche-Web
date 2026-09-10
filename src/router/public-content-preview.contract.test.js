import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { publicContentPreviewHeaders } from '../../scripts/public-content-preview-headers.mjs'
import { routes } from './index.js'

test('direct preview navigation is Root-only and has exact no-store/noindex headers',()=>{
 const route=routes.find(x=>x.path==='/admin/public-content/preview')
 assert.deepEqual(route.meta,{requiresAuth:true,rootOnly:true})
 assert.deepEqual(publicContentPreviewHeaders('/admin/public-content/preview'),{'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'})
 assert.equal(publicContentPreviewHeaders('/admin/public-content/preview/extra'),null)
})

test('preview runtime installs and removes a robots meta element',async()=>{
 const source=await readFile(new URL('../views/PublicContentPreview.vue',import.meta.url),'utf8')
 assert.match(source,/robots\.name='robots'/)
 assert.match(source,/noindex, nofollow, noarchive/)
 assert.match(source,/robots\?\.remove\(\)/)
 const dom=new JSDOM('<meta name="robots" content="noindex, nofollow">')
 assert.equal(dom.window.document.querySelector('meta[name="robots"]').content,'noindex, nofollow')
})
