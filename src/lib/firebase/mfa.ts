import {
  getMultiFactorResolver,
  multiFactor,
  TotpMultiFactorGenerator,
  type MultiFactorInfo,
  type MultiFactorResolver,
  type TotpSecret,
  type User,
} from "firebase/auth";

/**
 * Client-side multi-factor (TOTP) helpers.
 *
 * MFA is a Firebase Auth concern, so it happens in the browser with the client
 * SDK: the second factor is proven to Firebase, and the resulting ID token
 * carries `firebase.sign_in_second_factor`. The server session route only
 * checks that claim — it never verifies TOTP itself. This keeps the secret in
 * the user's authenticator app and never in our database.
 *
 * Browser-only: every function here requires a signed-in Firebase user or a
 * sign-in error thrown by the Firebase client SDK.
 */

/** Firebase error code raised when a password alone is not enough. */
export const MFA_REQUIRED_CODE = "auth/multi-factor-auth-required";

export const TOTP_FACTOR_ID = "totp";

/** Narrow an unknown catch value to Firebase's MFA-required error. */
export function isMfaRequiredError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === MFA_REQUIRED_CODE
  );
}

/**
 * Pull the second-factor resolver out of a sign-in failure, so the caller can
 * ask for the one-time code and finish signing in.
 */
export function toMultiFactorResolver(auth: unknown, error: unknown): MultiFactorResolver | null {
  if (!isMfaRequiredError(error)) return null;
  try {
    return getMultiFactorResolver(
      auth as Parameters<typeof getMultiFactorResolver>[0],
      error as Parameters<typeof getMultiFactorResolver>[1],
    );
  } catch {
    return null;
  }
}

/** The second factors the resolver will accept. */
export function factorHints(resolver: MultiFactorResolver): MultiFactorInfo[] {
  return resolver.hints ?? [];
}

/** The user's currently enrolled second factors. */
export function enrolledFactors(user: User): MultiFactorInfo[] {
  return multiFactor(user).enrolledFactors ?? [];
}

export interface TotpSetup {
  /** Passed back to `confirmTotpEnrollment`. Opaque — do not persist. */
  secret: TotpSecret;
  /** `otpauth://` URI for a QR code. */
  qrCodeUrl: string;
  /** The same secret as a manual entry key, for apps that cannot scan. */
  manualEntryKey: string;
}

/**
 * Start TOTP enrollment: mint a shared secret the user types/scans into their
 * authenticator app. Nothing is enrolled until they prove they have it.
 */
export async function beginTotpEnrollment(
  user: User,
  accountName: string,
  issuer = "Expedition Go Tours",
): Promise<TotpSetup> {
  const session = await multiFactor(user).getSession();
  const secret = await TotpMultiFactorGenerator.generateSecret(session);
  return {
    secret,
    qrCodeUrl: secret.generateQrCodeUrl(accountName, issuer),
    manualEntryKey: secret.secretKey,
  };
}

/** Finish TOTP enrollment with the code the user's app produced. */
export async function confirmTotpEnrollment(
  user: User,
  secret: TotpSecret,
  oneTimePassword: string,
  displayName = "Authenticator app",
): Promise<void> {
  const assertion = TotpMultiFactorGenerator.assertionForEnrollment(secret, oneTimePassword);
  await multiFactor(user).enroll(assertion, displayName);
}

/** Remove an enrolled factor (e.g. a lost authenticator). */
export async function removeEnrolledFactor(user: User, enrollmentId: string): Promise<void> {
  await multiFactor(user).unenroll(enrollmentId);
}

/** Build the assertion that completes a sign-in after the password step. */
export function totpSignInAssertion(enrollmentId: string, oneTimePassword: string) {
  return TotpMultiFactorGenerator.assertionForSignIn(enrollmentId, oneTimePassword);
}

/** Finish signing in with the second factor. Returns the signed-in user. */
export async function completeTotpSignIn(
  resolver: MultiFactorResolver,
  enrollmentId: string,
  oneTimePassword: string,
): Promise<User> {
  const credential = await resolver.resolveSignIn(
    totpSignInAssertion(enrollmentId, oneTimePassword),
  );
  return credential.user;
}
