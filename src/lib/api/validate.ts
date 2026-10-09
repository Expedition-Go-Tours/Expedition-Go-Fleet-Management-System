import { ApiError } from "@/lib/api/errors";

/**
 * Shared request-body parsing/validation helpers.
 * Every function throws ApiError 400 with a human-readable message on failure.
 */

export function requireString(
  value: unknown,
  field: string,
  options?: { max?: number; min?: number },
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw ApiError.badRequest(`${field} is required`);
  }
  const cleaned = value.trim();
  const min = options?.min ?? 1;
  const max = options?.max ?? 1000;
  if (cleaned.length < min) throw ApiError.badRequest(`${field} is too short`);
  if (cleaned.length > max) throw ApiError.badRequest(`${field} is too long (max ${max} chars)`);
  return cleaned;
}

export function optionalString(
  value: unknown,
  field: string,
  options?: { max?: number },
): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requireString(value, field, options);
}

export function requireInteger(
  value: unknown,
  field: string,
  options?: { min?: number; max?: number },
): number {
  const num = Number(value);
  if (!Number.isSafeInteger(num)) throw ApiError.badRequest(`${field} must be an integer`);
  if (options?.min !== undefined && num < options.min) {
    throw ApiError.badRequest(`${field} must be at least ${options.min}`);
  }
  if (options?.max !== undefined && num > options.max) {
    throw ApiError.badRequest(`${field} must be at most ${options.max}`);
  }
  return num;
}

export function requireOneOf<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw ApiError.badRequest(`${field} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

/** Provider (garage/vendor) body parsing shared by create + update. */
export interface ProviderBody {
  name: string;
  contactName?: string;
  phone: string;
  email?: string;
  address?: string;
  specialties: string[];
}

export function parseProviderBody(body: Record<string, unknown>): ProviderBody {
  const name = requireString(body.name, "name", { max: 200 });
  const phone = requireString(body.phone, "phone", { max: 50 });

  const contactName = optionalString(body.contactName, "contactName", { max: 200 });
  const email = optionalString(body.email, "email", { max: 254 })?.toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw ApiError.badRequest("Invalid email address");
  }
  const address = optionalString(body.address, "address", { max: 500 });

  const specialties = Array.isArray(body.specialties)
    ? body.specialties
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        .map((s) => s.trim().slice(0, 50))
        .slice(0, 20)
    : [];

  return { name, contactName, phone, email, address, specialties };
}
