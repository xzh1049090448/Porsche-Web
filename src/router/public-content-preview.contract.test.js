import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'
import { preview } from 'vite'
import { publicContentPreviewHeaders, publicContentPreviewProtection } from '../../scripts/public-content-preview-headers.mjs'
import { routes } from './index.js'

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
 assert.match(source,/robots\.name='robots'/)
 assert.match(source,/noindex, nofollow, noarchive/)
 assert.match(source,/robots\?\.remove\(\)/)
 const dom=new JSDOM('<meta name="robots" content="noindex, nofollow">')
 assert.equal(dom.window.document.querySelector('meta[name="robots"]').content,'noindex, nofollow')
})
