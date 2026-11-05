import { NextResponse, type NextRequest } from "next/server";

import {
  DEV_CSRF_COOKIE,
  DEV_SESSION_COOKIE,
  HOST_CSRF_COOKIE,
  HOST_SESSION_COOKIE,
  SESSION_COOKIE_MAX_AGE_SECONDS,
  csrfCookieOptions,
  sessionCookieOptions,
} from "@/lib/auth/session";

/*
 * Keeps an active user signed in.
 *
 * Sessions never expire server-side, but browsers cap persistent cookies at
 * 400 days. On every page navigation this re-issues the session and CSRF
 * cookies with a fresh 400-day window, so the cookie never lapses for someone
 * who keeps using the app. The cookie is only a carrier — every request still
 * validates the session (and its revocation) server-side.
 *
 * The matcher excludes `/api` so sign-in and logout, which set and clear
 * these cookies themselves, are never overwritten.
 */

/** `__Host-` cookies are always Secure; the local-dev names never are. */
const REFRESHABLE_COOKIES = [
  { name: HOST_SESSION_COOKIE, secure: true, csrf: false },
  { name: DEV_SESSION_COOKIE, secure: false, csrf: false },
  { name: HOST_CSRF_COOKIE, secure: true, csrf: true },
  { name: DEV_CSRF_COOKIE, secure: false, csrf: true },
] as const;

export function proxy(request: NextRequest) {
  const response = NextResponse.next();

  // Writes own their cookies in route handlers; only page GETs refresh.
  if (request.method !== "GET") return response;

  for (const { name, secure, csrf } of REFRESHABLE_COOKIES) {
    const value = request.cookies.get(name)?.value;
    if (!value) continue;
    response.cookies.set(
      name,
      value,
      csrf
        ? csrfCookieOptions(secure, SESSION_COOKIE_MAX_AGE_SECONDS)
        : sessionCookieOptions(SESSION_COOKIE_MAX_AGE_SECONDS, secure),
    );
  }

  return response;
}

export const config = {
  matcher: [
    // Page traffic only: APIs own their cookies, and Next.js internals and
    // static assets never need a refresh.
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|map|woff2?)$).*)",
  ],
};
