# OrangeAPI live validation

Validated on 2026-08-31 from the production build on macOS, against the canonical OrangeAPI production gateway.

## Paid-call boundary

- Started with a fresh SQLite database, `SEED_DEMO_QUEUE=false`, `BUFFER_TARGET=1`, concurrency `1`, and maximum attempts `1`.
- Confirmed revision `0` with zero queued, generating, ready, or playing items before submission.
- Submitted exactly one safe prompt to `happyhorse-1.0-t2v` at 3 seconds, 720P, 16:9.
- Final database evidence: one Orange idea, one generation attempt, one persisted provider task ID, and one downloaded media file.
- No second model, fallback generation, or repeated POST was used.

## Media evidence

- Stored file: MP4 Base Media v1, 3,246,391 bytes.
- SHA-256: `8bd040480c31764df415bd77510ff863143cc34b84db778acc5256a684b080af`.
- Browser decode: 1920×1080, 3.16 seconds, `readyState=4`, `error=null`, actively playing.
- Browser source: same-origin `/api/media/1`; the expiring signed provider URL was not exposed publicly.
- Full media response returned `video/mp4`, immutable caching, and `Accept-Ranges: bytes`.
- A `bytes=0-1023` request returned `206`, the exact `Content-Range`, and 1,024 bytes.

## Frontend and rotation evidence

- Desktop viewport: 1280×720; live SSE showed the submitted prompt in `NOW GENERATING` before playback.
- Mobile viewport: 390×844; the real video decoded and played while CHAT and QUEUE tabs remained operable.
- Reused the downloaded real video with two local mock clips to observe three carousel sources without another upstream call.
- All observed video elements reached `readyState=4` with no media error.
- Browser console: zero errors and zero warnings on desktop and mobile checks.

## Moderation and credential evidence

- A real-person-likeness prompt entered `pending_review`, appeared only in the authenticated moderation list, and remained absent from public state.
- Rejecting it stored the human reason with zero generation attempts and no provider task ID.
- The Orange key was loaded by the backend from macOS Keychain and was absent from Git-tracked files, build output, the live SQLite/media directory, public API/SSE payloads, and the server process command.
- Automated verification after integration: 32 tests, client/server type checks and builds, production smoke, and credential leak scan all passed.
