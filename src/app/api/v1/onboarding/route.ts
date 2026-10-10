import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext } from "@/lib/auth/guards";
import { parseOnboardingUpdate } from "@/lib/onboarding/state";
import { getOnboarding, saveOnboarding } from "@/lib/repos/onboarding";

export const runtime = "nodejs";

/**
 * GET /api/v1/onboarding
 * The current employee's own onboarding record. Never anyone else's.
 */
export async function GET() {
  try {
    const context = await requireAuthContext();
    if (context.session.mustChangePassword) {
      throw ApiError.forbidden(
        "You must change your temporary password before continuing",
        "PASSWORD_CHANGE_REQUIRED",
      );
    }
    const onboarding = await getOnboarding(context.user.id);
    return jsonOk({ onboarding });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * POST /api/v1/onboarding
 * Record a tour as completed or dismissed for the *authenticated* user only.
 *
 * Self-scoped by construction: the document id is always the session user's id
 * (there is no target-id field in the body), so one employee can never mutate
 * another's onboarding state. CSRF + origin are still enforced because it is a
 * state-changing request, and the version is validated against the canonical
 * tour catalogue on the server.
 */
export async function POST(request: NextRequest) {
  try {
    await assertCsrfAndOrigin();

    const context = await requireAuthContext();
    if (context.session.mustChangePassword) {
      throw ApiError.forbidden(
        "You must change your temporary password before continuing",
        "PASSWORD_CHANGE_REQUIRED",
      );
    }

    const body: unknown = await request.json().catch(() => null);
    const parsed = parseOnboardingUpdate(body);
    if (!parsed.ok) throw ApiError.badRequest(parsed.error);

    const onboarding = await saveOnboarding(context.user.id, parsed.value);
    return jsonOk({ onboarding });
  } catch (error) {
    return toErrorResponse(error);
  }
}
