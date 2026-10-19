/**
 * One-off expense lifecycle migration: RECORDED → PENDING.
 *
 * Expenses gained in-app approval. The old model only knew `RECORDED` and
 * `VOID`; the new one is `PENDING → APPROVED | REJECTED` with `VOID` as a
 * reversal of an approved cost. This rewrites stored status strings so
 * existing records sit in the new lifecycle correctly:
 *
 *   RECORDED → PENDING     (pre-approval record — now waits for a sign-off)
 *   PAID     → APPROVED    (legacy v1: paid implies it was approved)
 *   PENDING  → PENDING     (already correct)
 *   APPROVED → APPROVED    (already correct)
 *   REJECTED → REJECTED    (already correct)
 *   VOID     → VOID        (already correct)
 *
 * Existing `RECORDED` rows deliberately become PENDING rather than APPROVED:
 * the old `RECORDED` bucket mixed never-approved v1 `PENDING` rows with
 * already-approved rows, so the distinction is gone. Auto-approving them would
 * silently bless unreviewed costs; leaving them pending means a person signs
 * off on real numbers. PENDING still counts in totals, so no cost disappears.
 *
 * Approval metadata (`approvedBy`/`rejectedBy`/…) is only added when a user
 * takes the action, so nothing is invented here. Idempotent — re-running finds
 * nothing to change. Dry run by default; pass --apply to write.
 *
 *   node scripts/migrate-expense-approval.mjs            # preview (no writes)
 *   node scripts/migrate-expense-approval.mjs --apply    # commit
 */
import { readFileSync } from "node:fs";

import { cert, deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const APPLY = process.argv.includes("--apply");

/** Legacy status → current status. Anything already current is left alone. */
const STATUS_MAP = {
  RECORDED: "PENDING",
  PAID: "APPROVED",
};

/** The statuses that exist today. */
const CURRENT_STATUSES = new Set(["PENDING", "APPROVED", "REJECTED", "VOID"]);

function loadEnv() {
  const text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  return Object.fromEntries(
    text
      .split("\n")
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const i = line.indexOf("=");
        return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
      }),
  );
}

const env = loadEnv();
const app = initializeApp({
  credential: cert({
    projectId: env.FIREBASE_ADMIN_PROJECT_ID,
    clientEmail: env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\\\n/g, "\n").replace(/\\n/g, "\n"),
  }),
  projectId: env.FIREBASE_ADMIN_PROJECT_ID,
});
const db = getFirestore(app);

try {
  console.log(
    `\nExpense lifecycle migration (RECORDED → PENDING) ${APPLY ? "— APPLY" : "— DRY RUN"}\n`,
  );

  const unknowns = new Set();
  let scanned = 0;
  let changed = 0;

  const expenses = await db.collection("expenses").get();
  for (const doc of expenses.docs) {
    scanned += 1;
    const before = doc.data().status ?? "(missing)";
    const after = STATUS_MAP[before] ?? before;

    if (!CURRENT_STATUSES.has(after) && !unknowns.has(after)) unknowns.add(after);
    if (after === before) continue;

    changed += 1;
    console.log(`  expenses/${doc.id}  ${before} → ${after}`);
    if (APPLY) await doc.ref.update({ status: after, updatedAt: new Date() });
  }

  console.log("\nSummary");
  console.log(`  expenses scanned:  ${scanned}`);
  console.log(`  expenses updated:  ${changed}`);
  if (unknowns.size > 0) {
    console.log(`  ⚠ unrecognised statuses kept: ${[...unknowns].join(", ")}`);
    console.log("    Review these rows manually — they are ignored by the new lifecycle.");
  }
  console.log(
    APPLY ? "\n✓ Migration applied.\n" : "\nDry run only. Re-run with --apply to write.\n",
  );
} catch (error) {
  console.error("✗ Migration failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await deleteApp(app);
}
