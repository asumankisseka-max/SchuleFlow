import type { NextFunction, Request, Response } from 'express';

interface RateBucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, RateBucket>();

function extractClientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) {
    return fwd.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function pruneExpired(now: number): void {
  if (buckets.size < 500) return;
  for (const [key, entry] of buckets.entries()) {
    if (now >= entry.resetAt) {
      buckets.delete(key);
    }
  }
}

export function createRateLimiter(options: {
  name: string;
  windowMs: number;
  maxAttempts: number;
  keyBuilder?: (req: Request) => string;
  message: string;
}) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (process.env.DISABLE_RATE_LIMIT === 'true') {
      return next();
    }

    const now = Date.now();
    pruneExpired(now);

    const ip = extractClientIp(req);
    const suffix = options.keyBuilder ? options.keyBuilder(req) : '';
    const key = `${options.name}:${ip}:${suffix}`;

    const existing = buckets.get(key);
    if (!existing || now >= existing.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }

    if (existing.count >= options.maxAttempts) {
      const retryAfterSec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(429).json({
        error: `${options.message} Try again in ${Math.ceil(retryAfterSec / 60)} minute(s).`,
      });
    }

    existing.count += 1;
    return next();
  };
}

export function resetRateLimitBuckets(): void {
  buckets.clear();
}

export const loginRateLimiter = createRateLimiter({
  name: 'login',
  windowMs: 15 * 60 * 1000,
  maxAttempts: 12,
  keyBuilder: (req) => {
    const body = (req.body ?? {}) as { schoolCode?: unknown; identifier?: unknown };
    const code = typeof body.schoolCode === 'string' ? body.schoolCode.trim().toUpperCase() : '';
    const id = typeof body.identifier === 'string' ? body.identifier.trim().toLowerCase() : '';
    return `${code}:${id}`;
  },
  message: 'Too many sign-in attempts.',
});

export const lookupRateLimiter = createRateLimiter({
  name: 'school_lookup',
  windowMs: 5 * 60 * 1000,
  maxAttempts: 40,
  message: 'Too many school verification requests.',
});

export const recoveryRateLimiter = createRateLimiter({
  name: 'recovery',
  windowMs: 15 * 60 * 1000,
  maxAttempts: 8,
  message: 'Too many account recovery attempts.',
});
