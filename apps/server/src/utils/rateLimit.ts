export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export class FixedWindowRateLimiter {
  private readonly entries = new Map<string, RateLimitEntry>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxEntries: number,
  ) {
    if (limit < 1 || windowMs < 1 || maxEntries < 1) {
      throw new Error('Rate-limit settings must be positive');
    }
  }

  consume(key: string, now = Date.now()): RateLimitDecision {
    let entry = this.entries.get(key);
    if (entry && entry.resetAt <= now) {
      this.entries.delete(key);
      entry = undefined;
    }

    if (!entry) {
      if (this.entries.size >= this.maxEntries) this.pruneExpired(now);
      if (this.entries.size >= this.maxEntries) {
        return { allowed: false, retryAfterSeconds: Math.ceil(this.windowMs / 1000) };
      }
      entry = { count: 0, resetAt: now + this.windowMs };
      this.entries.set(key, entry);
    }

    const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    if (entry.count >= this.limit) return { allowed: false, retryAfterSeconds };
    entry.count += 1;
    return { allowed: true, retryAfterSeconds };
  }

  private pruneExpired(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now) this.entries.delete(key);
    }
  }
}

export class FixedWindowQuota {
  private count = 0;
  private resetAt = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {
    if (limit < 1 || windowMs < 1) throw new Error('Quota settings must be positive');
  }

  consume(now = Date.now()): RateLimitDecision {
    if (this.resetAt <= now) {
      this.count = 0;
      this.resetAt = now + this.windowMs;
    }
    const retryAfterSeconds = Math.max(1, Math.ceil((this.resetAt - now) / 1000));
    if (this.count >= this.limit) return { allowed: false, retryAfterSeconds };
    this.count += 1;
    return { allowed: true, retryAfterSeconds };
  }
}
