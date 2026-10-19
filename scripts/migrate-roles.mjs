/**
 * One-off role consolidation migration: six roles → three.
 *
 *   MAINTENANCE → DRIVER      (the workshop has no account; drivers record it)
 *   MANAGER     → ADMIN       (one owner-level role)
 *   FINANCE     → OPERATIONS  (dispatch and costs are the same desk job)
 *
 * Rewrites the stored role strings so existing accounts keep working after the
 * role list in `src/lib/auth/types.ts` shrinks. It updates three places:
 *
 *   - users.roles                    — authoritative; read on every request
 *   - userRoles[].roles              — assignment history, kept consistent
 *   - notifications[].recipientRole  — so existing alerts stay visible to the
 *                                      role that now owns them
 *
 * MFA/role-owned data is untouched. The script is idempotent — re-running it
 * after a successful pass finds nothing to change.
 *
 * Dry run by default; pass --apply to write.
 *
 *   node scripts/migrate-roles.mjs            # preview (no writes)
 *   node scripts/migrate-roles.mjs --apply    # commit
 */
import { readFileSync } from "node:fs";

import { cert, deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const APPLY = process.argv.includes("--apply");

/** Legacy role → current role. Anything already current is left alone. */
const ROLE_MAP = {
  MAINTENANCE: "DRIVER",
  MANAGER: "ADMIN",
  FINANCE: "OPERATIONS",
};

/** The three roles that exist today. */
const CURRENT_ROLES = new Set(["ADMIN", "OPERATIONS", "DRIVER"]);

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

/**
 * Map a stored role to its current equivalent, preserving order and removing
 * duplicates. Unknown values are reported and kept (never silently dropped, so
 * a typo cannot lock someone out).
 */
function mapRoles(roles, unknowns) {
  const seen = new Set();
  const out = [];
  for (const role of Array.isArray(roles) ? roles : []) {
    const mapped = ROLE_MAP[role] ?? role;
    if (!CURRENT_ROLES.has(mapped) && !unknowns.has(mapped)) unknowns.add(mapped);
    if (seen.has(mapped)) continue;
    seen.add(mapped);
    out.push(mapped);
  }
  return out;
}

/** A stable, comparable form so we only write when the value really changed. */
const sorted = (roles) => [...roles].sort().join(",");

try {
  console.log(`\nRole migration (6 → 3) ${APPLY ? "— APPLY" : "— DRY RUN"}\n`);

  const unknowns = new Set();
  let usersScanned = 0;
  let usersChanged = 0;
  let historyChanged = 0;
  let notificationsChanged = 0;

  // ── users.roles ────────────────────────────────────────────────────────────
  const users = await db.collection("users").get();
  for (const doc of users.docs) {
    usersScanned += 1;
    const before = doc.data().roles;
    const after = mapRoles(before, unknowns);
    if (sorted(before ?? []) === sorted(after)) continue;
    usersChanged += 1;
    console.log(`  users/${doc.id}  [${(before ?? []).join(", ")}] → [${after.join(", ")}]`);
    if (APPLY) await doc.ref.update({ roles: after, updatedAt: new Date() });
  }

  // ── userRoles[].roles (assignment history) ─────────────────────────────────
  const history = await db.collection("userRoles").get();
  for (const doc of history.docs) {
    const before = doc.data().roles;
    const after = mapRoles(before, unknowns);
    if (sorted(before ?? []) === sorted(after)) continue;
    historyChanged += 1;
    if (APPLY) await doc.ref.update({ roles: after });
  }

  // ── notifications[].recipientRole ──────────────────────────────────────────
  const notifications = await db.collection("notifications").get();
  for (const doc of notifications.docs) {
    const before = doc.data().recipientRole;
    const after = ROLE_MAP[before] ?? before;
    if (!after || after === before) continue;
    notificationsChanged += 1;
    if (APPLY) await doc.ref.update({ recipientRole: after });
  }

  console.log("\nSummary");
  console.log(`  users scanned:            ${usersScanned}`);
  console.log(`  users updated:            ${usersChanged}`);
  console.log(`  role-history rows updated: ${historyChanged}`);
  console.log(`  notifications remapped:   ${notificationsChanged}`);
  if (unknowns.size > 0) {
    console.log(`  ⚠ unrecognised roles kept: ${[...unknowns].join(", ")}`);
    console.log("    Review these accounts manually — they hold no permissions.");
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
