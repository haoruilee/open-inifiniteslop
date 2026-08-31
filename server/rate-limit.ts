export type RateLimitResult = {
  allowed: boolean
  retryAfterSeconds: number
}

type Bucket = {
  count: number
  expiresAt: number
}

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, Bucket>()

  constructor(
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  take(key: string, limit: number): RateLimitResult {
    const now = this.now()
    let bucket = this.buckets.get(key)
    if (!bucket || bucket.expiresAt <= now) {
      bucket = { count: 0, expiresAt: now + this.windowMs }
      this.buckets.set(key, bucket)
    }

    if (bucket.count >= limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.expiresAt - now) / 1_000)),
      }
    }

    bucket.count += 1
    if (this.buckets.size > 10_000) this.prune(now)
    return { allowed: true, retryAfterSeconds: 0 }
  }

  private prune(now: number) {
    for (const [key, bucket] of this.buckets) {
      if (bucket.expiresAt <= now) this.buckets.delete(key)
    }
  }
}
