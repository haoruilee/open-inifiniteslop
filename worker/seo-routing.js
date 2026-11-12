/** Normalize only public SEO pages; never redirect API or mutation requests. */
export function canonicalSeoRedirect(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const url = new URL(request.url);
  if (!['infiniteaislop.ai', 'www.infiniteaislop.ai'].includes(url.hostname)) return null;
  const path = url.pathname;
  let canonicalPath;
  if (path === '/about' || path === '/about/') {
    canonicalPath = '/about';
  } else if (path === '/archive' || path === '/archive/') {
    const raw = url.searchParams.get('page');
    const page = raw && /^\d+$/.test(raw) ? Number(raw) : 1;
    // Leave invalid/out-of-range requests to the existing 404 handler.
    if (!Number.isSafeInteger(page) || page < 1 || page > 20) return null;
    canonicalPath = page === 1 ? '/archive' : `/archive?page=${page}`;
  } else {
    const match = path.match(/^\/watch\/(\d+)(\/thumbnail\.svg)?\/?$/);
    if (!match) return null;
    const id = Number(match[1]);
    if (!Number.isSafeInteger(id) || id < 1) return null;
    canonicalPath = `/watch/${id}${match[2] || ''}`;
  }
  const canonical = new URL(canonicalPath, 'https://infiniteaislop.ai').href;
  if (url.href === canonical) return null;
  return new Response(null, {
    status: 301,
    headers: { Location: canonical, 'Cache-Control': 'public, max-age=300' },
  });
}
