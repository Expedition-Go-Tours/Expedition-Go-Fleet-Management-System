/**
 * Purge demo / test data so the system starts clean for real use.
 *
 * The application ships with **no starter data** — but E2E runs leave fixtures
 * behind if a run is interrupted, and during evaluation you may have entered
 * throwaway records. This sweeps both.
 *
 *   node scripts/purge-demo-data.mjs              # preview (no writes)
 *   node scripts/purge-demo-data.mjs --apply      # delete detected demo data
 *   node scripts/purge-demo-data.mjs --all --apply      # wipe ALL business data
 *   node scripts/purge-demo-data.mjs --all --include-audit --apply
 *
 * Two modes:
 *
 *  - **demo** (default): removes records that look like test fixtures —
 *    `e2e-` ids, `@e2e.local` addresses, `E2E-` registration numbers, `E2E …`
 *    names — plus every row that hangs off them. Your own data is untouched.
 *
 *  - **`--all`**: wipes every business record (vehicles, trips, expenses, fuel,
 *    documents, work orders, …) so you can enter real data from a clean slate.
 *    Users, their roles, invitations and audit history are kept so you can
 *    still sign in and remain accountable; add `--include-audit` to clear the
 *    audit trail too.
 *
 * Idempotent and safe: dry run by default, nothing is deleted without `--apply`,
 * and a "wipe everything" run asks for explicit confirmation.
 */
import { createInterface } from "node:readline/promises";
import { readFileSync } from "node:fs";

