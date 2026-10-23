import { describe, expect, it } from "vitest";

import { auditSnapshot, DeletionError, parseDeletionReason } from "@/lib/domain/deletion";

describe("parseDeletionReason", () => {
  it("trims and accepts a short written reason", () => {
    expect(parseDeletionReason("  Duplicate entry  ")).toBe("Duplicate entry");
  });

  it("rejects missing, blank, too-short or overlong reasons", () => {
    for (const value of [undefined, null, 42, "", "   ", "x", "x".repeat(501)]) {
      expect(() => parseDeletionReason(value)).toThrow(DeletionError);
    }
  });

  it("uses a 400-mapped code for bad input", () => {
    try {
      parseDeletionReason("");
    } catch (error) {
      expect(error).toBeInstanceOf(DeletionError);
      expect((error as DeletionError).status).toBe(400);
      expect((error as DeletionError).code).toBe("INVALID_INPUT_REASON");
    }
  });
});

describe("auditSnapshot", () => {
  it("drops undefined fields and serialises dates for storage", () => {
    const snapshot = auditSnapshot({
      id: "exp_1",
      amountMinor: 40000,
      paidTo: undefined,
      incurredOn: new Date("2026-10-20T00:00:00.000Z"),
    }) as Record<string, unknown>;

    expect(snapshot).toEqual({
      id: "exp_1",
      amountMinor: 40000,
      incurredOn: "2026-10-20T00:00:00.000Z",
    });
    expect("paidTo" in snapshot).toBe(false);
  });
});
