/**
 * Concurrency E2E: assignment reservation integrity (acceptance scenario C).
 *
 * Requires the dev server (`npm run dev`) and a filled `.env.local`.
 *
 *   npm run dev &
 *   node scripts/e2e-concurrency.mjs
 *
 * Proves the vehicle/driver assignment invariant holds under genuine
 * simultaneity, not just sequential re-submission:
 *
 *   A. N drivers race for the SAME vehicle concurrently → exactly one 201,
 *      every other request 409.
 *   B. One driver races for N different vehicles concurrently → exactly one
 *      201, every other 409 (one active assignment per driver).
 *   C. A later start for the now-held vehicle is rejected 409.
 *
 * Cleans up every user, vehicle, assignment, odometer reading and reservation
 * it creates.
 */
import { readFileSync } from "node:fs";

import { cert, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const ORIGIN = process.env.E2E_ORIGIN ?? BASE_URL;
const PASSWORD = "Fleet-OPS-2424!x";
const EMAIL_SUFFIX = process.env.E2E_CONCURRENCY_SUFFIX ?? `conc-${Date.now()}`;

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
const adminAuth = getAuth(app);
const db = getFirestore(app);
void deleteApp; // retained for symmetry with the other scripts

let passed = 0;
let failed = 0;
function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function parseCookies(res) {
  const out = {};
  for (const entry of res.headers.getSetCookie()) {
    const [pair] = entry.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) out[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return out;
}
function cookieHeader(cookies) {
  return Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

async function login(email) {
  const signIn = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${env.NEXT_PUBLIC_FIREBASE_API_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
    },
  );
  const data = await signIn.json();
  if (!signIn.ok) throw new Error(`signIn failed: ${signIn.status}`);
  const res = await fetch(`${BASE_URL}/api/v1/auth/session`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ idToken: data.idToken }),
  });
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  return parseCookies(res);
}

