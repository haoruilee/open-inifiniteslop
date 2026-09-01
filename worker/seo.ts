export type SeoVideo = {
  id: number
  body: string
  createdAt: number
  updatedAt: number
  durationSeconds: number | null
}

export const seoOrigin = 'https://infiniteaislop.ai'

type PageOptions = {
  title: string
  description: string
  canonicalPath: string
  body: string
  schema?: Record<string, unknown>
  imagePath?: string
  imageWidth?: number
  imageHeight?: number
  videoPath?: string
  robots?: string
}

const escapeMap: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/gu, (character) => escapeMap[character] || character)
}

function compact(value: string) {
  return value.replace(/\s+/gu, ' ').trim()
}

function shorten(value: string, maximum: number) {
  const normalized = compact(value)
  if (!normalized) return 'Untitled community AI video'
  if (normalized.length <= maximum) return normalized
  return `${normalized.slice(0, Math.max(1, maximum - 1)).trimEnd()}…`
}

function pageUrl(path: string, origin = seoOrigin) {
  return new URL(path, origin).toString()
}

function videoName(video: SeoVideo) {
  return `AI video: ${shorten(video.body, 92)}`
}

function videoDescription(video: SeoVideo) {
  return `Watch a community-shaped AI video built from this prompt: ${shorten(video.body, 240)}`
}

function isoDate(timestamp: number) {
  const date = new Date(timestamp)
  return Number.isFinite(date.valueOf()) ? date.toISOString() : new Date(0).toISOString()
}

function humanDate(timestamp: number) {
  const date = new Date(timestamp)
  if (!Number.isFinite(date.valueOf())) return 'recently'
  return new Intl.DateTimeFormat('en', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

function isoDuration(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return null
  return `PT${Math.max(1, Math.round(seconds))}S`
}

function jsonForScript(value: unknown) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/gu, (character) => ({
    '<': '\\u003c',
    '>': '\\u003e',
    '&': '\\u0026',
    '\u2028': '\\u2028',
    '\u2029': '\\u2029',
  })[character] || character)
}

function siteHeader() {
  return `<header class="site-header">
  <a class="wordmark" href="/">Infinite AI Slop</a>
  <nav aria-label="Site">
    <a href="/archive">Archive</a>
    <a href="/about">About</a>
    <a href="/feed.xml">Feed</a>
  </nav>
</header>`
}

function siteFooter() {
  return `<footer>
  <span>by <a href="https://x.com/AI4Azure">@AI4Azure</a></span>
  <span aria-hidden="true">·</span>
  <a href="https://github.com/haoruilee/open-inifiniteslop">Open source</a>
</footer>`
}

