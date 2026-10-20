import { createHash, randomUUID } from "node:crypto";

import { serverEnv } from "@/lib/env";

/**
 * Cloudinary document storage.
 *
 * Deliberately uses plain signed REST calls rather than the Cloudinary SDK:
 * the whole integration is two HTTP requests, and a dependency would be more
 * code to audit than the calls themselves.
 *
 * Files are uploaded with `type=authenticated`, so they are **not** public —
 * only signed delivery URLs work. Cloudinary returns such a signed URL in the
 * upload response, and that is what we store: the signature maths lives in
 * Cloudinary's own response rather than in code we cannot verify against a live
 * account. The cost is that rotating your Cloudinary API secret invalidates
 * stored URLs, and they must be regenerated (see docs/FLEET_WORKFLOWS.md §8).
 */

const CLOUDINARY_UPLOAD_API = "https://api.cloudinary.com/v1_1";

/** Uploads we accept: documents are scans/photos/PDFs, not arbitrary binaries. */
export const ALLOWED_UPLOAD_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

/** Hard ceiling on an uploaded document — 15 MB covers phone scans comfortably. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export function isCloudinaryConfigured(): boolean {
  return Boolean(
    serverEnv.cloudinaryCloudName && serverEnv.cloudinaryApiKey && serverEnv.cloudinaryApiSecret,
  );
}

/**
 * Cloudinary's request signature: every parameter except `file`, `api_key`,
 * `resource_type` and `signature` itself, sorted by key, joined `k=v&k=v`, with
 * the API secret appended, then SHA-1 hex.
 */
export function signUploadParams(params: Record<string, string>, apiSecret: string): string {
  const toSign = Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== "")
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  return createHash("sha1").update(`${toSign}${apiSecret}`).digest("hex");
}

export interface StoredDocument {
  /** Cloudinary public id — the private storage key kept on the record. */
  publicId: string;
  /** Signed, non-public delivery URL returned by Cloudinary at upload time. */
  secureUrl: string;
  /** Upload version, useful if the URL ever needs regenerating. */
  version: number | null;
  bytes: number;
  format: string;
}

/**
 * Detect a file's real type from its magic bytes. The browser-supplied
 * `Content-Type` is untrusted input — this is what actually gates what we store,
 * so a `.exe` renamed to `report.pdf` is rejected rather than saved.
 *
 * Returns null when the bytes match none of the accepted formats.
 */
export function sniffContentType(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  const ascii = (start: number, end: number) => buffer.subarray(start, end).toString("latin1");

  // PDF — "%PDF-"
  if (ascii(0, 5) === "%PDF-") return "application/pdf";
  // JPEG — FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  // PNG — 89 50 4E 47 0D 0A 1A 0A
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (pngSignature.every((byte, i) => buffer[i] === byte)) return "image/png";
  // WebP — "RIFF" .... "WEBP"
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  // HEIC/HEIF family — .... "ftyp" <brand>
  if (ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) return "image/heic";
  }
  return null;
}

/**
 * Upload a document to Cloudinary. Throws when not configured or when Cloudinary
 * rejects the file — the caller turns that into a clear user-facing error.
 */
