import { NextResponse } from "next/server";

/**
 * API error type. Handlers throw these; the route wrapper turns them into
 * consistent JSON responses. 401 is returned for unauthenticated requests and
 * 403 for authenticated users lacking permission, per the spec.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }

  static badRequest(message = "Invalid request", code = "BAD_REQUEST") {
    return new ApiError(400, code, message);
  }
  static unauthorized(message = "Authentication required", code = "UNAUTHENTICATED") {
    return new ApiError(401, code, message);
  }
  static forbidden(message = "You do not have permission to do that", code = "FORBIDDEN") {
    return new ApiError(403, code, message);
  }
  static notFound(message = "Not found", code = "NOT_FOUND") {
    return new ApiError(404, code, message);
  }
  static conflict(message = "Conflict", code = "CONFLICT") {
    return new ApiError(409, code, message);
  }
  static tooManyRequests(message = "Too many requests", code = "RATE_LIMITED") {
    return new ApiError(429, code, message);
  }
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

/** Convert any thrown value into a safe JSON response. Never leaks internals. */
export function toErrorResponse(error: unknown): NextResponse<ApiErrorBody> {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }

  // Unexpected: log server-side, return a generic message to the client.
  console.error("[api] unhandled error:", error);
  return NextResponse.json(
    { error: { code: "INTERNAL", message: "Something went wrong" } },
    { status: 500 },
  );
}

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse<T> {
  return NextResponse.json(data, init);
}
