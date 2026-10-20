import { describe, expect, it, afterEach, vi } from "vitest";

import {
  ALLOWED_UPLOAD_TYPES,
  isCloudinaryConfigured,
  MAX_UPLOAD_BYTES,
  signUploadParams,
  sniffContentType,
} from "@/lib/cloudinary";

/**
 * The upload signature is the one piece of the Cloudinary integration that must
 * be byte-exact — a wrong digest is silently rejected by Cloudinary and shows up
 * as a broken upload. These are regression vectors computed independently.
 */
describe("signUploadParams", () => {
  it("matches the known digest for a simple upload", () => {
    expect(
      signUploadParams({ public_id: "abc", timestamp: "123", type: "authenticated" }, "secret"),
    ).toBe("441a925aa36018a30e642c8a747fbbedb454b91a");
  });

  it("matches the known digest for a realistic document path", () => {
    expect(
      signUploadParams(
        {
          public_id: "expedition-go/documents/x",
          timestamp: "1700000000",
          type: "authenticated",
        },
        "S3cret!",
      ),
    ).toBe("fbe78fd77523f5c47482e3aeb1f6a4bc4adf3bac");
  });

  it("excludes empty values from the signed string", () => {
    expect(signUploadParams({ timestamp: "1700000000", extra: "" }, "secret")).toBe(
      "84af3c6077e429a8e7ff26d2ca13d5feb6bc7cb0",
    );
  });

  it("is independent of the order parameters are supplied in", () => {
    const a = signUploadParams(
      { type: "authenticated", public_id: "abc", timestamp: "123" },
      "secret",
    );
    const b = signUploadParams(
      { timestamp: "123", type: "authenticated", public_id: "abc" },
      "secret",
    );
    expect(a).toBe(b);
  });

  it("changes when the secret or any parameter changes", () => {
    const base = signUploadParams({ public_id: "abc", timestamp: "123" }, "secret");
    expect(signUploadParams({ public_id: "abc", timestamp: "123" }, "other")).not.toBe(base);
    expect(signUploadParams({ public_id: "abc", timestamp: "124" }, "secret")).not.toBe(base);
  });

  it("always produces a 40-character hex digest", () => {
    const digest = signUploadParams({ public_id: "x" }, "s");
    expect(digest).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("upload constraints", () => {
  it("accepts document and photo formats only", () => {
    expect(Object.keys(ALLOWED_UPLOAD_TYPES)).toEqual([
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
    ]);
    expect(ALLOWED_UPLOAD_TYPES["application/zip"]).toBeUndefined();
    expect(ALLOWED_UPLOAD_TYPES["text/html"]).toBeUndefined();
    expect(ALLOWED_UPLOAD_TYPES["application/x-msdownload"]).toBeUndefined();
  });

  it("caps uploads at a sane size", () => {
    expect(MAX_UPLOAD_BYTES).toBe(15 * 1024 * 1024);
  });
});

describe("sniffContentType", () => {
  /** A buffer whose first bytes look like the given format. */
  function bytes(prefix: number[], length = 32): Buffer {
    const buf = Buffer.alloc(length, 0x20);
    prefix.forEach((byte, i) => {
      buf[i] = byte;
    });
    return buf;
  }
  const ascii = (text: string) => Array.from(Buffer.from(text, "latin1"));

  it("recognises the formats we accept", () => {
    expect(sniffContentType(bytes([...ascii("%PDF-1.7")]))).toBe("application/pdf");
    expect(sniffContentType(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffContentType(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      "image/png",
    );
    expect(sniffContentType(bytes([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")]))).toBe(
      "image/webp",
    );
    expect(sniffContentType(bytes([0, 0, 0, 0, ...ascii("ftyp"), ...ascii("heic")]))).toBe(
      "image/heic",
    );
  });

  it("rejects disguised executables and archives", () => {
    // MZ = Windows executable, PK = zip/jar
    expect(sniffContentType(bytes([...ascii("MZ\x90\x00")]))).toBeNull();
    expect(sniffContentType(bytes([...ascii("PK\x03\x04")]))).toBeNull();
    // A script with a .pdf name
    expect(sniffContentType(bytes([...ascii("#!/bin/sh")]))).toBeNull();
  });

  it("rejects files that are too short to identify", () => {
    expect(sniffContentType(Buffer.alloc(0))).toBeNull();
    expect(sniffContentType(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(sniffContentType(Buffer.from("%PDF"))).toBeNull();
  });

  it("rejects arbitrary content rather than guessing", () => {
    expect(
      sniffContentType(bytes([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08])),
    ).toBeNull();
    expect(sniffContentType(bytes(ascii("hello world, this is text")))).toBeNull();
  });
});

describe("isCloudinaryConfigured", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is true only when all three credentials are present", () => {
    vi.stubEnv("CLOUDINARY_CLOUD_NAME", "demo");
    vi.stubEnv("CLOUDINARY_API_KEY", "key");
    vi.stubEnv("CLOUDINARY_API_SECRET", "secret");
    expect(isCloudinaryConfigured()).toBe(true);
  });

  it("degrades to false when any one credential is missing", () => {
    vi.stubEnv("CLOUDINARY_CLOUD_NAME", "demo");
    vi.stubEnv("CLOUDINARY_API_KEY", "key");
    vi.stubEnv("CLOUDINARY_API_SECRET", "");
    expect(isCloudinaryConfigured()).toBe(false);

    vi.stubEnv("CLOUDINARY_CLOUD_NAME", "demo");
    vi.stubEnv("CLOUDINARY_API_KEY", "");
    vi.stubEnv("CLOUDINARY_API_SECRET", "secret");
    expect(isCloudinaryConfigured()).toBe(false);

    vi.stubEnv("CLOUDINARY_CLOUD_NAME", "");
    vi.stubEnv("CLOUDINARY_API_KEY", "key");
    vi.stubEnv("CLOUDINARY_API_SECRET", "secret");
    expect(isCloudinaryConfigured()).toBe(false);
  });

  it("is false when nothing is configured at all", () => {
    vi.stubEnv("CLOUDINARY_CLOUD_NAME", "");
    vi.stubEnv("CLOUDINARY_API_KEY", "");
    vi.stubEnv("CLOUDINARY_API_SECRET", "");
    expect(isCloudinaryConfigured()).toBe(false);
  });
});
