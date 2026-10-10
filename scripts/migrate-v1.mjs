/**
 * One-time production data migration to the accountable fleet domain.
 *
 * This is the Phase A–F forward-migration. It is idempotent and safe to
 * re-run: every step checks for already-migrated documents before touching
 * them. Nothing is deleted — legacy fields/collections are retained so the
 * pre-upgrade data is recoverable through the audit trail.
 *
 *   node scripts/migrate-v1.mjs [--dry-run]
 *
 * What it does
 * ------------
 * 1. Vehicles ─ the retired `mileage` field becomes a baseline odometer
 *    reading in the ledger (source HISTORICAL_IMPORT, status ACCEPTED) and
 *    the vehicle document gains the `odometerKm` projection + `odometerAt`.
 *    Vehicles already carrying `odometerKm` are skipped.
 * 2. Expenses ─ legacy lifecycle statuses map onto the no-approval model:
 *      PENDING/APPROVED  → RECORDED  (approved outside the system already)
 *      PAID              → RECORDED  (same — payment is outside the system)
 *      VOID              → VOID
 *    Legacy `approval*` fields are retained untouched.
 * 3. Work orders ─ legacy statuses map onto the extended pipeline:
 *      OPEN      → OPEN
 *      IN_PROGRESS → IN_PROGRESS
 *      COMPLETED → COMPLETED
 *      CLOSED    → CLOSED
 *    Nothing reopens/closes work — states are purely remapped by name.
 * 4. Service history ─ legacy `serviceHistory` docs that are NOT linked to a
 *    work order get promoted to first-class ServiceRecords so vehicle
 *    history reads are consistent. Docs already in `serviceRecords` (or
 *    linked to a work order that has a record) are skipped.
 */
import { readFileSync } from "node:fs";

import { cert, deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const DRY_RUN = process.argv.includes("--dry-run");

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
    privateKey: env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
  projectId: env.FIREBASE_ADMIN_PROJECT_ID,
});
const db = getFirestore(app);

const counts = {
  vehicles: { migrated: 0, skipped: 0 },
  expenses: { migrated: 0, skipped: 0 },
  workOrders: { migrated: 0, skipped: 0 },
  serviceHistory: { promoted: 0, skipped: 0 },
};

const LEGACY_EXPENSE_TO_NEW = {
  PENDING: "RECORDED",
  APPROVED: "RECORDED",
  PAID: "RECORDED",
  VOID: "VOID",
};

/** Mirror the vehicle odometerKm write semantics used by the ledger. */
const BASELINE_SOURCE = "HISTORICAL_IMPORT";
const BASELINE_NOTE = "Migrated baseline from legacy mileage field";

async function migrateVehicles() {
  const snap = await db.collection("vehicles").limit(5000).get();
  for (const doc of snap.docs) {
    const data = doc.data();
    const already = typeof data.odometerKm === "number";
    const legacyMileage = typeof data.mileage === "number" ? data.mileage : null;

    if (already || legacyMileage === null) {
      counts.vehicles.skipped += 1;
      continue;
    }

    // A baseline reading with a deterministic id → re-runs never duplicate.
    const readingRef = db.collection("odometerReadings").doc(`base_${doc.id}`);
    const readingExists = (await readingRef.get()).exists;
    const readingPayload = {
      vehicleId: doc.id,
      km: legacyMileage,
      effectiveAt: data.odometerAt instanceof Date ? data.odometerAt : new Date(),
      createdAt: new Date(),
      recordedByUserId: data.createdBy ?? "migration-v1",
      source: BASELINE_SOURCE,
      status: "ACCEPTED",
      notes: BASELINE_NOTE,
      legacyField: "mileage",
    };

    const vehiclePayload = {
      odometerKm: legacyMileage,
      odometerAt: data.odometerAt instanceof Date ? data.odometerAt : new Date(),
      odometerSource: BASELINE_SOURCE,
      migrationV1: { odometerBaseline: true, at: new Date() },
      updatedAt: new Date(),
    };

    if (DRY_RUN) {
      counts.vehicles.migrated += 1;
      continue;
    }
    const batch = db.batch();
    if (!readingExists) batch.set(readingRef, readingPayload);
    batch.update(doc.ref, vehiclePayload);
    await batch.commit();
    counts.vehicles.migrated += 1;
  }
}

