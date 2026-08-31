# Infinite Slop

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

Set the fal.ai key only in the server environment. It is never sent to the browser or included in the Vite bundle.

```bash
VIDEO_PROVIDER=fal FAL_KEY=your-server-key pnpm dev
```

The default model is `minimax/h3-max/text-to-video`, configured for 5-second, 768P, 9:16 video with the provider safety checker enabled. Generated files are downloaded into `data/videos` and served through a byte-range endpoint so playback remains stable if a provider URL expires.

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
pnpm check  # all gates above
```

The deterministic mock videos can be regenerated on macOS with:

```bash
swiftc -parse-as-library scripts/generate-mock-videos.swift -o /tmp/generate-mock-videos
/tmp/generate-mock-videos public/assets
```
