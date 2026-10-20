import { getAdminAuth } from "@/lib/firebase/admin";

/**
 * Server-side multi-factor helpers.
 *
 * Our user document carries a cached `mfaEnabled` flag for display, but the
 * authoritative answer is Firebase: a factor is enrolled when the Firebase user
 * has `multiFactor.enrolledFactors`. Reading it here (at sign-in and after
 * enrollment changes) keeps our cache from drifting away from the truth.
 *
 * Note the split: we can *read* factors but not create them. TOTP enrollment is
 * client-side only — the Admin SDK only manages phone factors — which is why
 * the enrollment UI lives in the browser.
 */

/**
 * True when the Firebase user has at least one enrolled second factor.
 *
 * Fail-closed: if Firebase cannot tell us, we treat the account as protected,
 * so a privileged session is never granted on an assumption. That means a
 * Firebase outage blocks privileged sign-in rather than weakening it — retry,
 * or set `REQUIRE_MFA=false` as the documented break-glass if it ever becomes
 * a problem in an emergency.
 */
export async function hasEnrolledMfaFactor(firebaseUid: string): Promise<boolean> {
  try {
    const record = await getAdminAuth().getUser(firebaseUid);
    return (record.multiFactor?.enrolledFactors?.length ?? 0) > 0;
  } catch {
    return true;
  }
}

export interface EnrolledMfaFactor {
  id: string;
  displayName: string;
  enrolledOn: string;
}

/**
 * Second-factor counts for many accounts in one call — `getUsers` batches up to
 * 100 lookups, so a directory of staff costs one round trip rather than one per
 * person. Used to show who is actually protected rather than trusting our
 * cached flag.
 */
export async function countMfaFactorsByUid(
  firebaseUids: string[],
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const unique = [...new Set(firebaseUids.filter(Boolean))];

  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    try {
      const result = await getAdminAuth().getUsers(chunk.map((uid) => ({ uid })));
      for (const record of result.users) {
        counts[record.uid] = record.multiFactor?.enrolledFactors?.length ?? 0;
      }
    } catch {
      // A lookup failure is not worth failing the page over — those accounts
      // simply show as unenrolled, and the detail page is authoritative.
    }
  }
  return counts;
}

/**
 * What to do about a sign-in attempt, from the MFA policy's point of view.
 *
 *  - `not_required`  — ordinary user; MFA does not apply.
 *  - `satisfied`     — privileged and the second factor was proven.
 *  - `enroll`        — privileged with no factor yet; let them in *restricted*
 *                      so they can set one up. This is what stops a privileged
 *                      account from being permanently locked out: Firebase only
 *                      challenges when a factor exists, so a first-time user can
 *                      never produce `mfaSatisfied`.
 *  - `reject`        — privileged, has a factor, and did not use it.
 */
export type MfaDecision = "not_required" | "satisfied" | "enroll" | "reject";

export function decideMfa(input: {
  privileged: boolean;
  mfaSatisfied: boolean;
  hasFactor: boolean;
  passwordChangeRequired: boolean;
  requireMfa: boolean;
}): MfaDecision {
  // Onboarding sessions (temporary password) are exempt: a user cannot enroll a
  // factor before they have even chosen a password.
  if (!input.requireMfa || !input.privileged || input.passwordChangeRequired) {
    return "not_required";
  }
  if (input.mfaSatisfied) return "satisfied";
  return input.hasFactor ? "reject" : "enroll";
}

/**
 * The account's enrolled second factors, shaped for display. `id` is the
 * Firebase enrollment id, which is what removal requires.
 */
export async function listEnrolledMfaFactors(firebaseUid: string): Promise<EnrolledMfaFactor[]> {
  try {
    const record = await getAdminAuth().getUser(firebaseUid);
    return (record.multiFactor?.enrolledFactors ?? []).map((factor) => ({
      id: factor.uid,
      displayName: factor.displayName ?? "Authenticator app",
      enrolledOn: factor.enrollmentTime ?? "",
    }));
  } catch {
    return [];
  }
}
