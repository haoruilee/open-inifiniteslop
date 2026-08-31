import { resolve } from 'node:path'

export type RuntimeConfig = {
  host: string
  port: number
  databasePath: string
  staticDir: string
  adminToken: string | null
  secureCookies: boolean
  trustProxy: boolean
  provider: 'mock' | 'fal'
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
  const provider = environment.VIDEO_PROVIDER === 'fal' || environment.FAL_KEY ? 'fal' : 'mock'
  return {
    host: environment.HOST?.trim() || '127.0.0.1',
    port: integerValue(environment.PORT, 8787, 1, 65_535),
    databasePath: resolve(workingDirectory, environment.DATABASE_PATH || 'data/channel.sqlite'),
    staticDir: resolve(workingDirectory, environment.STATIC_DIR || 'dist'),
    adminToken: environment.ADMIN_TOKEN?.trim() || null,
    secureCookies: booleanValue(environment.SECURE_COOKIES, environment.NODE_ENV === 'production'),
    trustProxy: booleanValue(environment.TRUST_PROXY, false),
    provider,
    promptRateLimit: integerValue(environment.PROMPT_RATE_LIMIT, 5, 1, 10_000),
    voteRateLimit: integerValue(environment.VOTE_RATE_LIMIT, 30, 1, 10_000),
    likeRateLimit: integerValue(environment.LIKE_RATE_LIMIT, 30, 1, 10_000),
    rateLimitWindowMs: integerValue(environment.RATE_LIMIT_WINDOW_MS, 60_000, 1_000, 3_600_000),
  }
}
