import { resolve } from 'node:path'

export type RuntimeConfig = {
  host: string
  port: number
  databasePath: string
  staticDir: string
  mediaDir: string
  adminToken: string | null
  secureCookies: boolean
  trustProxy: boolean
  provider: 'mock' | 'fal' | 'orange'
  seedDemoQueue: boolean
  falKey: string | null
  falModel: string
  orangeApiBase: string
  orangeApiKey: string | null
  orangeModel: string
  orangeDurationSeconds: number
  orangeResolution: string
  orangeRatio: string
  orangeWatermark: boolean
  orangePollIntervalMs: number
  generationConcurrency: number
  generationMaximumAttempts: number
  bufferTarget: number
  workerIntervalMs: number
  rotationIntervalMs: number
  mockGenerationDelayMs: number
  providerTimeoutMs: number
  promptRateLimit: number
  voteRateLimit: number
  likeRateLimit: number
  rateLimitWindowMs: number
}

function booleanValue(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.toLocaleLowerCase('en'))
}

function integerValue(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  if (value === undefined) return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(maximum, Math.max(minimum, parsed))
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
  workingDirectory = process.cwd(),
): RuntimeConfig {
  const requestedProvider = environment.VIDEO_PROVIDER?.trim().toLocaleLowerCase('en')
  if (requestedProvider && !['mock', 'fal', 'orange'].includes(requestedProvider)) {
    throw new Error('VIDEO_PROVIDER must be mock, fal, or orange')
  }
  const provider = requestedProvider === 'orange'
    ? 'orange'
    : requestedProvider === 'fal' || (!requestedProvider && environment.FAL_KEY)
      ? 'fal'
      : 'mock'
  return {
    host: environment.HOST?.trim() || '127.0.0.1',
    port: integerValue(environment.PORT, 8787, 1, 65_535),
    databasePath: resolve(workingDirectory, environment.DATABASE_PATH || 'data/channel.sqlite'),
    staticDir: resolve(workingDirectory, environment.STATIC_DIR || 'dist'),
    mediaDir: resolve(workingDirectory, environment.MEDIA_DIR || 'data/videos'),
    adminToken: environment.ADMIN_TOKEN?.trim() || null,
    secureCookies: booleanValue(environment.SECURE_COOKIES, environment.NODE_ENV === 'production'),
    trustProxy: booleanValue(environment.TRUST_PROXY, false),
    provider,
    seedDemoQueue: provider === 'mock' && booleanValue(environment.SEED_DEMO_QUEUE, true),
    falKey: environment.FAL_KEY?.trim() || null,
    falModel: environment.FAL_MODEL?.trim() || 'minimax/h3-max/text-to-video',
    orangeApiBase: environment.ORANGE_API_BASE?.trim() || 'https://api.orangeapi.chat/v1',
    orangeApiKey: environment.ORANGE_API_KEY?.trim() || null,
    orangeModel: environment.ORANGE_MODEL?.trim() || 'happyhorse-1.0-t2v',
    orangeDurationSeconds: integerValue(environment.ORANGE_DURATION_SECONDS, 3, 1, 15),
    orangeResolution: environment.ORANGE_RESOLUTION?.trim() || '720P',
    orangeRatio: environment.ORANGE_RATIO?.trim() || '16:9',
    orangeWatermark: booleanValue(environment.ORANGE_WATERMARK, true),
    orangePollIntervalMs: integerValue(environment.ORANGE_POLL_INTERVAL_MS, 2_000, 250, 60_000),
    generationConcurrency: integerValue(environment.GENERATION_CONCURRENCY, 1, 1, 4),
    generationMaximumAttempts: integerValue(environment.GENERATION_MAX_ATTEMPTS, 3, 1, 10),
    bufferTarget: integerValue(environment.BUFFER_TARGET, 8, 1, 20),
    workerIntervalMs: integerValue(environment.WORKER_INTERVAL_MS, 750, 100, 60_000),
    rotationIntervalMs: integerValue(environment.ROTATION_INTERVAL_MS, 500, 100, 10_000),
    mockGenerationDelayMs: integerValue(environment.MOCK_GENERATION_DELAY_MS, 800, 0, 60_000),
    providerTimeoutMs: integerValue(environment.PROVIDER_TIMEOUT_MS, 900_000, 10_000, 3_600_000),
    promptRateLimit: integerValue(environment.PROMPT_RATE_LIMIT, 5, 1, 10_000),
    voteRateLimit: integerValue(environment.VOTE_RATE_LIMIT, 30, 1, 10_000),
    likeRateLimit: integerValue(environment.LIKE_RATE_LIMIT, 30, 1, 10_000),
    rateLimitWindowMs: integerValue(environment.RATE_LIMIT_WINDOW_MS, 60_000, 1_000, 3_600_000),
  }
}
