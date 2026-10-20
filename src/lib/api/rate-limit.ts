import { ApiError } from "@/lib/api/errors";

/**
 * In-memory sliding-window rate limiter.
 *
 * Protects the endpoints an attacker would hammer: sign-in, password change,
 * invites, and uploads. Deliberately dependency-free and in-process.
 *
 * **Scope:** this is per server instance. On serverless (Vercel) each instance
 * keeps its own counters, so the effective allowance is `limit × instances`.
 * That is still enough to blunt credential stuffing and brute force, which is
 * the point — it is defence in depth behind Firebase's own throttling, not a
 * replacement for a distributed limiter. If you outgrow it, swap the store for
 * Redis; the call sites do not change.
 */

interface Bucket {
  /** Hits recorded in the current window. */
  count: number;
  /** When the current window ends (epoch ms). */
  resetAt: number;
  /** Rough memory bound — entries are pruned when the map grows too large. */
  seenAt: number;
}

const buckets = new Map<string, Bucket>();

/** Safety valve so a burst of distinct keys cannot grow memory without bound. */
const MAX_BUCKETS = 10_000;

export interface RateLimitRule {
  /** Allowed requests per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

/**
 * Record a hit and throw `429 RATE_LIMITED` when the caller is over budget.
 *
 * @param key  Stable identity for the caller+action, e.g. `signin:1.2.3.4`.
 * @param rule How many attempts are allowed, and over what period.
 */
export function enforceRateLimit(key: string, rule: RateLimitRule): void {
  const now = Date.now();
  let bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size > MAX_BUCKETS) prune(now);
    bucket = { count: 0, resetAt: now + rule.windowMs, seenAt: now };
    buckets.set(key, bucket);
  }

  bucket.count += 1;
  bucket.seenAt = now;

  if (bucket.count > rule.limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    throw ApiError.tooManyRequests(
      `Too many attempts. Try again in ${retryAfterSeconds} second${retryAfterSeconds === 1 ? "" : "s"}.`,
      "RATE_LIMITED",
    );
  }
}

/** Drop expired entries; if still large, drop the least recently used. */
function prune(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  if (buckets.size > MAX_BUCKETS) {
    const oldest = [...buckets.entries()].sort((a, b) => a[1].seenAt - b[1].seenAt);
    for (const [key] of oldest.slice(0, oldest.length - MAX_BUCKETS / 2)) {
      buckets.delete(key);
    }
  }
}

/**
 * Forget a caller's usage — call this when an action **succeeds**.
 *
 * Counting successes as well as failures punishes the wrong people: a small
 * office behind one NAT (or a driver using the company Wi-Fi) would trip the
 * limit just by everyone signing in on a Monday morning. Clearing on success
 * means the budget only fills up with *repeated failures*, which is exactly the
 * pattern we want to stop.
 */
export function clearRateLimit(key: string): void {
  buckets.delete(key);
}

/**
 * Best-effort caller identity from the request. Uses the forwarding header a
 * proxy sets (Vercel does); falls back to a shared bucket rather than trusting
 * a client-supplied header that is trivially spoofed.
 */
export function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first && first.length > 0 ? first : "unknown";
}

/**
 * Named buckets so two actions by one caller do not share a budget.
 *
 * These budgets count *attempts that have not yet succeeded* — call
 * `clearRateLimit` when an action completes, so legitimate users sharing an
 * address never lock each other out.
 */
export const RATE_LIMITS = {
  /** Sign-in failures — the credential-stuffing target. */
  signIn: { limit: 15, windowMs: 5 * 60_000 },
  /** Password change, which also verifies the current password. */
  passwordChange: { limit: 5, windowMs: 15 * 60_000 },
  /** Inviting a user — each attempt mails credentials. */
  invite: { limit: 10, windowMs: 15 * 60_000 },
  /** Uploads — bounded abuse of storage and of the storage provider. */
  upload: { limit: 30, windowMs: 15 * 60_000 },
} as const satisfies Record<string, RateLimitRule>;