import { cert, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const APPLY = process.argv.includes("--apply");
const ALL = process.argv.includes("--all");
const INCLUDE_AUDIT = process.argv.includes("--include-audit");

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
const auth = getAuth(app);

/**
 * Collections whose rows are deleted when they reference a purged record.
 * Everything keyed to a vehicle or a user goes with it — otherwise the app is
 * left pointing at records that no longer exist.
 */
const DEPENDENT_COLLECTIONS = [
  "odometerReadings",
  "mileageEntries",
  "maintenanceTemplates",
  "maintenanceSchedules",
  "serviceRecords",
  "serviceHistory",
  "maintenanceReports",
  "incidentReports",
  "workOrders",
  "workOrderIssues",
  "assignments",
  "assignmentReservations",
  "inspections",
  "expenses",
  "fuelEntries",
  "vehicleDocuments",
  "notifications",
  "trips",
  "savedLocations",
  "registrationLocks",
  "providers",
  "onboarding",
];

/** Wiped by `--all`. Deliberately excludes identity (users, roles, sessions, invites). */
const BUSINESS_COLLECTIONS = [...DEPENDENT_COLLECTIONS, "vehicles"];

/** Kept even by `--all`, unless `--include-audit` is passed. */
const IDENTITY_COLLECTIONS = ["users", "roles", "userRoles", "sessions", "invites"];

const isDemoUser = (id, data) =>
  id.startsWith("e2e-") ||
  String(data.email ?? "").endsWith("@e2e.local") ||
  String(data.name ?? "").startsWith("E2E");

const isDemoVehicle = (id, data) =>
  id.startsWith("e2e-veh") ||
  String(data.regNumber ?? "").startsWith("E2E-") ||
  String(data.name ?? "").startsWith("E2E");

const isDemoRow = (id, data) =>
  String(data.createdBy ?? "").startsWith("e2e-") ||
  String(data.uploadedBy ?? "").startsWith("e2e-") ||
  String(data.reportedBy ?? "").startsWith("e2e-") ||
  String(data.driverUserId ?? "").startsWith("e2e-");

/** Fields that link a row back to a vehicle or a user. */
const VEHICLE_KEYS = ["vehicleId"];
const USER_KEYS = [
  "userId",
  "driverUserId",
  "createdBy",
  "uploadedBy",
  "reportedBy",
  "performedBy",
  "assignedTo",
  "resolvedBy",
  "closedBy",
  "actorId",
];

async function collectionDocs(name) {
  const snap = await db.collection(name).get();
  return snap.docs;
}

async function main() {
  console.log(
    `\nDemo-data purge ${APPLY ? "— APPLY" : "— DRY RUN"}${ALL ? " (ALL business data)" : ""}\n`,
  );

  const deletions = new Map(); // collection -> doc ids
  const authUids = new Set(); // Firebase login identities to remove with them
  const queue = (collection, id) => {
    if (!deletions.has(collection)) deletions.set(collection, new Set());
    deletions.get(collection).add(id);
  };

  if (ALL) {
    for (const collection of BUSINESS_COLLECTIONS) {
      for (const doc of await collectionDocs(collection)) queue(collection, doc.id);
    }
    if (INCLUDE_AUDIT) {
      for (const doc of await collectionDocs("auditLogs")) queue("auditLogs", doc.id);
    }
  } else {
    // ── 1. Find the demo users and vehicles themselves ───────────────────────
    const demoVehicleIds = new Set();
    const demoUserIds = new Set();

    for (const doc of await collectionDocs("vehicles")) {
      if (isDemoVehicle(doc.id, doc.data())) {
        demoVehicleIds.add(doc.id);
        queue("vehicles", doc.id);
      }
    }
    for (const doc of await collectionDocs("users")) {
      if (isDemoUser(doc.id, doc.data())) {
        demoUserIds.add(doc.id);
        queue("users", doc.id);
        // Keep the Firebase account id so the login identity goes too — a
        // leftover Auth user can still authenticate even with no record here.
        const uid = String(doc.data().firebaseUid ?? "");
        if (uid) authUids.add(uid);
      }
    }

    // Auth accounts with no Firestore record at all (interrupted runs).
    {
      let pageToken;
      do {
        const page = await auth.listUsers(1000, pageToken);
        for (const user of page.users) {
          if (String(user.email ?? "").endsWith("@e2e.local") || user.uid.startsWith("e2e-")) {
            authUids.add(user.uid);
          }
        }
        pageToken = page.pageToken;
      } while (pageToken);
    }

    // ── 2. Everything that hangs off them, plus rows that self-identify ──────
    for (const collection of DEPENDENT_COLLECTIONS) {
      for (const doc of await collectionDocs(collection)) {
        const data = doc.data();
        const touched =
          isDemoRow(doc.id, data) ||
          VEHICLE_KEYS.some((key) => demoVehicleIds.has(String(data[key] ?? ""))) ||
          USER_KEYS.some((key) => demoUserIds.has(String(data[key] ?? "")));
        if (touched) queue(collection, doc.id);
      }
    }

    // Demo users leave role history and sessions behind.
    for (const collection of ["userRoles", "sessions", "invites"]) {
      for (const doc of await collectionDocs(collection)) {
        const data = doc.data();
        if (demoUserIds.has(String(data.userId ?? "")) || isDemoUser(doc.id, data)) {
          queue(collection, doc.id);
        }
      }
    }
  }

  // ── Report ────────────────────────────────────────────────────────────────
  let total = 0;
  for (const [collection, ids] of [...deletions.entries()].sort()) {
    if (ids.size === 0) continue;
    total += ids.size;
    console.log(`  ${collection.padEnd(24)} ${ids.size}`);
  }
  if (authUids.size > 0) {
    total += authUids.size;
    console.log(`  ${"firebaseAuth".padEnd(24)} ${authUids.size}`);
  }
  console.log(`\n  ${"total".padEnd(24)} ${total}`);

  if (total === 0) {
    console.log("\nNothing to purge — the database is already clean.\n");
    return;
  }

  if (!APPLY) {
    console.log("\nDry run only. Re-run with --apply to delete the above.\n");
    return;
  }

  if (ALL) {
    // Wiping real data is irreversible — make the operator say so explicitly.
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(
      `\nThis deletes ALL ${total} business records. Users and audit history are kept. Type "wipe" to confirm: `,
    );
    rl.close();
    if (answer.trim().toLowerCase() !== "wipe") {
      console.log("Aborted. Nothing was deleted.\n");
      return;
    }
  }

  let deleted = 0;
  for (const [collection, ids] of deletions) {
    // Batches of 400 to stay well inside Firestore's 500-write limit.
    const list = [...ids];
    for (let i = 0; i < list.length; i += 400) {
      const batch = db.batch();
      for (const id of list.slice(i, i + 400)) {
        batch.delete(db.collection(collection).doc(id));
        deleted += 1;
      }
      await batch.commit();
    }
  }

  // Firebase Auth identities last — a login that outlives its record is still a
  // login. `deleteUsers` takes up to 1000 at a time and reports failures by index.
  let authDeleted = 0;
  const uids = [...authUids];
  for (let i = 0; i < uids.length; i += 1000) {
    const chunk = uids.slice(i, i + 1000);
    const result = await auth.deleteUsers(chunk);
    authDeleted += result.successCount;
    for (const failure of result.errors) {
      console.warn(
        `  ! could not delete auth user ${chunk[failure.index]}: ${failure.error.message}`,
      );
    }
  }

  console.log(
    `\n✓ Deleted ${deleted} record(s) and ${authDeleted} login account(s). The app is empty and ready for real data.\n`,
  );
}

try {
  await main();
} catch (error) {
  console.error("✗ Purge failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await deleteApp(app);
}