export async function uploadDocument(input: {
  buffer: Buffer;
  filename: string;
  contentType: string;
}): Promise<StoredDocument> {
  if (!isCloudinaryConfigured()) {
    throw new Error(
      "Document storage is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.",
    );
  }

  const cloudName = serverEnv.cloudinaryCloudName as string;
  const apiKey = serverEnv.cloudinaryApiKey as string;
  const apiSecret = serverEnv.cloudinaryApiSecret as string;

  // PDFs and other files are `raw`; images stay `image` so they can be previewed.
  const resourceType = input.contentType.startsWith("image/") ? "image" : "raw";
  // Full path in `public_id` (no separate `folder`) keeps the signed params minimal
  // and the resulting key deterministic.
  const publicId = `${serverEnv.cloudinaryFolder}/${randomUUID()}`;
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const signed = signUploadParams(
    { public_id: publicId, timestamp, type: "authenticated" },
    apiSecret,
  );

  const form = new FormData();
  form.set("public_id", publicId);
  form.set("timestamp", timestamp);
  form.set("type", "authenticated");
  form.set("api_key", apiKey);
  form.set("signature", signed);
  form.set(
    "file",
    new Blob([new Uint8Array(input.buffer)], { type: input.contentType }),
    input.filename,
  );

  const response = await fetch(`${CLOUDINARY_UPLOAD_API}/${cloudName}/${resourceType}/upload`, {
    method: "POST",
    body: form,
  });
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;

  if (!response.ok) {
    const uploadError = data?.error as { message?: unknown } | undefined;
    const message =
      typeof uploadError?.message === "string"
        ? uploadError.message
        : `Upload failed (${response.status})`;
    throw new Error(`Cloudinary upload rejected: ${message}`);
  }

  const publicIdResult = typeof data?.public_id === "string" ? data.public_id : publicId;
  const secureUrl = typeof data?.secure_url === "string" ? data.secure_url : "";
  if (!secureUrl) {
    throw new Error("Cloudinary did not return a delivery URL for the uploaded document.");
  }

  return {
    publicId: publicIdResult,
    secureUrl,
    version: typeof data?.version === "number" ? data.version : null,
    bytes: typeof data?.bytes === "number" ? data.bytes : input.buffer.length,
    format: typeof data?.format === "string" ? data.format : "",
  };
}

/**
 * Ask Cloudinary for a fresh signed delivery URL for an already-stored file.
 *
 * Used to self-heal: the URL we keep on the record is the one Cloudinary signed
 * at upload time, and rotating the API secret invalidates those. Rather than
 * leaving documents permanently unopenable, we can re-resolve the URL from the
 * stored `fileKey`. Falls back to null — the caller then reports a clear error
 * rather than redirecting to a dead link.
 */
export async function resolveDeliveryUrl(publicId: string): Promise<string | null> {
  if (!isCloudinaryConfigured() || !publicId) return null;

  const cloudName = serverEnv.cloudinaryCloudName as string;
  const apiKey = serverEnv.cloudinaryApiKey as string;
  const apiSecret = serverEnv.cloudinaryApiSecret as string;
  const authorization = `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`;
  // Documents are stored as `raw` unless they are images; try both rather than
  // remembering which kind each one was.
  for (const resourceType of ["raw", "image"]) {
    try {
      const url = `${CLOUDINARY_UPLOAD_API}/${cloudName}/resources/${resourceType}/authenticated/${publicId}`;
      const response = await fetch(url, { headers: { authorization } });
      if (!response.ok) continue;
      const data = (await response.json().catch(() => null)) as { secure_url?: unknown } | null;
      if (typeof data?.secure_url === "string" && data.secure_url) return data.secure_url;
    } catch {
      // Try the next resource type.
    }
  }
  return null;
}

/**
 * Best-effort deletion of a stored document. Failures are swallowed — an orphan
 * in Cloudinary is preferable to a failed user action after the record is gone.
 */
export async function deleteDocument(publicId: string): Promise<void> {
  if (!isCloudinaryConfigured() || !publicId) return;

  const cloudName = serverEnv.cloudinaryCloudName as string;
  const apiKey = serverEnv.cloudinaryApiKey as string;
  const apiSecret = serverEnv.cloudinaryApiSecret as string;

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signed = signUploadParams({ public_id: publicId, timestamp }, apiSecret);

  const form = new FormData();
  form.set("public_id", publicId);
  form.set("timestamp", timestamp);
  form.set("api_key", apiKey);
  form.set("signature", signed);

  try {
    await fetch(`${CLOUDINARY_UPLOAD_API}/${cloudName}/image/destroy`, {
      method: "POST",
      body: form,
    });
  } catch {
    // Intentionally ignored — see the doc comment.
  }
}
