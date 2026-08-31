# Infinite Slop

> **License — non-commercial only.** This repository is source-available under
> the [AI4Azure Non-Commercial Source-Available License](./LICENSE). Any
> commercial use requires prior written authorization from AI4Azure. It is not
> offered under an OSI-approved open-source license.

A full-stack recreation of the `infiniteslop.ai` experience: people submit prompts continuously, moderation decides what may enter the queue, a bounded worker generates vertical videos, and the server keeps an always-refilled live rotation. Chat, votes, likes, moderation decisions, generation progress, and playback history persist in SQLite.

The replica never calls the original site's write APIs.

## Run locally

Requires Node.js 24+ and pnpm.

```bash
pnpm install
pnpm dev
```

Open `http://127.0.0.1:5173`. The default `mock` provider produces short local MP4 loops, so the entire submit → generate → rotate flow works without credentials.

If port `8787` is already in use, keep the API and Vite proxy aligned:

```bash
PORT=8792 VITE_API_TARGET=http://127.0.0.1:8792 pnpm dev
```

## Real video generation

### OrangeAPI

On macOS, store the OrangeAPI key in Keychain. Keep `-w` last so `security` prompts instead of placing the value in shell history or process arguments:

```bash
/usr/bin/security add-generic-password \
  -a orangeapi-production \
  -s open-inifiniteslop.orangeapi \
  -l 'Open Infinite Slop OrangeAPI' \
  -U \
  -w
```

Then start the app without putting the key in the frontend or parent process environment:

```bash
VIDEO_PROVIDER=orange SEED_DEMO_QUEUE=false BUFFER_TARGET=1 pnpm dev
```

Keychain credentials are restricted to the canonical `https://api.orangeapi.chat/v1` gateway. A custom `ORANGE_API_BASE` requires its own explicit server-side `ORANGE_API_KEY`; put those variables on `pnpm dev:server` and run Vite separately. The explicit environment credential takes precedence. Real providers never seed the four mock demo jobs.

The local Orange default is `happyhorse-1.0-t2v`, configured for 3-second, 720P, 16:9 video. The production channel uses `seedance-2-0` at 10 seconds; the clearly labeled `channel bot` alternates 10- and 15-second original prompts every 10 minutes. The archive retains the most recent 100 stored videos for replay. The enabled text-to-video allowlist also includes `wan2.7-t2v`, `grok-imagine-video`, and the supported Seedance variants in [`server/orange-video-provider.ts`](./server/orange-video-provider.ts). Control requests use a browser User-Agent and never follow bearer-authenticated redirects.

Once Orange returns a task ID, it is persisted before polling continues. Restarts resume that same task instead of creating another paid job. An interrupted submission with no persisted task ID fails closed as `orange_submission_state_unknown`, because the upstream contract does not document an idempotency key.

### fal.ai

Set the fal.ai key only in the API server environment. Run the two development processes separately so Vite never inherits it:

```bash
VIDEO_PROVIDER=fal FAL_KEY=your-server-key pnpm dev:server
VITE_API_TARGET=http://127.0.0.1:8787 pnpm dev:client
```

The default fal.ai model is `minimax/h3-max/text-to-video`, configured for 5-second, 768P, 9:16 video with the provider safety checker enabled. Both real providers immediately download generated files into `data/videos` and serve them through a byte-range endpoint so playback remains stable after signed provider URLs expire.

See [`.env.example`](./.env.example) for worker concurrency, buffer size, timeouts, rate limits, storage paths, and model overrides.

## Moderation

Safe prompts are automatically queued. High-confidence prohibited content is rejected; ambiguous violence, sexual content, sensitive data, real-person likeness, and external references wait in `pending_review` and are invisible to the public feed.

Set a long random `ADMIN_TOKEN`, then list and resolve held prompts:

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" http://127.0.0.1:8787/api/moderation

curl -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"action":"approve","reason":"human_reviewed"}' \
  http://127.0.0.1:8787/api/moderation/IDEA_ID
```

Use `{"action":"reject","reason":"..."}` to reject an item. Admin endpoints are unavailable when `ADMIN_TOKEN` is unset.

## Production

```bash
pnpm build
NODE_ENV=production ADMIN_TOKEN=... pnpm start
```

The Node process serves the API, SSE stream, generated media, and the built SPA from one origin. It applies security headers, same-origin write checks, request size limits, per-session/IP rate limits, immutable hashed-asset caching, ETags, and video byte ranges.

## Verification

```bash
pnpm test   # database, API, SSE, moderation, concurrency, retry, rotation
pnpm build  # type-check and build client + server
pnpm smoke  # real production process, SPA/API, write, restart persistence
pnpm check  # all gates above, including credential leak scanning
```

The current suite includes fake Orange gateway contract tests and an end-to-end moderation → SSE → generation → local media → playback test. See [`docs/LIVE_VALIDATION.md`](./docs/LIVE_VALIDATION.md) for the one-call production-gateway validation evidence.

The deterministic mock videos can be regenerated on macOS with:

```bash
swiftc -parse-as-library scripts/generate-mock-videos.swift -o /tmp/generate-mock-videos
/tmp/generate-mock-videos public/assets
```
