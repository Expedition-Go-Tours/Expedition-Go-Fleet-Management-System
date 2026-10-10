import { createHash, timingSafeEqual } from "node:crypto";

import { serverEnv } from "@/lib/env";

/*
 * Scheduled-endpoint authentication.
 *
 * Vercel Cron invokes configured paths with HTTP GET and, when a secret is
 * set, sends `Authorization: Bearer <CRON_SECRET>`. The comparison must be
 * constant-time (a plain `!==` leaks the secret byte-by-byte through response
 * timing) and must fail closed: an absent header, a non-bearer scheme, an
 * empty presented token or an unconfigured secret are all rejections.
 *
 * Both sides are SHA-256 digested first so `timingSafeEqual` receives
 * equal-length buffers — that keeps the comparison independent of the secret's
 * length as well as its contents.
 */

const BEARER_PREFIX = "Bearer ";

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * True only when `authorization` is a well-formed bearer token that matches
 * `secret` in constant time.
 */
export function isValidCronBearer(authorization: string | null, secret: string): boolean {
  if (!authorization || !secret) return false;
  if (!authorization.startsWith(BEARER_PREFIX)) return false;

  const presented = authorization.slice(BEARER_PREFIX.length);
  if (presented.length === 0) return false;

  return timingSafeEqual(sha256(presented), sha256(secret));
}

/**
 * Resolve the configured cron secret, or null when it is absent/blank.
 * Reading `serverEnv.cronSecret` throws in that case; the caller must treat
 * null as "not configured" and refuse to run the sweep.
 */
export function readCronSecret(): string | null {
  try {
    const secret = serverEnv.cronSecret; // throws when CRON_SECRET is unset/blank
    return secret.trim() === "" ? null : secret;
  } catch {
    return null;
  }
}
