import { COLLECTIONS } from "@/lib/db/collections";
import { getAdminDb } from "@/lib/firebase/admin";
import {
  applyOnboardingUpdate,
  emptyOnboardingState,
  readOnboardingState,
  type OnboardingUpdate,
} from "@/lib/onboarding/state";
import { ONBOARDING_SCHEMA_VERSION, type OnboardingState } from "@/lib/onboarding/types";

/**
 * Per-employee onboarding state (guided tours + welcome experience).
 *
 * One document per authenticated user, keyed by user id — so state follows the
 * employee across devices, and the only write path is the user's own session.
 * Writes run in a transaction so two open tabs cannot lose each other's result.
 * Server-only (Firestore Admin SDK).
 */

function onboardingRef(userId: string) {
  return getAdminDb().collection(COLLECTIONS.onboarding).doc(userId);
}

export async function getOnboarding(userId: string): Promise<OnboardingState> {
  const snap = await onboardingRef(userId).get();
  if (!snap.exists) return emptyOnboardingState(userId);
  return readOnboardingState(userId, snap.data());
}

/**
 * Record a completed/dismissed tour for `userId`. The caller has already
 * validated the payload; this only ever touches `userId`'s own document.
 */
export async function saveOnboarding(
  userId: string,
  update: OnboardingUpdate,
): Promise<OnboardingState> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const db = getAdminDb();
  const ref = onboardingRef(userId);

  const next = await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const current = snap.exists
      ? readOnboardingState(userId, snap.data())
      : emptyOnboardingState(userId);
    const merged = applyOnboardingUpdate(current, update);
    transaction.set(
      ref,
      {
        userId,
        schemaVersion: ONBOARDING_SCHEMA_VERSION,
        tours: merged.tours,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return merged;
  });

  return next;
}
