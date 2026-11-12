# Public URL routing

The live application is at `/`; it does not have client-side page routes.
Unknown static paths must return 404, not the live homepage. Keep Workers
Assets `not_found_handling` set to `none`. Keep the existing `run_worker_first`
paths for API, archive, about, watch pages, sitemap and feed.

`worker/seo-routing.js` normalizes GET/HEAD requests for known SEO routes with
one 301 response. Archive pagination is retained; zero-padded video IDs,
trailing slashes and ignored query parameters are normalized. Invalid IDs and
out-of-range pages stay with the existing 404 handler. API, media API, mutations,
and preview hosts are not redirected.

Run `npm run test:seo-routing` for the dependency-free routing regressions.
Changing the archive page limit requires updating the routing bound as well.

The 2026-11-12 production hotfix retained the exact previously deployed backend
module and asset files, adding only a routing entry module and changing the
asset fallback. Existing secrets, resource bindings, schedules and security
headers were preserved. The corresponding source changes here prevent the next
normal build from restoring the old routing behavior.
