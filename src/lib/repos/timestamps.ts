/** Shared Firestore mapping helpers for the domain repositories. */

/** Convert a Firestore Timestamp (or Date) to a JS Date. */
export function toDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  if (typeof value === "object" && value !== null && "toDate" in value) {
    return (value as { toDate: () => Date }).toDate();
  }
  return undefined;
}
