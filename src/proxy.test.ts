import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import {
  DEV_SESSION_COOKIE,
  HOST_CSRF_COOKIE,
  HOST_SESSION_COOKIE,
  SESSION_COOKIE_MAX_AGE_SECONDS,
} from "@/lib/auth/session";
import { proxy } from "@/proxy";

function request(path: string, cookieHeader?: string, method = "GET"): NextRequest {
  const headers = new Headers();
  if (cookieHeader) headers.set("cookie", cookieHeader);
  return new NextRequest(`http://localhost:3000${path}`, { method, headers });
}

function setCookieOf(response: Response): string {
  return response.headers.getSetCookie().join("\n");
}

describe("proxy cookie refresh", () => {
  it("re-issues the session cookie with a fresh 400-day window", () => {
    const cookies = setCookieOf(proxy(request("/fuel", `${HOST_SESSION_COOKIE}=token123`)));

    expect(cookies).toContain(`${HOST_SESSION_COOKIE}=token123`);
    expect(cookies).toContain(`Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}`);
    expect(cookies).toContain("HttpOnly");
    expect(cookies).toContain("Path=/");
  });

  it("keeps the CSRF cookie in step, still readable by JavaScript", () => {
    const cookies = setCookieOf(proxy(request("/fuel", `${HOST_CSRF_COOKIE}=csrf123`)));

    expect(cookies).toContain(`${HOST_CSRF_COOKIE}=csrf123`);
    expect(cookies).toContain(`Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}`);
    expect(cookies).not.toContain("HttpOnly");
  });

  it("refreshes the local-dev cookie names too", () => {
    const cookies = setCookieOf(proxy(request("/fuel", `${DEV_SESSION_COOKIE}=devtoken`)));

    expect(cookies).toContain(`${DEV_SESSION_COOKIE}=devtoken`);
  });

  it("adds nothing when no cookies are present", () => {
    expect(proxy(request("/fuel")).headers.getSetCookie()).toHaveLength(0);
  });

  it("leaves non-GET requests alone so writes own their cookies", () => {
    const cookies = proxy(request("/fuel", `${HOST_SESSION_COOKIE}=token123`, "POST"));

    expect(cookies.headers.getSetCookie()).toHaveLength(0);
  });
});