async function startAssignment(cookies, body) {
  const res = await fetch(`${BASE_URL}/api/v1/assignments`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: cookieHeader(cookies),
      origin: ORIGIN,
      "x-csrf-token": cookies.egt_csrf ?? "",
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function createUser(email, roles) {
  const record = await adminAuth.createUser({ email, password: PASSWORD });
  await db
    .collection("users")
    .doc(record.uid)
    .set({
      firebaseUid: record.uid,
      name: `E2E ${roles[0]}`,
      email,
      status: "ACTIVE",
      roles,
      mustChangePassword: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  return { uid: record.uid, email };
}

async function createVehicle(label, odometerKm) {
  const ref = db.collection("vehicles").doc(`e2e-conc-${label}-${EMAIL_SUFFIX}`);
  await ref.set({
    regNumber: `E2E-CONC-${label}-${EMAIL_SUFFIX}`.slice(0, 30),
    make: "Toyota",
    model: "Hiace",
    year: 2022,
    type: "VAN",
    odometerKm,
    odometerAt: new Date(),
    odometerSource: "MANUAL_ENTRY",
    ownership: "COMPANY_OWNED",
    status: "ACTIVE",
    createdBy: "e2e-setup",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return ref.id;
}

const created = { users: [], vehicles: [], assignments: [] };
async function cleanup() {
  for (const vehicleId of created.vehicles) {
    const readings = await db
      .collection("odometerReadings")
      .where("vehicleId", "==", vehicleId)
      .get();
    await Promise.all(readings.docs.map((d) => d.ref.delete()));
    await db
      .collection("assignmentReservations")
      .doc(`vehicle:${vehicleId}`)
      .delete()
      .catch(() => {});
    await db
      .collection("vehicles")
      .doc(vehicleId)
      .delete()
      .catch(() => {});
  }
  for (const assignmentId of created.assignments) {
    await db
      .collection("assignments")
      .doc(assignmentId)
      .delete()
      .catch(() => {});
  }
  for (const user of created.users) {
    await db
      .collection("assignmentReservations")
      .doc(`driver:${user.uid}`)
      .delete()
      .catch(() => {});
    for (const coll of ["sessions", "auditLogs"]) {
      const field = coll === "sessions" ? "userId" : "actorId";
      const snap = await db.collection(coll).where(field, "==", user.uid).get();
      await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }
    await db
      .collection("users")
      .doc(user.uid)
      .delete()
      .catch(() => {});
    await adminAuth.deleteUser(user.uid).catch(() => {});
  }
}

const N = 4;

try {
  console.log(`\nConcurrency e2e @ ${BASE_URL}\n`);

  // Six drivers: 4 race in case A, 1 races in case B, 1 is the later attacker.
  const drivers = [];
  for (let i = 0; i < 6; i += 1) {
    drivers.push(await createUser(`conc${i}.${EMAIL_SUFFIX}@e2e.local`, ["DRIVER"]));
  }
  created.users.push(...drivers);
  const driverCookies = await Promise.all(drivers.map((d) => login(d.email)));

  const sharedVehicle = await createVehicle("shared", 100000);
  created.vehicles.push(sharedVehicle);

  /* ── Scenario C-1: N drivers race for ONE vehicle ───────────────────── */
  const raceA = await Promise.all(
    driverCookies.slice(0, N).map((cookies, i) =>
      startAssignment(cookies, {
        vehicleId: sharedVehicle,
        purpose: "TOUR",
        startOdometerKm: 100000 + i, // distinct tokens/readings per racer
        clientToken: `conc-a-${EMAIL_SUFFIX}-${i}`,
      }),
    ),
  );
  const winsA = raceA.filter((r) => r.status === 201);
  const conflictsA = raceA.filter((r) => r.status === 409);
  check(
    `A: exactly one of ${N} simultaneous starts for one vehicle succeeds`,
    winsA.length === 1 && conflictsA.length === N - 1,
    `statuses=${raceA.map((r) => r.status).join(",")}`,
  );
  for (const r of winsA) if (r.body?.assignment?.id) created.assignments.push(r.body.assignment.id);

  /* ── Scenario C-2: ONE driver races for N vehicles ──────────────────── */
  const raceVehicles = [];
  for (let i = 0; i < N; i += 1) raceVehicles.push(await createVehicle(`dr${i}`, 200000));
  created.vehicles.push(...raceVehicles);
  const soloCookies = driverCookies[N]; // the 5th driver

  const raceB = await Promise.all(
    raceVehicles.map((vehicleId, i) =>
      startAssignment(soloCookies, {
        vehicleId,
        purpose: "TOUR",
        startOdometerKm: 200000 + i,
        clientToken: `conc-b-${EMAIL_SUFFIX}-${i}`,
      }),
    ),
  );
  const winsB = raceB.filter((r) => r.status === 201);
  const conflictsB = raceB.filter((r) => r.status === 409);
  check(
    `B: exactly one of ${N} simultaneous vehicles for one driver succeeds`,
    winsB.length === 1 && conflictsB.length === N - 1,
    `statuses=${raceB.map((r) => r.status).join(",")}`,
  );
  for (const r of winsB) if (r.body?.assignment?.id) created.assignments.push(r.body.assignment.id);

  /* ── Scenario C-3: later attacker blocked by the reservation ────────── */
  const attackerCookies = driverCookies[5];
  const later = await startAssignment(attackerCookies, {
    vehicleId: sharedVehicle,
    purpose: "TOUR",
    startOdometerKm: 100050,
    clientToken: `conc-c-${EMAIL_SUFFIX}`,
  });
  check(
    "C: a later start for the held vehicle is rejected 409",
    later.status === 409,
    `status=${later.status}`,
  );

  console.log(`\n${passed} passed, ${failed} failed\n`);
} catch (error) {
  failed += 1;
  console.error("concurrency e2e crashed:", error);
} finally {
  await cleanup();
  process.exit(failed === 0 ? 0 : 1);
}