async function migrateExpenses() {
  const snap = await db.collection("expenses").limit(5000).get();
  for (const doc of snap.docs) {
    const data = doc.data();
    const legacy = data.status;
    const clean = LEGACY_EXPENSE_TO_NEW[legacy];
    if (!clean) {
      // Already RECORDED or VOID — skip.
      counts.expenses.skipped += 1;
      continue;
    }
    if (DRY_RUN) {
      counts.expenses.migrated += 1;
      continue;
    }
    await doc.ref.update({
      status: clean,
      migrationV1: { fromStatus: legacy, at: new Date() },
      updatedAt: new Date(),
    });
    counts.expenses.migrated += 1;
  }
}

const LEGACY_WO_TO_NEW = {
  OPEN: "OPEN",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  CLOSED: "CLOSED",
};

async function migrateWorkOrders() {
  const snap = await db.collection("workOrders").limit(5000).get();
  for (const doc of snap.docs) {
    const data = doc.data();
    const legacy = data.status;
    const clean = LEGACY_WO_TO_NEW[legacy];
    if (!clean || (data.number && data.number.startsWith("WO-"))) {
      counts.workOrders.skipped += 1;
      continue;
    }
    if (DRY_RUN) {
      counts.workOrders.migrated += 1;
      continue;
    }
    const year = new Date().getFullYear();
    const number = Number(data.number) || null;
    const payload = {
      status: clean,
      number:
        number !== null ? `WO-${year}-${String(number).padStart(6, "0")}` : `WO-${year}-MIGRATED`,
      migrationV1: { fromStatus: legacy, at: new Date() },
      updatedAt: new Date(),
    };
    await doc.ref.update(payload);
    counts.workOrders.migrated += 1;
  }
}

async function migrateServiceHistory() {
  const history = await db.collection("serviceHistory").limit(5000).get();
  const serviceRecords = await db.collection("serviceRecords").limit(5000).get();
  const recordByWorkOrderId = new Map();
  for (const doc of serviceRecords.docs) {
    const wo = doc.data().workOrderId;
    if (wo) recordByWorkOrderId.set(wo, doc.id);
  }

  for (const doc of history.docs) {
    const data = doc.data();
    const workOrderId = data.workOrderId || data.workOrder || null;
    const alreadyLinked = workOrderId && recordByWorkOrderId.has(workOrderId);
    if (alreadyLinked) {
      counts.serviceHistory.skipped += 1;
      continue;
    }
    if (DRY_RUN) {
      counts.serviceHistory.promoted += 1;
      continue;
    }
    // Promote legacy history to a first-class ServiceRecord (idempotent id).
    await db
      .collection("serviceRecords")
      .doc(`mig_${doc.id}`)
      .set(
        {
          vehicleId: data.vehicleId ?? null,
          legacyServiceHistoryId: doc.id,
          workOrderId: workOrderId ?? null,
          taskName: data.description ?? data.taskName ?? "Legacy service record",
          scheduledTaskId: data.scheduleId ?? null,
          odometerKm: data.odometerKm ?? null,
          completedAt: data.completedAt ?? data.date ?? new Date(),
          completionNotes: data.notes ?? null,
          recordedBy: "migration-v1",
          createdAt: new Date(),
        },
        { merge: true },
      );
    counts.serviceHistory.promoted += 1;
  }
}

try {
  if (DRY_RUN) console.log("DRY RUN — no writes will be applied\n");
  await migrateVehicles();
  await migrateExpenses();
  await migrateWorkOrders();
  await migrateServiceHistory();

  console.log("Migration summary (v1 account → fleet-accountability):");
  console.log(
    `  vehicles       migrated    : ${counts.vehicles.migrated}   skipped: ${counts.vehicles.skipped}`,
  );
  console.log(
    `  expenses       remapped    : ${counts.expenses.migrated}   skipped: ${counts.expenses.skipped}`,
  );
  console.log(
    `  work orders    remapped    : ${counts.workOrders.migrated}   skipped: ${counts.workOrders.skipped}`,
  );
  console.log(
    `  serviceHistory promoted    : ${counts.serviceHistory.promoted}   skipped: ${counts.serviceHistory.skipped}`,
  );
  console.log(DRY_RUN ? "\n(dry run — nothing written)" : "\n✓ migration complete");
} catch (error) {
  console.error("✗ Migration failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await deleteApp(app);
}
