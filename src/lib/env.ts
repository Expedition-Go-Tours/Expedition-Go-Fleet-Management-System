/**
 * Environment access with fail-fast required values.
 *
 * Values are read lazily through getters so that importing this module never
 * throws during a build or in an environment where a given subsystem is unused.
 * `NEXT_PUBLIC_*` values are inlined by Next.js at build time and are safe to
 * reference from the browser; everything under `serverEnv` is server-only.
 */

function required(name: string, value: string | undefined): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const publicEnv = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  firebase: {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
  },
} as const;

export const serverEnv = {
  get appUrl(): string {
    return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  },
  /** Peppers session-token hashes so a leaked database cannot be used to forge sessions. */
  get sessionSecret(): string {
    return required("SESSION_SECRET", process.env.SESSION_SECRET);
  },
  /** Bearer token Vercel Cron sends to /api/v1/cron/*. */
  get cronSecret(): string {
    return required("CRON_SECRET", process.env.CRON_SECRET);
  },
  /**
   * Whether privileged roles (ADMIN/MANAGER/FINANCE) must complete MFA at
   * session establishment. Defaults to true; set REQUIRE_MFA=false ONLY in
   * development before TOTP is enabled in the Firebase console.
   */
  get requireMfa(): boolean {
    return process.env.REQUIRE_MFA !== "false";
  },
  get firebaseAdmin(): {
    projectId: string;
    clientEmail: string;
    privateKey: string;
  } {
    return {
      projectId: required("FIREBASE_ADMIN_PROJECT_ID", process.env.FIREBASE_ADMIN_PROJECT_ID),
      clientEmail: required("FIREBASE_ADMIN_CLIENT_EMAIL", process.env.FIREBASE_ADMIN_CLIENT_EMAIL),
      privateKey: required("FIREBASE_ADMIN_PRIVATE_KEY", process.env.FIREBASE_ADMIN_PRIVATE_KEY)
        // Service-account keys are commonly stored with escaped newlines.
        .replace(/\\n/g, "\n"),
    };
  },
  get mapboxAccessToken(): string | undefined {
    return process.env.MAPBOX_ACCESS_TOKEN;
  },
  get geoapifyApiKey(): string | undefined {
    return process.env.GEOAPIFY_API_KEY;
  },
} as const;

/** True when the app is served over HTTPS (drives the Secure cookie flag). */
export function isSecureContext(): boolean {
  return serverEnv.appUrl.startsWith("https://");
}
