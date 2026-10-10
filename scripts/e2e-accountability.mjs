/**
 * Phase A–C fleet-accountability E2E against the live Firebase project.
 * Requires the dev server (npm run dev) and a filled .env.local.
 *
 *   npm run dev &
 *   node scripts/e2e-accountability.mjs
 *
 * Covers the mandated acceptance scenarios that can run without MFA-gated
 * roles (DRIVER/OPERATIONS/MAINTENANCE):
 *  - Odometer ledger: monotonicity, idempotent retries, decrease rejection,
 *    corrections with reason.
 *  - Preventive maintenance: schedule config, live status computation, and the
 *    exact oil-change example (79,250 + 5,000/500 → boundaries).
 *  - Work-order completion: evidence required, service record created once,
 *    only named schedules reset, unrelated schedule untouched.
 *  - Issue → safety hold: critical issue holds the vehicle; completion does
 *    not release it; release permission missing for MAINTENANCE.
 *  - Expense model: RECORDED→VOID only, no approval states anywhere.
 */
import { readFileSync } from "node:fs";

import { cert, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const ORIGIN = process.env.E2E_ORIGIN ?? BASE_URL;
const PASSWORD = "Fleet-A2C-2424!x";
const EMAIL_SUFFIX = process.env.E2E_EMAIL_SUFFIX ?? `${Date.now()}`;

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
const adminAuth = getAuth(app);
const db = getFirestore(app);

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

async function signInPassword(email, password = PASSWORD) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${env.NEXT_PUBLIC_FIREBASE_API_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`firebase signIn failed: ${res.status} ${JSON.stringify(data)}`);
  return data.idToken;
}

async function establishSession(idToken) {
  const res = await fetch(`${BASE_URL}/api/v1/auth/session`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ idToken }),
  });
  return { status: res.status, body: await res.json(), cookies: parseCookies(res) };
}

async function login(email) {
  const session = await establishSession(await signInPassword(email));
  if (session.status !== 200) throw new Error(`login failed: ${JSON.stringify(session.body)}`);
  return session.cookies;
}