function documentPage(options: PageOptions, origin = seoOrigin) {
  const canonical = pageUrl(options.canonicalPath, origin)
  const image = pageUrl(options.imagePath || '/assets/og-card.webp', origin)
  const imageWidth = options.imageWidth || 1200
  const imageHeight = options.imageHeight || 630
  const twitterCard = imageWidth >= 1_000 ? 'summary_large_image' : 'summary'
  const schema = options.schema ? `<script type="application/ld+json">${jsonForScript(options.schema)}</script>` : ''
  const videoMeta = options.videoPath ? `<meta property="og:video" content="${escapeHtml(pageUrl(options.videoPath, origin))}" />
    <meta property="og:video:type" content="video/mp4" />` : ''
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#000000" />
    <meta name="robots" content="${escapeHtml(options.robots || 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1')}" />
    <meta name="description" content="${escapeHtml(options.description)}" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <link rel="alternate" type="application/rss+xml" title="Infinite AI Slop video feed" href="${escapeHtml(pageUrl('/feed.xml', origin))}" />
    <link rel="icon" type="image/png" href="/assets/ai4azure-avatar.png" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Infinite AI Slop" />
    <meta property="og:locale" content="en_US" />
    <meta property="og:title" content="${escapeHtml(options.title)}" />
    <meta property="og:description" content="${escapeHtml(options.description)}" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta property="og:image" content="${escapeHtml(image)}" />
    <meta property="og:image:width" content="${imageWidth}" />
    <meta property="og:image:height" content="${imageHeight}" />
    <meta property="og:image:alt" content="Infinite AI Slop video artwork" />
    ${videoMeta}
    <meta name="twitter:card" content="${twitterCard}" />
    <meta name="twitter:creator" content="@AI4Azure" />
    <meta name="twitter:title" content="${escapeHtml(options.title)}" />
    <meta name="twitter:description" content="${escapeHtml(options.description)}" />
    <meta name="twitter:image" content="${escapeHtml(image)}" />
    <title>${escapeHtml(options.title)}</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #060407; color: #faf7fb; }
      * { box-sizing: border-box; }
      body { min-height: 100vh; margin: 0; background: radial-gradient(circle at 50% -10%, #3e1539 0, #130a18 31%, #060407 68%); }
      a { color: #ff8fe4; text-underline-offset: .18em; }
      .site-header, main, footer { width: min(100% - 32px, 920px); margin-inline: auto; }
      .site-header { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 24px 0; }
      .wordmark { color: #fff; font-size: clamp(1.2rem, 4vw, 1.85rem); font-weight: 900; letter-spacing: -.06em; text-decoration: none; }
      nav { display: flex; flex-wrap: wrap; gap: 14px; font-size: .92rem; }
      nav a { color: #f5e5f3; }
      main { padding: clamp(28px, 6vw, 64px) 0 36px; }
      .kicker { margin: 0 0 12px; color: #ff8fe4; font-size: .8rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
      h1 { max-width: 18ch; margin: 0; font-size: clamp(2rem, 8vw, 4.8rem); line-height: .95; letter-spacing: -.06em; }
      h2 { margin-top: 2.2rem; font-size: 1.25rem; }
      .lede { max-width: 62ch; margin: 22px 0 0; color: #e7dce8; font-size: clamp(1.05rem, 2.4vw, 1.25rem); line-height: 1.55; }
      .video { width: 100%; max-height: min(74vh, 720px); margin-top: 30px; border: 1px solid rgba(255,255,255,.2); border-radius: 20px; background: #000; box-shadow: 0 22px 80px rgba(0,0,0,.5); }
      .prompt, .clip { padding: 18px; border: 1px solid rgba(255,255,255,.16); border-radius: 16px; background: rgba(20,12,24,.76); line-height: 1.55; }
      .meta { color: #c9bccc; font-size: .94rem; line-height: 1.5; }
      .archive-grid { display: grid; gap: 12px; margin-top: 28px; }
      .clip { display: block; color: inherit; text-decoration: none; transition: border-color .15s ease, transform .15s ease; }
      .clip:hover { border-color: #ff8fe4; transform: translateY(-2px); }
      .clip strong { display: block; color: #fff; font-size: 1.03rem; }
      .clip small { display: block; margin-top: 8px; color: #c9bccc; }
      .pager { display: flex; justify-content: space-between; gap: 12px; margin-top: 28px; }
      footer { display: flex; flex-wrap: wrap; gap: 8px; padding: 28px 0 38px; color: #c9bccc; font-size: .9rem; }
      @media (max-width: 520px) { .site-header { align-items: flex-start; flex-direction: column; } h1 { max-width: 100%; } }
    </style>
    ${schema}
  </head>
  <body>
    ${siteHeader()}
    ${options.body}
    ${siteFooter()}
  </body>
</html>`
}

export function renderWatchPage(video: SeoVideo, origin = seoOrigin) {
  const path = `/watch/${video.id}`
  const title = `Watch ${videoName(video)} | Infinite AI Slop`
  const name = videoName(video)
  const description = videoDescription(video)
  const canonical = pageUrl(path, origin)
  const thumbnail = pageUrl(`${path}/thumbnail.svg`, origin)
  const media = pageUrl(`/api/media/${video.id}`, origin)
  const duration = isoDuration(video.durationSeconds)
  const schema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name,
    description,
    thumbnailUrl: thumbnail,
    uploadDate: isoDate(video.createdAt),
    contentUrl: media,
    embedUrl: canonical,
    publisher: {
      '@type': 'Organization',
      name: 'AI4Azure',
      url: 'https://x.com/AI4Azure',
      logo: pageUrl('/assets/ai4azure-avatar.png', origin),
    },
  }
  if (duration) schema.duration = duration
  return documentPage({
    title,
    description,
    canonicalPath: path,
    imagePath: `${path}/thumbnail.svg`,
    imageWidth: 1200,
    imageHeight: 630,
    videoPath: `/api/media/${video.id}`,
    schema,
    body: `<main>
      <p class="kicker">Archived broadcast</p>
      <h1>${escapeHtml(name)}</h1>
      <p class="lede">${escapeHtml(description)}</p>
      <video class="video" controls playsinline preload="metadata" poster="${escapeHtml(pageUrl(`${path}/thumbnail.svg`, origin))}">
        <source src="${escapeHtml(media)}" type="video/mp4" />
        Your browser does not support HTML video.
      </video>
      <h2>Prompt</h2>
      <p class="prompt">${escapeHtml(compact(video.body))}</p>
      <p class="meta">Published ${escapeHtml(humanDate(video.createdAt))}${duration ? ` · ${escapeHtml(duration.replace('PT', '').toLowerCase())}` : ''}. This clip remains available while it is held in the public broadcast archive.</p>
    </main>`,
  }, origin)
}

export function renderArchivePage(videos: SeoVideo[], page: number, hasNext: boolean, origin = seoOrigin) {
  const safePage = Math.max(1, page)
  const canonicalPath = safePage === 1 ? '/archive' : `/archive?page=${safePage}`
  const description = 'Browse real AI video broadcasts currently retained in the Infinite AI Slop public archive.'
  const entries = videos.map((video) => `<a class="clip" href="/watch/${video.id}">
      <strong>${escapeHtml(videoName(video))}</strong>
      <small>${escapeHtml(humanDate(video.createdAt))}${video.durationSeconds ? ` · ${escapeHtml(`${Math.round(video.durationSeconds)}s`)}` : ''}</small>
    </a>`).join('\n') || '<p class="prompt">The archive is warming up. Return to the live channel while new clips arrive.</p>'
  const items = videos.map((video, index) => ({
    '@type': 'ListItem',
    position: (safePage - 1) * 50 + index + 1,
    url: pageUrl(`/watch/${video.id}`, origin),
    name: videoName(video),
  }))
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Infinite AI Slop video archive',
    url: pageUrl(canonicalPath, origin),
    description,
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: items.length,
      itemListElement: items,
    },
  }
  const previous = safePage > 1 ? `<a href="/archive${safePage === 2 ? '' : `?page=${safePage - 1}`}">← Newer clips</a>` : '<span></span>'
  const next = hasNext ? `<a href="/archive?page=${safePage + 1}">Older clips →</a>` : '<span></span>'
  return documentPage({
    title: safePage === 1 ? 'AI Video Archive | Infinite AI Slop' : `AI Video Archive, page ${safePage} | Infinite AI Slop`,
    description,
    canonicalPath,
    schema,
    body: `<main>
      <p class="kicker">Public archive</p>
      <h1>AI video broadcasts, kept watchable.</h1>
      <p class="lede">Each entry below is a real video currently held in the live channel archive. Open a clip to watch it, read its prompt, or share it.</p>
      <section class="archive-grid" aria-label="Archived AI videos">
        ${entries}
      </section>
      <nav class="pager" aria-label="Archive pagination">${previous}${next}</nav>
    </main>`,
  }, origin)
}

export function renderAboutPage(origin = seoOrigin) {
  const description = 'Infinite AI Slop is a live, community-shaped AI video channel with public prompts, moderation, and a rotating broadcast archive.'
  return documentPage({
    title: 'About Infinite AI Slop',
    description,
    canonicalPath: '/about',
    schema: {
      '@context': 'https://schema.org',
      '@type': 'AboutPage',
      name: 'About Infinite AI Slop',
      url: pageUrl('/about', origin),
      description,
      mainEntity: {
        '@type': 'WebSite',
        name: 'Infinite AI Slop',
        url: pageUrl('/', origin),
      },
    },
    body: `<main>
      <p class="kicker">About the channel</p>
      <h1>An always-on AI video channel shaped by the room.</h1>
      <p class="lede">Infinite AI Slop is a live broadcast where the community proposes scenes, votes on ideas, and watches completed clips enter a rotating archive.</p>
      <h2>How it works</h2>
      <p class="prompt">Public prompts are screened before they can become broadcasts. Clearly labelled automated channel-bot prompts keep the feed moving, while community prompts can be voted into the generation queue. Archived clips remain watchable and shareable while retained by the channel.</p>
      <h2>Open source</h2>
      <p class="prompt">The project is maintained by <a href="https://x.com/AI4Azure">@AI4Azure</a>. Source code, license terms, and implementation details are available on <a href="https://github.com/haoruilee/open-inifiniteslop">GitHub</a>.</p>
    </main>`,
  }, origin)
}

export function renderNotFoundPage(origin = seoOrigin) {
  return documentPage({
    title: 'Video not found | Infinite AI Slop',
    description: 'This AI video is no longer in the public archive.',
    canonicalPath: '/archive',
    robots: 'noindex, follow',
    body: `<main>
      <p class="kicker">Archive update</p>
      <h1>This video is no longer on air.</h1>
      <p class="lede">The live archive rotates as new clips arrive. Browse the current archive or return to the channel.</p>
      <p class="prompt"><a href="/archive">Browse the archive</a> · <a href="/">Watch live</a></p>
    </main>`,
  }, origin)
}

export function renderSitemap(videos: SeoVideo[], origin = seoOrigin) {
  const videoEntries = videos.map((video) => {
    const path = `/watch/${video.id}`
    const duration = video.durationSeconds && Number.isFinite(video.durationSeconds) ? `<video:duration>${Math.max(1, Math.round(video.durationSeconds))}</video:duration>` : ''
    return `  <url>
    <loc>${escapeHtml(pageUrl(path, origin))}</loc>
    <lastmod>${escapeHtml(isoDate(video.updatedAt))}</lastmod>
    <video:video>
      <video:thumbnail_loc>${escapeHtml(pageUrl(`${path}/thumbnail.svg`, origin))}</video:thumbnail_loc>
      <video:title>${escapeHtml(videoName(video))}</video:title>
      <video:description>${escapeHtml(videoDescription(video))}</video:description>
      <video:content_loc>${escapeHtml(pageUrl(`/api/media/${video.id}`, origin))}</video:content_loc>
      ${duration}
      <video:publication_date>${escapeHtml(isoDate(video.createdAt))}</video:publication_date>
    </video:video>
  </url>`
  }).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
  <url><loc>${escapeHtml(pageUrl('/', origin))}</loc></url>
  <url><loc>${escapeHtml(pageUrl('/archive', origin))}</loc></url>
  <url><loc>${escapeHtml(pageUrl('/about', origin))}</loc></url>
${videoEntries}
</urlset>`
}

export function renderFeed(videos: SeoVideo[], origin = seoOrigin) {
  const entries = videos.map((video) => {
    const path = `/watch/${video.id}`
    const duration = video.durationSeconds && Number.isFinite(video.durationSeconds) ? ` duration="${Math.max(1, Math.round(video.durationSeconds))}"` : ''
    return `    <item>
      <title>${escapeHtml(videoName(video))}</title>
      <link>${escapeHtml(pageUrl(path, origin))}</link>
      <guid isPermaLink="true">${escapeHtml(pageUrl(path, origin))}</guid>
      <pubDate>${escapeHtml(new Date(video.createdAt).toUTCString())}</pubDate>
      <description>${escapeHtml(videoDescription(video))}</description>
      <media:content url="${escapeHtml(pageUrl(`/api/media/${video.id}`, origin))}" type="video/mp4"${duration} />
      <media:thumbnail url="${escapeHtml(pageUrl(`${path}/thumbnail.svg`, origin))}" />
    </item>`
  }).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Infinite AI Slop — latest AI videos</title>
    <link>${escapeHtml(pageUrl('/', origin))}</link>
    <description>Latest public AI video broadcasts from Infinite AI Slop.</description>
    <language>en</language>
${entries}
  </channel>
</rss>`
}

function wrapSvgText(value: string, maximumCharacters = 42, maximumLines = 4) {
  const words = compact(value).split(' ')
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (candidate.length <= maximumCharacters || !line) {
      line = candidate
      continue
    }
    lines.push(line)
    line = word
    if (lines.length === maximumLines) break
  }
  if (line && lines.length < maximumLines) lines.push(line)
  if (words.join(' ').length > lines.join(' ').length && lines.length > 0) {
    lines[lines.length - 1] = shorten(lines[lines.length - 1], maximumCharacters)
  }
  return lines
}

export function renderVideoThumbnail(video: SeoVideo) {
  const title = videoName(video)
  const lines = wrapSvgText(video.body).map((line, index) => `<text x="96" y="${278 + index * 66}" class="prompt">${escapeHtml(line)}</text>`).join('')
  const duration = video.durationSeconds && Number.isFinite(video.durationSeconds) ? `${Math.max(1, Math.round(video.durationSeconds))} second clip` : 'AI video clip'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-labelledby="title desc">
  <title id="title">${escapeHtml(title)}</title>
  <desc id="desc">${escapeHtml(videoDescription(video))}</desc>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#160b20" />
      <stop offset=".52" stop-color="#08050d" />
      <stop offset="1" stop-color="#240a2a" />
    </linearGradient>
    <linearGradient id="neon" x1="0" y1="0" x2="1" y2="0">
      <stop stop-color="#ff82d8" />
      <stop offset="1" stop-color="#9ab9ff" />
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)" />
  <circle cx="1050" cy="110" r="230" fill="#bd4aaf" opacity=".2" />
  <circle cx="1060" cy="110" r="142" fill="#91b6ff" opacity=".13" />
  <rect x="76" y="76" width="146" height="12" rx="6" fill="url(#neon)" />
  <text x="96" y="156" fill="#ffb2e9" font-family="Arial, sans-serif" font-size="28" font-weight="700" letter-spacing="5">INFINITE AI SLOP</text>
  <text x="96" y="238" fill="#fff" font-family="Arial, sans-serif" font-size="50" font-weight="800">COMMUNITY AI VIDEO</text>
  <g fill="#eee2ed" font-family="Arial, sans-serif" font-size="42">${lines}</g>
  <text x="96" y="546" fill="#cfc0ce" font-family="Arial, sans-serif" font-size="26">${escapeHtml(duration)} · Watch live at infiniteaislop.ai</text>
</svg>`
}

export function isSeoRoute(pathname: string) {
  return pathname === '/sitemap.xml'
    || pathname === '/feed.xml'
    || pathname === '/archive'
    || pathname === '/archive/'
    || pathname === '/about'
    || pathname === '/about/'
    || /^\/watch\/\d+(?:\/thumbnail\.svg)?\/?$/u.test(pathname)
}

export function isTechnicalNoindexPath(pathname: string) {
  return pathname === '/status.json' || (pathname.startsWith('/api/') && !pathname.startsWith('/api/media/'))
}
