// Sweep records that reference a vehicle (or parent record) that no longer
// exists. Dry run by default; pass --apply to delete.
import { readFileSync } from "node:fs";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const app = initializeApp({
  credential: cert({
    projectId: env.FIREBASE_ADMIN_PROJECT_ID,
    clientEmail: env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\\\n/g, "\n").replace(/\\n/g, "\n"),
  }),
  projectId: env.FIREBASE_ADMIN_PROJECT_ID,
});
const db = getFirestore(app);
const APPLY = process.argv.includes("--apply");

async function idSet(collection) {
  const snap = await db.collection(collection).get();
  return new Set(snap.docs.map((d) => d.id));
}

const vehicles = await idSet("vehicles");
const assignments = await idSet("assignments");
const workOrders = await idSet("workOrders");
const issues = await idSet("maintenanceReports");

const vehicleScoped = [
  "workOrders",
  "maintenanceReports",
  "incidentReports",
  "expenses",
  "odometerReadings",
  "maintenanceSchedules",
  "serviceRecords",
  "vehicleDocuments",
  "fuelEntries",
  "inspections",
  "assignments",
];

const deletes = [];
for (const col of vehicleScoped) {
  const snap = await db.collection(col).get();
  for (const doc of snap.docs) {
    const v = doc.data().vehicleId;
    if (v && !vehicles.has(v)) deletes.push({ col, id: doc.id, key: `vehicleId=${v}` });
  }
}

// Dangling join rows + reservations + assignment children.
const woIssues = await db.collection("workOrderIssues").get();
for (const doc of woIssues.docs) {
  const d = doc.data();
  if ((d.workOrderId && !workOrders.has(d.workOrderId)) || (d.issueId && !issues.has(d.issueId)))
    deletes.push({ col: "workOrderIssues", id: doc.id, key: "dangling join" });
}
const reservations = await db.collection("assignmentReservations").get();
for (const doc of reservations.docs) {
  const a = doc.data().assignmentId;
  if (a && !assignments.has(a))
    deletes.push({ col: "assignmentReservations", id: doc.id, key: `assignment=${a}` });
}

const byCol = {};
for (const d of deletes) (byCol[d.col] ??= []).push(d);
console.log(`${APPLY ? "DELETING" : "DRY RUN"} — ${deletes.length} orphaned record(s):`);
for (const [col, rows] of Object.entries(byCol)) {
  console.log(`  ${col}: ${rows.length}`);
  for (const r of rows.slice(0, 20)) console.log(`    - ${r.id} (${r.key})`);
}
if (APPLY) {
  for (const d of deletes) await db.collection(d.col).doc(d.id).delete();
  console.log("done");
}
process.exit(0);
