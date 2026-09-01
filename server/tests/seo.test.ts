import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isSeoRoute,
  isTechnicalNoindexPath,
  renderArchivePage,
  renderFeed,
  renderSitemap,
  renderVideoThumbnail,
  renderWatchPage,
  type SeoVideo,
} from '../../worker/seo.js'

const sample: SeoVideo = {
  id: 42,
  body: 'a clockwork fox <script>alert("not markup")</script> walking through a city of paper moons',
  createdAt: Date.UTC(2026, 8, 1, 12, 0, 0),
  updatedAt: Date.UTC(2026, 8, 1, 12, 5, 0),
  durationSeconds: 10.4,
}

test('renders a truthful, escaped watch page with VideoObject markup', () => {
  const page = renderWatchPage(sample)
  assert.match(page, /<video class="video" controls playsinline preload="metadata"/u)
  assert.match(page, /https:\/\/infiniteaislop\.ai\/api\/media\/42/u)
  assert.match(page, /"@type":"VideoObject"/u)
  assert.match(page, /"duration":"PT10S"/u)
  assert.match(page, /&lt;script&gt;alert/u)
  assert.equal(page.includes('<script>alert'), false)
})

test('lists only canonical watch pages in the video sitemap and feed', () => {
  const sitemap = renderSitemap([sample])
  assert.match(sitemap, /xmlns:video=/u)
  assert.match(sitemap, /https:\/\/infiniteaislop\.ai\/watch\/42/u)
  assert.match(sitemap, /<video:content_loc>https:\/\/infiniteaislop\.ai\/api\/media\/42<\/video:content_loc>/u)
  assert.match(sitemap, /&lt;script&gt;/u)

  const feed = renderFeed([sample])
  assert.match(feed, /<rss version="2\.0"/u)
  assert.match(feed, /media:thumbnail url="https:\/\/infiniteaislop\.ai\/watch\/42\/thumbnail\.svg"/u)
})

test('renders useful archive links and a per-video visual thumbnail', () => {
  const archive = renderArchivePage([sample], 1, false)
  assert.match(archive, /href="\/watch\/42"/u)
  assert.match(archive, /CollectionPage/u)

  const thumbnail = renderVideoThumbnail(sample)
  assert.match(thumbnail, /^<svg /u)
  assert.match(thumbnail, /INFINITE AI SLOP/u)
  assert.equal(thumbnail.includes('<script>alert'), false)
})

test('routes only real SEO pages through the worker and keeps technical APIs out of search', () => {
  assert.equal(isSeoRoute('/sitemap.xml'), true)
  assert.equal(isSeoRoute('/watch/42'), true)
  assert.equal(isSeoRoute('/watch/42/thumbnail.svg'), true)
  assert.equal(isSeoRoute('/api/state'), false)
  assert.equal(isTechnicalNoindexPath('/api/state'), true)
  assert.equal(isTechnicalNoindexPath('/status.json'), true)
  assert.equal(isTechnicalNoindexPath('/api/media/42'), false)
})
