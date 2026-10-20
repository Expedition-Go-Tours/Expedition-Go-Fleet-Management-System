/**
 * Client-side fetch helpers for /api/v1.
 *
 * Reads the (JS-readable) CSRF cookie and attaches it to state-changing
 * requests. A 401 anywhere means the session is gone — bounce to /sign-in.
 */

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
  }
}

function readCsrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)(?:__Host-)?egt_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]!) : null;
}

export async function apiRequest<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(method === "GET" || method === "DELETE" ? {} : { "x-csrf-token": readCsrfToken() ?? "" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401) {
    // Full navigation so server-rendered caches for the old session are dropped.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/sign-in");
    throw new ApiClientError(401, "UNAUTHENTICATED", "Your session has expired");
  }

  const data = (await res.json().catch(() => null)) as
    (T & { error?: { code?: string; message?: string } }) | null;

  if (!res.ok) {
    throw new ApiClientError(
      res.status,
      data?.error?.code ?? "UNKNOWN",
      data?.error?.message ?? `Request failed (${res.status})`,
    );
  }

  return data as T;
}

export const api = {
  get: <T>(path: string) => apiRequest<T>("GET", path),
  post: <T>(path: string, body?: unknown) => apiRequest<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>("PATCH", path, body),
  /**
   * Multipart upload. Sends the browser's FormData untouched (so the file and
   * its parts are encoded correctly) while still carrying the CSRF header and
   * the same 401/403 handling as JSON calls.
   */
  upload: <T>(path: string, form: FormData) => apiUpload<T>(path, form),
};

export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "x-csrf-token": readCsrfToken() ?? "" },
    body: form,
  });

  if (res.status === 401) {
    // Full navigation so server-rendered caches for the old session are dropped.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/sign-in");
    throw new ApiClientError(401, "UNAUTHENTICATED", "Your session has expired");
  }

  const data = (await res.json().catch(() => null)) as
    (T & { error?: { code?: string; message?: string } }) | null;

  if (!res.ok) {
    throw new ApiClientError(
      res.status,
      data?.error?.code ?? "UNKNOWN",
      data?.error?.message ?? `Upload failed (${res.status})`,
    );
  }

  return data as T;
}
