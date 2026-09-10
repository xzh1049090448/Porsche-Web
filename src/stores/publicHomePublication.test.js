import test from 'node:test'
import assert from 'node:assert/strict'
import { createPublicContentState } from './publicContent.js'
import { createPublicHomePublication } from './publicHomePublication.js'

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const response = (data, versions) => ({ data, etag: '"x"', releaseVersion: Object.values(versions)[0], publicationVersions: versions })

test('out-of-order site and home responses cannot expose a mixed shell and body generation', async () => {
  const siteV1 = deferred(); const homeV2 = deferred(); let siteCalls = 0; let homeCalls = 0; const decoded = []
  const store = createPublicContentState({ api: { getSite: () => ++siteCalls === 1 ? siteV1.promise : Promise.resolve(response({ contentReleaseVersion: 2, priceReleaseVersion: 4, priceVisibility: 'visible' }, { content: 2, price: 4 })), getHome: () => ++homeCalls === 1 ? homeV2.promise : Promise.resolve(response({ document: 'generation-2', releaseVersion: 2 }, { content: 2 })), getModel: () => Promise.reject(new Error('unexpected_model')) } })
  const publication = createPublicHomePublication({ store, decode: document => { decoded.push(document); return { marker: document, shellLinks: [{ label: document }], modelKeys: [] } } })
  const loading = publication.load(); siteV1.resolve(response({ contentReleaseVersion: 1, priceReleaseVersion: 3, priceVisibility: 'visible' }, { content: 1, price: 3 })); await Promise.resolve(); assert.equal(publication.home.value, null); homeV2.resolve(response({ document: 'generation-2', releaseVersion: 2 }, { content: 2 })); await loading
  assert.deepEqual(decoded, ['generation-2']); assert.equal(publication.home.value.marker, 'generation-2'); assert.equal(publication.home.value.shellLinks[0].label, 'generation-2'); assert.equal(siteCalls, 2); assert.equal(homeCalls, 2)
})

test('one verified decoded projection supplies shell and home content', async () => {
  const store = createPublicContentState({ api: { getSite: () => Promise.resolve(response({ contentReleaseVersion: 2, priceReleaseVersion: 4, priceVisibility: 'visible' }, { content: 2, price: 4 })), getHome: () => Promise.resolve(response({ document: 'generation-2', releaseVersion: 2 }, { content: 2 })), getModel: () => Promise.reject(new Error('unexpected_model')) } })
  const publication = createPublicHomePublication({ store, decode: document => ({ marker: document, shellLinks: [{ label: document }], modelKeys: [] }) })
  const projected = await publication.load(); assert.equal(projected, publication.home.value); assert.equal(projected.marker, projected.shellLinks[0].label)
})