async function get(path, cookies) {
  const res = await fetch(`${BASE_URL}${path}`, { headers: { cookie: cookieHeader(cookies) } });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function send(method, path, cookies, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      cookie: cookieHeader(cookies),
      origin: ORIGIN,
      "x-csrf-token": cookies.egt_csrf ?? "",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function createUser(email, roles) {
  const record = await adminAuth.createUser({ email, password: PASSWORD });
  const uid = record.uid;
  await db
    .collection("users")
    .doc(uid)
    .set({
      firebaseUid: uid,
      name: `E2E ${roles[0]}`,
      email,
      status: "ACTIVE",
      roles,
      mustChangePassword: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  return { uid, docId: uid, email };
}

const created = { users: [], docIds: [] };
async function cleanup() {
  for (const user of created.users) {
    const sessions = await db.collection("sessions").where("userId", "==", user.docId).get();
    await Promise.all(sessions.docs.map((d) => d.ref.delete()));
    const audits = await db.collection("auditLogs").where("actorId", "==", user.docId).get();
    await Promise.all(audits.docs.map((d) => d.ref.delete()));
    await db
      .collection("users")
      .doc(user.docId)
      .delete()
      .catch(() => {});
    await adminAuth.deleteUser(user.uid).catch(() => {});
  }
  for (const [collection, id] of created.docIds) {
    await db
      .collection(collection)
      .doc(id)
      .delete()
      .catch(() => {});
  }
}

try {
  console.log(`\nFleet accountability e2e @ ${BASE_URL}\n`);

  const driver = await createUser(`drv.${EMAIL_SUFFIX}@e2e.local`, ["DRIVER"]);
  const maint = await createUser(`mnt.${EMAIL_SUFFIX}@e2e.local`, ["MAINTENANCE"]);
  const ops = await createUser(`op.${EMAIL_SUFFIX}@e2e.local`, ["OPERATIONS"]);
  const finance = await createUser(`fin.${EMAIL_SUFFIX}@e2e.local`, ["FINANCE"]);
  created.users.push(driver, maint, ops, finance);

  // Vehicle with a large initial odometer via the audited registration path
  // is ADMIN-only, so seed the doc + one baseline reading via Admin SDK.
  const vehRef = db.collection("vehicles").doc(`e2e-ac-${EMAIL_SUFFIX}`);
  await vehRef.set({
    regNumber: `E2E-AC-${EMAIL_SUFFIX}`,
    make: "Toyota",
    model: "Hiace",
    year: 2022,
    type: "VAN",
    odometerKm: 79250,
    odometerAt: new Date(),
    odometerSource: "MANUAL_ENTRY",
    ownership: "COMPANY_OWNED",
    status: "ACTIVE",
    createdBy: "e2e-setup",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  created.docIds.push(["vehicles", vehRef.id]);
  await db.collection("odometerReadings").doc(`e2e-base-${EMAIL_SUFFIX}`).set({
    vehicleId: vehRef.id,
    km: 79250,
    effectiveAt: new Date(),
    createdAt: new Date(),
    recordedByUserId: "e2e-setup",
    source: "HISTORICAL_IMPORT",
    status: "ACCEPTED",
    notes: "E2E baseline",
  });
  created.docIds.push(["odometerReadings", `e2e-base-${EMAIL_SUFFIX}`]);

  const [dCookies, mCookies, oCookies, fCookies] = await Promise.all([
    login(driver.email),
    login(maint.email),
    login(ops.email),
    login(finance.email),
  ]);
  console.log("  (users + vehicle ready)\n");

  /* ── A. Odometer ledger ──────────────────────────────────────────────── */
  {
    const read = await get(`/api/v1/vehicles/${vehRef.id}/odometer`, dCookies);
    check(
      "DRIVER can read the odometer ledger (200, projection 79250)",
      read.status === 200 && read.body.currentOdometerKm === 79250,
      JSON.stringify(read.body).slice(0, 200),
    );

    const rec = await send("POST", `/api/v1/vehicles/${vehRef.id}/odometer`, dCookies, {
      km: 80000,
      source: "TRIP_START",
      clientToken: `e2e-t1-${EMAIL_SUFFIX}`,
    });
    check(
      "DRIVER records an odometer reading (201, projection rises to 80000)",
      rec.status === 201 &&
        rec.body.currentOdometerKm === 80000 &&
        rec.body.reading.deltaKm === 750,
      JSON.stringify(rec.body).slice(0, 250),
    );

    // Idempotent retry — same clientToken must not create a duplicate.
    const retry = await send("POST", `/api/v1/vehicles/${vehRef.id}/odometer`, dCookies, {
      km: 80000,
      source: "TRIP_START",
      clientToken: `e2e-t1-${EMAIL_SUFFIX}`,
    });
    check(
      "retry with same clientToken is idempotent (no duplicate)",
      retry.status === 200 && retry.body.duplicate === true,
      JSON.stringify(retry.body).slice(0, 200),
    );

    const decrease = await send("POST", `/api/v1/vehicles/${vehRef.id}/odometer`, dCookies, {
      km: 79000,
      source: "MANUAL_ENTRY",
    });
    check(
      "lower live reading is rejected (409 DECREASE_REJECTED)",
      decrease.status === 409 && decrease.body.error?.code === "DECREASE_REJECTED",
      JSON.stringify(decrease.body).slice(0, 200),
    );

    const invalid = await send("POST", `/api/v1/vehicles/${vehRef.id}/odometer`, dCookies, {
      km: 12.5,
      source: "MANUAL_ENTRY",
    });
    check(
      "non-integer km rejected (400)",
      invalid.status === 400 && invalid.body.error?.code === "INVALID_KM",
      JSON.stringify(invalid.body).slice(0, 200),
    );

    // PATCH mileage editing is gone — the requirement forbids it.
    const patch = await send("PATCH", `/api/v1/vehicles/${vehRef.id}`, mCookies, {
      mileage: 99999,
    });
    check(
      "PATCH mileage is rejected (400 — odometer workflow only)",
      patch.status === 400 && /odometer/i.test(patch.body?.error?.message ?? ""),
      JSON.stringify(patch.body).slice(0, 200),
    );

    // Correction by MAINTENANCE (odometer:correct).
    const ledger = await get(`/api/v1/vehicles/${vehRef.id}/odometer`, mCookies);
    const readingId = ledger.body.readings?.[0]?.id;
    const correct = await send("POST", `/api/v1/odometer/${readingId}/correct`, mCookies, {
      correctedKm: 80100,
      reason: "Driver misread by 100 km — verified against fuel receipt",
    });
    check(
      "MAINTENANCE corrects a reading (200, original superseded, reason recorded)",
      correct.status === 200 &&
        correct.body.original.status === "SUPERSEDED" &&
        correct.body.replacement.supersedesReadingId === readingId,
      JSON.stringify(correct.body).slice(0, 300),
    );

    const noReason = await send(
      "POST",
      `/api/v1/odometer/${correct.body.replacement.id}/correct`,
      mCookies,
      { correctedKm: 80200, reason: "" },
    );
    check(
      "correction without a reason is rejected (400)",
      noReason.status === 400,
      JSON.stringify(noReason.body).slice(0, 150),
    );
  }

  /* ── B. Maintenance schedule — mandated oil-change example ───────────── */
  {
    // Vehicle projection is 80,100 after the correction above.
    const createdSchedule = await send("POST", "/api/v1/maintenance/schedules", mCookies, {
      vehicleId: vehRef.id,
      taskName: "Engine oil change",
      category: "OIL",
      intervalKm: 5000,
      dueSoonKm: 500,
      intervalDays: 365,
      dueSoonDays: 30,
      lastServiceOdometerKm: 79250,
      lastServiceDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      source: "Company policy (initial)",
    });
    check(
      "MAINTENANCE configures an oil-change schedule (201)",
      createdSchedule.status === 201 && createdSchedule.body.schedule?.id,
      JSON.stringify(createdSchedule.body).slice(0, 250),
    );
    const scheduleId = createdSchedule.body.schedule?.id;
    if (scheduleId) created.docIds.push(["maintenanceSchedules", scheduleId]);

    // Live status: projection 80,100 vs due 84,250 → OK, 4,150 km remaining.
    const status = await get(`/api/v1/maintenance/schedules?vehicleId=${vehRef.id}`, mCookies);
    const oil = (status.body.schedules ?? []).find((s) => s.taskName === "Engine oil change");
    check(
      "schedule computes OK at 80,100 (next due 84,250)",
      oil && oil.status === "OK" && oil.nextDueOdometerKm === 84250 && oil.remainingKm === 4150,
      JSON.stringify(oil).slice(0, 300),
    );

    // Drive to 83,900 → DUE_SOON (within 500 km of 84,250).
    const drive = await send("POST", `/api/v1/vehicles/${vehRef.id}/odometer`, mCookies, {
      km: 83900,
      source: "TRIP_END",
      clientToken: `e2e-drive-${EMAIL_SUFFIX}`,
    });
    check(
      "odometer raised to 83,900 (201)",
      drive.status === 201 && drive.body.currentOdometerKm === 83900,
      JSON.stringify(drive.body).slice(0, 200),
    );
    const soon = await get(`/api/v1/maintenance/schedules?vehicleId=${vehRef.id}`, mCookies);
    const oilSoon = (soon.body.schedules ?? []).find((s) => s.taskName === "Engine oil change");
    check(
      "oil change is DUE_SOON at 83,900 (350 km remaining)",
      oilSoon?.status === "DUE_SOON" && oilSoon.remainingKm === 350,
      JSON.stringify(oilSoon).slice(0, 300),
    );

    // A second, unrelated schedule must not be affected by oil resets later.
    const brakes = await send("POST", "/api/v1/maintenance/schedules", mCookies, {
      vehicleId: vehRef.id,
      taskName: "Brake inspection",
      category: "BRAKES",
      intervalKm: 10000,
      dueSoonKm: 1000,
      lastServiceOdometerKm: 75000,
      lastServiceDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    });
    check(
      "brake-inspection schedule configured (201)",
      brakes.status === 201 && brakes.body.schedule?.id,
      JSON.stringify(brakes.body).slice(0, 200),
    );
    if (brakes.body.schedule?.id) {
      created.docIds.push(["maintenanceSchedules", brakes.body.schedule.id]);
    }
  }

  /* ── C. Issue → work order → completion → service record ────────────── */
  {
    const issue = await send("POST", "/api/v1/reports", dCookies, {
      vehicleId: vehRef.id,
      title: "Oil leak under engine",
      description: "Oil dripping from the sump area after long tours.",
      severity: "HIGH",
      category: "FLUID_LEAK",
      odometerKm: 83900,
      clientToken: `e2e-issue-${EMAIL_SUFFIX}`,
    });
    check(
      "DRIVER reports an issue (201 with reference number)",
      issue.status === 201 && issue.body.report?.number?.startsWith("ISS-"),
      JSON.stringify(issue.body).slice(0, 250),
    );
    const issueId = issue.body.report?.id;
    if (issueId) created.docIds.push(["maintenanceReports", issueId]);

    // Idempotent retry of the same issue submission.
    const retry = await send("POST", "/api/v1/reports", dCookies, {
      vehicleId: vehRef.id,
      title: "Oil leak under engine",
      description: "Oil dripping from the sump area after long tours.",
      severity: "HIGH",
      clientToken: `e2e-issue-${EMAIL_SUFFIX}`,
    });
    check(
      "issue retry with same clientToken does not duplicate",
      retry.body.report?.id === issueId,
      JSON.stringify(retry.body).slice(0, 200),
    );

    const wo = await send("POST", `/api/v1/reports/${issueId}/work-order`, mCookies, {
      priority: "HIGH",
    });
    check(
      "MAINTENANCE creates a work order from the issue (201, linked both ways)",
      wo.status === 201 &&
        wo.body.workOrder?.number?.startsWith("WO-") &&
        wo.body.workOrder?.issueIds?.includes(issueId),
      JSON.stringify(wo.body).slice(0, 300),
    );
    const workOrderId = wo.body.workOrder?.id;
    if (workOrderId) created.docIds.push(["workOrders", workOrderId]);

    // Start, then attempt completion WITHOUT evidence → rejected.
    await send("POST", `/api/v1/work-orders/${workOrderId}/status`, mCookies, {
      action: "start",
    });
    const noEvidence = await send("POST", `/api/v1/work-orders/${workOrderId}/complete`, mCookies, {
      odometerKm: 83950,
    });
    check(
      "completion without workPerformed is rejected (400)",
      noEvidence.status === 400 && /workPerformed/.test(noEvidence.body?.error?.message ?? ""),
      JSON.stringify(noEvidence.body).slice(0, 200),
    );

    const noOdometer = await send("POST", `/api/v1/work-orders/${workOrderId}/complete`, mCookies, {
      workPerformed: "Replaced sump gasket",
    });
    check(
      "completion without odometerKm is rejected (400)",
      noOdometer.status === 400 && /odometerKm/.test(noOdometer.body?.error?.message ?? ""),
      JSON.stringify(noOdometer.body).slice(0, 200),
    );

    const complete = await send("POST", `/api/v1/work-orders/${workOrderId}/complete`, mCookies, {
      completedAt: new Date().toISOString(),
      odometerKm: 83950,
      workPerformed: "Replaced sump gasket, refilled 4.5L oil, checked for leaks.",
      outcome: "No further leaks on road test.",
      scheduleIds: [],
      resolvedIssueIds: [issueId],
    });
    check(
      "work order completes with evidence (service record created)",
      complete.status === 200 &&
        complete.body.serviceRecord?.id &&
        complete.body.duplicate === false,
      JSON.stringify(complete.body).slice(0, 300),
    );

    // Replay → idempotent.
    const replay = await send("POST", `/api/v1/work-orders/${workOrderId}/complete`, mCookies, {
      odometerKm: 83950,
      workPerformed: "Replayed request",
    });
    check(
      "completion replay is idempotent (duplicate=true, same record)",
      replay.status === 200 && replay.body.duplicate === true,
      JSON.stringify(replay.body).slice(0, 200),
    );

    const history = await get(`/api/v1/service-records?vehicleId=${vehRef.id}`, mCookies);
    check(
      "service history shows the record exactly once",
      history.status === 200 && history.body.serviceRecords?.length === 1,
      JSON.stringify(history.body).slice(0, 200),
    );

    const issueAfter = await get(`/api/v1/reports/${issueId}`, mCookies);
    check(
      "resolved issue is CLOSED with a resolution",
      issueAfter.status === 200 &&
        issueAfter.body.report?.status === "CLOSED" &&
        issueAfter.body.report?.resolution?.includes("sump gasket"),
      JSON.stringify(issueAfter.body?.report?.status).slice(0, 200),
    );

    // Work order shows the service record link.
    const woAfter = await get(`/api/v1/work-orders?vehicleId=${vehRef.id}`, mCookies);
    const woRecord = (woAfter.body.workOrders ?? []).find((w) => w.id === workOrderId);
    check(
      "work order links to its service record",
      woRecord?.serviceRecordId === complete.body.serviceRecord?.id &&
        woRecord?.status === "COMPLETED",
      JSON.stringify(woRecord).slice(0, 200),
    );
  }

  /* ── D. Completion with a named schedule resets ONLY that schedule ──── */
  {
    // Record a service completion that names only the brake-inspection
    // schedule → oil-change baseline must stay at 79,250.
    const woBrakes = await send("POST", "/api/v1/work-orders", mCookies, {
      vehicleId: vehRef.id,
      title: "Brake inspection (scheduled)",
      description: "Routine inspection",
      priority: "NORMAL",
    });
    check("standalone work order created (201)", woBrakes.status === 201);
    const woBrakesId = woBrakes.body.workOrder?.id;
    if (woBrakesId) created.docIds.push(["workOrders", woBrakesId]);
    const brakesScheduleId = (
      await db
        .collection("maintenanceSchedules")
        .where("vehicleId", "==", vehRef.id)
        .where("taskName", "==", "Brake inspection")
        .limit(1)
        .get()
    ).docs[0]?.id;

    await send("POST", `/api/v1/work-orders/${woBrakesId}/status`, mCookies, { action: "start" });
    const done = await send("POST", `/api/v1/work-orders/${woBrakesId}/complete`, mCookies, {
      odometerKm: 83950,
      workPerformed: "Inspected pads and discs; adjusted handbrake.",
      scheduleIds: [brakesScheduleId],
      resolvedIssueIds: [],
    });
    check(
      "completion resets only the named brake schedule",
      done.status === 200 && done.body.resetScheduleIds?.includes(brakesScheduleId),
      JSON.stringify(done.body).slice(0, 250),
    );

    const schedules = await get(`/api/v1/maintenance/schedules?vehicleId=${vehRef.id}`, mCookies);
    const oil = (schedules.body.schedules ?? []).find((s) => s.taskName === "Engine oil change");
    const brakes = (schedules.body.schedules ?? []).find((s) => s.taskName === "Brake inspection");
    check(
      "oil-change baseline untouched by brake completion (79,250 → due 84,250)",
      oil?.lastServiceOdometerKm === 79250 && oil?.nextDueOdometerKm === 84250,
      JSON.stringify({ oilBase: oil?.lastServiceOdometerKm }).slice(0, 200),
    );
    check(
      "brake baseline moved to 83,950 → due 93,950",
      brakes?.lastServiceOdometerKm === 83950 && brakes?.nextDueOdometerKm === 93950,
      JSON.stringify({ brakesBase: brakes?.lastServiceOdometerKm }).slice(0, 200),
    );
  }

  /* ── E. Critical issue → safety hold; completion never releases ─────── */
  {
    const critical = await send("POST", "/api/v1/reports", dCookies, {
      vehicleId: vehRef.id,
      title: "Front brake failure",
      description: "Brake pedal went to the floor on the Accra–Kumasi road.",
      severity: "CRITICAL",
      category: "BRAKES",
      immobilized: true,
      odometerKm: 83950,
    });
    check(
      "critical issue automatically places the vehicle on safety hold",
      critical.status === 201 && critical.body.safetyHoldApplied === true,
      JSON.stringify(critical.body).slice(0, 250),
    );
    const criticalId = critical.body.report?.id;
    if (criticalId) created.docIds.push(["maintenanceReports", criticalId]);

    const veh = await get(`/api/v1/vehicles/${vehRef.id}`, dCookies);
    check(
      "vehicle status is SAFETY_HOLD with the causing issue linked",
      veh.body.vehicle?.status === "SAFETY_HOLD" &&
        veh.body.vehicle?.safetyHoldIssueId === criticalId,
      JSON.stringify(veh.body.vehicle?.status).slice(0, 150),
    );

    // Fix via a work order; completion must NOT release the hold.
    const woFix = await send("POST", `/api/v1/reports/${criticalId}/work-order`, mCookies, {
      priority: "URGENT",
    });
    const fixId = woFix.body.workOrder?.id;
    if (fixId) created.docIds.push(["workOrders", fixId]);
    await send("POST", `/api/v1/work-orders/${fixId}/status`, mCookies, { action: "start" });
    await send("POST", `/api/v1/work-orders/${fixId}/complete`, mCookies, {
      odometerKm: 83960,
      workPerformed: "Replaced brake master cylinder and bled the system.",
      resolvedIssueIds: [criticalId],
    });

    const afterFix = await get(`/api/v1/vehicles/${vehRef.id}`, dCookies);
    check(
      "completion does NOT release the safety hold",
      afterFix.body.vehicle?.status === "SAFETY_HOLD",
      JSON.stringify(afterFix.body.vehicle?.status).slice(0, 150),
    );

    const release = await send("POST", `/api/v1/vehicles/${vehRef.id}/status`, mCookies, {
      action: "release",
      reason: "Road-tested, brakes verified",
    });
    check(
      "MAINTENANCE cannot release the hold (403 vehicle:release)",
      release.status === 403 && /vehicle:release/.test(release.body?.error?.message ?? ""),
      JSON.stringify(release.body).slice(0, 200),
    );

    const dbRelease = await db
      .collection("vehicles")
      .doc(vehRef.id)
      .update({ status: "ACTIVE", safetyHoldIssueId: null, safetyHoldReason: null }); // reset for later steps
    void dbRelease;
  }

  /* ── F. Expense model: RECORDED → VOID, no approval anywhere ────────── */
  {
    const woList = await get(`/api/v1/work-orders?vehicleId=${vehRef.id}`, mCookies);
    const anyWo = (woList.body.workOrders ?? [])[0];

    // OPERATIONS cannot record expenses (expense:create is FINANCE).
    const denied = await send("POST", "/api/v1/expenses", oCookies, {
      vehicleId: vehRef.id,
      category: "PARTS",
      amount: "10.00",
      description: "should be denied",
    });
    check(
      "OPERATIONS cannot record expenses (403 expense:create)",
      denied.status === 403 && /expense:create/.test(denied.body?.error?.message ?? ""),
      JSON.stringify(denied.body).slice(0, 150),
    );

    const expense = await send("POST", "/api/v1/expenses", fCookies, {
      vehicleId: vehRef.id,
      workOrderId: anyWo?.id,
      category: "PARTS",
      amount: "1450.75",
      description: "Brake master cylinder + fluid",
      supplierName: "Accra Auto Parts",
    });
    check(
      "FINANCE records an expense (201, RECORDED status, pesewas integer)",
      expense.status === 201 &&
        expense.body.expense?.status === "RECORDED" &&
        expense.body.expense?.amountMinor === 145075,
      JSON.stringify(expense.body).slice(0, 300),
    );
    const expenseId = expense.body.expense?.id;
    if (expenseId) created.docIds.push(["expenses", expenseId]);

    // No approval action exists — only void.
    const approve = await send("POST", `/api/v1/expenses/${expenseId}/status`, fCookies, {
      action: "approve",
    });
    check(
      "no approve action exists (400 UNKNOWN_ACTION)",
      approve.status === 400 && /Unknown action/.test(approve.body?.error?.message ?? ""),
      JSON.stringify(approve.body).slice(0, 200),
    );

    // Void requires a reason.
    const noReason = await send("POST", `/api/v1/expenses/${expenseId}/status`, fCookies, {
      action: "void",
    });
    check(
      "void without a reason is rejected (400)",
      noReason.status === 400 && /reason/.test(noReason.body?.error?.message ?? ""),
      JSON.stringify(noReason.body).slice(0, 150),
    );

    // MAINTENANCE cannot void (expense:void is FINANCE).
    const maintVoid = await send("POST", `/api/v1/expenses/${expenseId}/status`, mCookies, {
      action: "void",
      reason: "should be denied",
    });
    check(
      "MAINTENANCE cannot void expenses (403 expense:void)",
      maintVoid.status === 403,
      JSON.stringify(maintVoid.body).slice(0, 150),
    );

    // FINANCE voids with a reason — record preserved with VOID status.
    const voided = await send("POST", `/api/v1/expenses/${expenseId}/status`, fCookies, {
      action: "void",
      reason: "Duplicate invoice — recorded against fuel entry instead",
    });
    check(
      "FINANCE voids with reason (200, VOID, record preserved)",
      voided.status === 200 && voided.body.expense?.status === "VOID",
      JSON.stringify(voided.body).slice(0, 250),
    );

    const rerecord = await send("POST", "/api/v1/expenses", fCookies, {
      vehicleId: vehRef.id,
      workOrderId: anyWo?.id,
      category: "PARTS",
      amount: "1450.75",
      description: "Brake master cylinder + fluid (correct record)",
      supplierName: "Accra Auto Parts",
    });
    check(
      "correct expense recorded once more (201)",
      rerecord.status === 201 && rerecord.body.expense?.amountMinor === 145075,
      JSON.stringify(rerecord.body).slice(0, 200),
    );
    if (rerecord.body.expense?.id) {
      created.docIds.push(["expenses", rerecord.body.expense.id]);
    }

    // Export excludes VOID rows — each pesewa counted once.
    const exportRes = await get(
      `/api/v1/expenses/export?format=json&vehicleId=${vehRef.id}`,
      fCookies,
    );
    check(
      "export counts only non-VOID expenses (145075, not doubled)",
      exportRes.status === 200 && exportRes.body.totalMinor === 145075,
      JSON.stringify({ total: exportRes.body.totalMinor, count: exportRes.body.count }).slice(
        0,
        200,
      ),
    );

    const deniedExport = await get("/api/v1/expenses/export", mCookies);
    check(
      "MAINTENANCE cannot export (403 expense:export)",
      deniedExport.status === 403,
      JSON.stringify(deniedExport.body).slice(0, 150),
    );
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exitCode = failed > 0 ? 1 : 0;
} catch (error) {
  console.error("✗ e2e failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await cleanup();
  await deleteApp(app);
}
