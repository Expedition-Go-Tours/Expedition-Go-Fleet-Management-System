/**
 * Phase 3 fleet-domain E2E against the live Firebase project.
 * Requires the dev server (npm run dev) and a filled .env.local.
 *
 *   npm run dev &
 *   node scripts/e2e-fleet.mjs
 *
 * Covers: vehicle reads + lifecycle transitions (permission-gated), the
 * odometer ledger (PATCH mileage retired), report ownership scoping,
 * report/work-order lifecycles including invalid transitions and
 * evidence-gated completion, expense permission gating, incident ownership
 * scoping + review lifecycle, provider CRUD, and audit access. Uses only
 * non-privileged roles (DRIVER/OPERATIONS/MAINTENANCE) so no MFA is needed;
 * vehicle + expense fixtures are seeded directly via the Admin SDK because
 * vehicle:create / expense:create are ADMIN/FINANCE baselines.
 */
import { readFileSync } from "node:fs";

import { cert, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

import { sweepE2eFixtures } from "./lib/e2e-cleanup.mjs";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const ORIGIN = process.env.E2E_ORIGIN ?? BASE_URL;
const PASSWORD = "Fleet-E2E-2424!x";
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
  const idToken = await signInPassword(email);
  const session = await establishSession(idToken);
  if (session.status !== 200) {
    throw new Error(`login failed: ${JSON.stringify(session.body)}`);
  }
  return session;
}

/** Authenticated GET. */
async function get(path, cookies) {
  const res = await fetch(`${BASE_URL}${path}`, { headers: { cookie: cookieHeader(cookies) } });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** Authenticated state-changing request with CSRF. */
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

async function createUser(email, status, roles) {
  const record = await adminAuth.createUser({ email, password: PASSWORD });
  const uid = record.uid;
  const docId = `e2e-${uid}`;
  await db
    .collection("users")
    .doc(docId)
    .set({
      firebaseUid: uid,
      name: `E2E ${roles[0]}`,
      email,
      status,
      roles,
      mustChangePassword: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  return { uid, docId, email };
}

const created = { users: [], docIds: [] };

async function cleanup() {
  // Remove dependent records (work orders, issues, inspections, readings, join
  // rows, reservations) before the vehicles/users they reference.
  const vehicleIds = created.docIds.filter(([c]) => c === "vehicles").map(([, id]) => id);
  await sweepE2eFixtures(db, { vehicleIds, userIds: created.users.map((u) => u.docId) });

  // Sessions
  for (const user of created.users) {
    const sessions = await db.collection("sessions").where("userId", "==", user.docId).get();
    await Promise.all(sessions.docs.map((d) => d.ref.delete()));
    // Audit rows written by these test users
    const audits = await db.collection("auditLogs").where("actorId", "==", user.docId).get();
    await Promise.all(audits.docs.map((d) => d.ref.delete()));
    await db
      .collection("users")
      .doc(user.docId)
      .delete()
      .catch(() => {});
    await adminAuth.deleteUser(user.uid).catch(() => {});
  }
  // Domain fixtures + API-created entities
  for (const [collection, id] of created.docIds) {
    await db
      .collection(collection)
      .doc(id)
      .delete()
      .catch(() => {});
  }
}

try {
  console.log(`\nPhase 3 fleet e2e @ ${BASE_URL}\n`);

  // ── Users (all non-privileged → no MFA required) ──────────────────────────
  const driverA = await createUser(`drivA.${EMAIL_SUFFIX}@e2e.local`, "ACTIVE", ["DRIVER"]);
  const driverB = await createUser(`drivB.${EMAIL_SUFFIX}@e2e.local`, "ACTIVE", ["DRIVER"]);
  const ops = await createUser(`ops.${EMAIL_SUFFIX}@e2e.local`, "ACTIVE", ["OPERATIONS"]);
  const maint = await createUser(`maint.${EMAIL_SUFFIX}@e2e.local`, "ACTIVE", ["MAINTENANCE"]);
  created.users.push(driverA, driverB, ops, maint);

  // ── Vehicle fixtures (vehicle:create is ADMIN-only) ───────────────────────
  const veh1Ref = db.collection("vehicles").doc("e2e-veh-1");
  await veh1Ref.set({
    regNumber: `E2E-${EMAIL_SUFFIX}-A`,
    make: "Toyota",
    model: "Hiace",
    year: 2021,
    type: "VAN",
    mileage: 12000,
    status: "ACTIVE",
    createdBy: "e2e-setup",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const veh2Ref = db.collection("vehicles").doc("e2e-veh-2");
  await veh2Ref.set({
    regNumber: `E2E-${EMAIL_SUFFIX}-B`,
    make: "Hyundai",
    model: "H1",
    year: 2020,
    type: "VAN",
    mileage: 88000,
    status: "ACTIVE",
    createdBy: "e2e-setup",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  created.docIds.push(["vehicles", "e2e-veh-1"], ["vehicles", "e2e-veh-2"]);

  const [sDriverA, sDriverB, sOps, sMaint] = await Promise.all([
    login(driverA.email),
    login(driverB.email),
    login(ops.email),
    login(maint.email),
  ]);
  console.log("  (users + vehicles ready)\n");

  // ── A. Vehicle reads + permission gating ──────────────────────────────────
  {
    const res = await get("/api/v1/vehicles", sDriverA.cookies);
    check(
      "DRIVER can list vehicles (200)",
      res.status === 200 && Array.isArray(res.body.vehicles) && res.body.vehicles.length >= 2,
      JSON.stringify(res.body).slice(0, 200),
    );

    const create = await send("POST", "/api/v1/vehicles", sMaint.cookies, {
      regNumber: "E2E-X",
      make: "Ford",
      model: "Transit",
      year: 2022,
      type: "VAN",
      mileage: 0,
    });
    check(
      "MAINTENANCE cannot create vehicles (403 vehicle:create)",
      create.status === 403 && create.body?.error?.code === "FORBIDDEN",
      JSON.stringify(create.body),
    );
  }

  // ── B. Odometer ledger (PATCH mileage retired, status via action only) ────
  {
    const back = await send("PATCH", "/api/v1/vehicles/e2e-veh-1", sMaint.cookies, {
      mileage: 5,
    });
    check(
      "PATCH mileage is rejected (400, ledger endpoint only)",
      back.status === 400 && /odometer/i.test(back.body?.error?.message ?? ""),
      JSON.stringify(back.body),
    );

    const statusPatch = await send("PATCH", "/api/v1/vehicles/e2e-veh-1", sMaint.cookies, {
      status: "ARCHIVED",
    });
    check(
      "PATCH cannot change status (400, action endpoints only)",
      statusPatch.status === 400 && /status/i.test(statusPatch.body?.error?.message ?? ""),
      JSON.stringify(statusPatch.body),
    );

    const record = await send("POST", "/api/v1/vehicles/e2e-veh-1/odometer", sMaint.cookies, {
      km: 15000,
      source: "MANUAL_ENTRY",
      notes: "e2e ledger record",
    });
    check(
      "MAINTENANCE records an odometer reading (201 → projection 15000)",
      record.status === 201 &&
        record.body?.reading?.km === 15000 &&
        record.body?.currentOdometerKm === 15000,
      JSON.stringify(record.body).slice(0, 200),
    );

    const decrease = await send("POST", "/api/v1/vehicles/e2e-veh-1/odometer", sMaint.cookies, {
      km: 14000,
      source: "MANUAL_ENTRY",
    });
    check(
      "ledger rejects a decreasing reading (409 DECREASE_REJECTED)",
      decrease.status === 409 && decrease.body?.error?.code === "DECREASE_REJECTED",
      JSON.stringify(decrease.body),
    );
  }

  // ── C. Safety-hold invariant (maintenance can hold, never release) ────────
  {
    const hold = await send("POST", "/api/v1/vehicles/e2e-veh-1/status", sMaint.cookies, {
      action: "safety_hold",
      reason: "brake wear observed",
    });
    check(
      "MAINTENANCE can place a safety hold (200)",
      hold.status === 200 &&
        hold.body?.vehicle?.status === "SAFETY_HOLD" &&
        hold.body?.vehicle?.safetyHoldReason === "brake wear observed",
      JSON.stringify(hold.body).slice(0, 250),
    );

    const release = await send("POST", "/api/v1/vehicles/e2e-veh-1/status", sMaint.cookies, {
      action: "release",
    });
    check(
      "MAINTENANCE cannot release a safety hold (403 vehicle:release)",
      release.status === 403 && /vehicle:release/.test(release.body?.error?.message ?? ""),
      JSON.stringify(release.body),
    );

    const wrongState = await send("POST", "/api/v1/vehicles/e2e-veh-1/status", sMaint.cookies, {
      action: "return_to_service",
    });
    check(
      "invalid state transition is 409 (held ≠ in_service)",
      wrongState.status === 409 && /SAFETY_HOLD/.test(wrongState.body?.error?.message ?? ""),
      JSON.stringify(wrongState.body),
    );

    const archive = await send("POST", "/api/v1/vehicles/e2e-veh-1/status", sMaint.cookies, {
      action: "archive",
    });
    check(
      "MAINTENANCE cannot archive (403 vehicle:archive)",
      archive.status === 403 && /vehicle:archive/.test(archive.body?.error?.message ?? ""),
      JSON.stringify(archive.body),
    );

    // Workshop roundtrip on veh-2 (ACTIVE → IN_SERVICE → ACTIVE)
    const sendWs = await send("POST", "/api/v1/vehicles/e2e-veh-2/status", sMaint.cookies, {
      action: "send_to_workshop",
    });
    check(
      "send_to_workshop (200 → IN_SERVICE)",
      sendWs.status === 200 && sendWs.body?.vehicle?.status === "IN_SERVICE",
      JSON.stringify(sendWs.body).slice(0, 200),
    );
    const ret = await send("POST", "/api/v1/vehicles/e2e-veh-2/status", sMaint.cookies, {
      action: "return_to_service",
    });
    check(
      "return_to_service (200 → ACTIVE)",
      ret.status === 200 && ret.body?.vehicle?.status === "ACTIVE",
      JSON.stringify(ret.body).slice(0, 200),
    );
  }

  // ── D. Reports: create, ownership scoping, triage, close ─────────────────
  let reportA, reportB;
  {
    const createdA = await send("POST", "/api/v1/reports", sDriverA.cookies, {
      vehicleId: "e2e-veh-1",
      title: "Brake noise on deceleration",
      description: "Grinding noise from front axle when braking.",
      severity: "HIGH",
    });
    check(
      "DRIVER can create a report (201)",
      createdA.status === 201 && createdA.body?.report?.status === "OPEN",
      JSON.stringify(createdA.body).slice(0, 250),
    );
    reportA = createdA.body?.report;

    const createdB = await send("POST", "/api/v1/reports", sDriverB.cookies, {
      vehicleId: "e2e-veh-2",
      title: "Interior light broken",
      description: "Dome light does not switch on.",
      severity: "LOW",
    });
    check(
      "second DRIVER report created (201)",
      createdB.status === 201 && createdB.body?.report?.id,
      JSON.stringify(createdB.body).slice(0, 200),
    );
    reportB = createdB.body?.report;
    if (reportA) created.docIds.push(["maintenanceReports", reportA.id]);
    if (reportB) created.docIds.push(["maintenanceReports", reportB.id]);

    const listOwn = await get("/api/v1/reports", sDriverA.cookies);
    const ownIds = (listOwn.body?.reports ?? []).map((r) => r.id);
    check(
      "DRIVER list is scoped to own reports only",
      listOwn.status === 200 &&
        reportA &&
        ownIds.includes(reportA.id) &&
        reportB &&
        !ownIds.includes(reportB.id),
      JSON.stringify(ownIds),
    );

    const crossRead = await get(`/api/v1/reports/${reportB.id}`, sDriverA.cookies);
    check(
      "DRIVER cannot read another driver's report (403)",
      crossRead.status === 403,
      JSON.stringify(crossRead.body),
    );

    const opsList = await get("/api/v1/reports", sOps.cookies);
    const opsIds = (opsList.body?.reports ?? []).map((r) => r.id);
    check(
      "OPERATIONS sees all reports (report:read:all)",
      opsList.status === 200 &&
        reportA &&
        reportB &&
        opsIds.includes(reportA.id) &&
        opsIds.includes(reportB.id),
      JSON.stringify(opsIds).slice(0, 200),
    );

    const triage = await send("POST", `/api/v1/reports/${reportA.id}/status`, sOps.cookies, {
      action: "triage",
    });
    check(
      "OPERATIONS triages report (200 → TRIAGED)",
      triage.status === 200 && triage.body?.report?.status === "TRIAGED",
      JSON.stringify(triage.body).slice(0, 250),
    );

    const retriage = await send("POST", `/api/v1/reports/${reportA.id}/status`, sOps.cookies, {
      action: "triage",
    });
    check(
      "double triage is 409 (OPEN only)",
      retriage.status === 409 && /TRIAGED/.test(retriage.body?.error?.message ?? ""),
      JSON.stringify(retriage.body),
    );

    const opsClose = await send("POST", `/api/v1/reports/${reportB.id}/status`, sOps.cookies, {
      action: "close",
    });
    check(
      "OPERATIONS cannot close reports (403 report:close)",
      opsClose.status === 403 && /report:close/.test(opsClose.body?.error?.message ?? ""),
      JSON.stringify(opsClose.body),
    );

    const noResolution = await send(
      "POST",
      `/api/v1/reports/${reportA.id}/status`,
      sMaint.cookies,
      {
        action: "close",
      },
    );
    check(
      "closing without resolution/duplicate is 400 (accountability)",
      noResolution.status === 400 && /resolution/i.test(noResolution.body?.error?.message ?? ""),
      JSON.stringify(noResolution.body),
    );

    const maintClose = await send("POST", `/api/v1/reports/${reportB.id}/status`, sMaint.cookies, {
      action: "close",
      resolution: "Inspected — no fault found; interior light replaced by driver.",
    });
    check(
      "MAINTENANCE closes report from OPEN with resolution (200 → CLOSED)",
      maintClose.status === 200 && maintClose.body?.report?.status === "CLOSED",
      JSON.stringify(maintClose.body).slice(0, 250),
    );

    const closeAgain = await send("POST", `/api/v1/reports/${reportB.id}/status`, sMaint.cookies, {
      action: "close",
      resolution: "Already closed.",
    });
    check(
      "closing a closed report is 409",
      closeAgain.status === 409,
      JSON.stringify(closeAgain.body),
    );
  }

  // ── E. Work orders: create from report, full pipeline + guards ───────────
  let workOrder;
  {
    const opsCreate = await send("POST", "/api/v1/work-orders", sOps.cookies, {
      vehicleId: "e2e-veh-1",
      title: "Ops WO attempt",
      description: "should be denied",
    });
    check(
      "OPERATIONS cannot create work orders (403 work_order:create)",
      opsCreate.status === 403 && /work_order:create/.test(opsCreate.body?.error?.message ?? ""),
      JSON.stringify(opsCreate.body),
    );

    const maintCreate = await send(
      "POST",
      `/api/v1/reports/${reportA.id}/work-order`,
      sMaint.cookies,
      { priority: "URGENT", description: "Front brake pads + disc inspection" },
    );
    check(
      "MAINTENANCE creates work order from report (201)",
      maintCreate.status === 201 && maintCreate.body?.workOrder?.status === "OPEN",
      JSON.stringify(maintCreate.body).slice(0, 300),
    );
    workOrder = maintCreate.body?.workOrder;
    if (workOrder) created.docIds.push(["workOrders", workOrder.id]);

    const dup = await send("POST", `/api/v1/reports/${reportA.id}/work-order`, sMaint.cookies, {
      priority: "NORMAL",
    });
    check("second work order for same report is 409", dup.status === 409, JSON.stringify(dup.body));

    const driverStart = await send(
      "POST",
      `/api/v1/work-orders/${workOrder.id}/status`,
      sDriverA.cookies,
      { action: "start" },
    );
    check(
      "DRIVER cannot act on work orders (403)",
      driverStart.status === 403,
      JSON.stringify(driverStart.body),
    );

    const start = await send("POST", `/api/v1/work-orders/${workOrder.id}/status`, sMaint.cookies, {
      action: "start",
    });
    check(
      "start (200 → IN_PROGRESS)",
      start.status === 200 && start.body?.workOrder?.status === "IN_PROGRESS",
      JSON.stringify(start.body).slice(0, 200),
    );

    const completeEarly = await send(
      "POST",
      `/api/v1/work-orders/${workOrder.id}/status`,
      sMaint.cookies,
      { action: "close" },
    );
    check(
      "cannot close from IN_PROGRESS (409, pipeline enforced)",
      completeEarly.status === 409 && /IN_PROGRESS/.test(completeEarly.body?.error?.message ?? ""),
      JSON.stringify(completeEarly.body),
    );

    const complete = await send(
      "POST",
      `/api/v1/work-orders/${workOrder.id}/complete`,
      sMaint.cookies,
      {
        workPerformed: "Replaced front brake pads; inspected discs for wear.",
        odometerKm: 15050,
        providerName: "E2E Garage",
      },
    );
    check(
      "complete with evidence (200 → COMPLETED, service record created)",
      complete.status === 200 &&
        complete.body?.serviceRecord?.workOrderId === workOrder.id &&
        complete.body?.duplicate === false,
      JSON.stringify(complete.body).slice(0, 250),
    );

    const replay = await send(
      "POST",
      `/api/v1/work-orders/${workOrder.id}/complete`,
      sMaint.cookies,
      { workPerformed: "Replaced front brake pads; inspected discs for wear.", odometerKm: 15050 },
    );
    check(
      "completion replay is idempotent (duplicate: true)",
      replay.status === 200 && replay.body?.duplicate === true,
      JSON.stringify(replay.body).slice(0, 250),
    );

    const close = await send("POST", `/api/v1/work-orders/${workOrder.id}/status`, sMaint.cookies, {
      action: "close",
    });
    check(
      "close (200 → CLOSED)",
      close.status === 200 && close.body?.workOrder?.status === "CLOSED",
      JSON.stringify(close.body).slice(0, 200),
    );

    const reopen = await send(
      "POST",
      `/api/v1/work-orders/${workOrder.id}/status`,
      sMaint.cookies,
      { action: "reopen" },
    );
    check(
      "reopen (200 → OPEN, evidence cleared from WO)",
      reopen.status === 200 &&
        reopen.body?.workOrder?.status === "OPEN" &&
        !reopen.body?.workOrder?.closedAt &&
        !reopen.body?.workOrder?.serviceRecordId,
      JSON.stringify(reopen.body).slice(0, 250),
    );

    const completeFromOpen = await send(
      "POST",
      `/api/v1/work-orders/${workOrder.id}/complete`,
      sMaint.cookies,
      { workPerformed: "Re-diagnosed after reopening — no further action.", odometerKm: 15060 },
    );
    check(
      "completion from OPEN is allowed (200 → COMPLETED)",
      completeFromOpen.status === 200 && completeFromOpen.body?.duplicate === false,
      JSON.stringify(completeFromOpen.body).slice(0, 250),
    );
  }

  // ── F. Expenses: permission gating + read (lifecycle needs FINANCE/MFA) ──
  {
    const expenseFixture = await db.collection("expenses").add({
      workOrderId: workOrder.id,
      vehicleId: "e2e-veh-1",
      category: "PARTS",
      amountMinor: 45500,
      currency: "GHS",
      description: "Front brake pads",
      status: "RECORDED",
      createdBy: "e2e-setup",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    created.docIds.push(["expenses", expenseFixture.id]);

    const read = await get("/api/v1/expenses", sMaint.cookies);
    const expenseIds = (read.body?.expenses ?? []).map((e) => e.id);
    check(
      "MAINTENANCE can read expenses (200, includes fixture)",
      read.status === 200 && expenseIds.includes(expenseFixture.id),
      JSON.stringify(read.body).slice(0, 250),
    );

    const create = await send("POST", "/api/v1/expenses", sMaint.cookies, {
      workOrderId: workOrder.id,
      category: "FUEL",
      amount: 250.5,
      description: "fuel for workshop run",
    });
    check(
      "MAINTENANCE cannot create expenses (403 expense:create)",
      create.status === 403 && /expense:create/.test(create.body?.error?.message ?? ""),
      JSON.stringify(create.body),
    );

    const voidAttempt = await send(
      "POST",
      `/api/v1/expenses/${expenseFixture.id}/status`,
      sMaint.cookies,
      { action: "void", reason: "should be denied to MAINTENANCE" },
    );
    check(
      "MAINTENANCE cannot void expenses (403 expense:void)",
      voidAttempt.status === 403 && /expense:void/.test(voidAttempt.body?.error?.message ?? ""),
      JSON.stringify(voidAttempt.body),
    );

    const exportRes = await get("/api/v1/expenses/export", sMaint.cookies);
    check(
      "MAINTENANCE cannot export (403 expense:export)",
      exportRes.status === 403 && /expense:export/.test(exportRes.body?.error?.message ?? ""),
      JSON.stringify(exportRes.body),
    );
  }

  // ── G. Providers: MAINTENANCE baseline allows full CRUD ─────────────────
  let provider;
  {
    const createdRes = await send("POST", "/api/v1/providers", sMaint.cookies, {
      name: `E2E Garage ${EMAIL_SUFFIX}`,
      phone: "+233200000000",
      specialties: ["mechanical", "tyres"],
    });
    check(
      "MAINTENANCE can create a provider (201)",
      createdRes.status === 201 && createdRes.body?.provider?.active === true,
      JSON.stringify(createdRes.body).slice(0, 250),
    );
    provider = createdRes.body?.provider;
    if (provider) created.docIds.push(["providers", provider.id]);

    const list = await get("/api/v1/providers?activeOnly=true", sMaint.cookies);
    check(
      "MAINTENANCE can read providers (200)",
      list.status === 200 && Array.isArray(list.body?.providers),
      JSON.stringify(list.body).slice(0, 150),
    );

    const badEmail = await send("PATCH", `/api/v1/providers/${provider.id}`, sMaint.cookies, {
      email: "not-an-email",
    });
    check(
      "provider invalid email rejected (400)",
      badEmail.status === 400,
      JSON.stringify(badEmail.body),
    );

    const patch = await send("PATCH", `/api/v1/providers/${provider.id}`, sMaint.cookies, {
      contactName: "Kwame Mensah",
      active: false,
    });
    check(
      "provider updated + deactivated (200)",
      patch.status === 200 &&
        patch.body?.provider?.contactName === "Kwame Mensah" &&
        patch.body?.provider?.active === false,
      JSON.stringify(patch.body).slice(0, 250),
    );

    const inactive = await get("/api/v1/providers?activeOnly=true", sMaint.cookies);
    const ids = (inactive.body?.providers ?? []).map((p) => p.id);
    check(
      "inactive provider hidden from activeOnly list",
      inactive.status === 200 && !ids.includes(provider.id),
      JSON.stringify(ids).slice(0, 150),
    );

    const driverCreate = await send("POST", "/api/v1/providers", sDriverA.cookies, {
      name: "Driver attempt",
      phone: "+233200000001",
    });
    check(
      "DRIVER cannot create providers (403 provider:create)",
      driverCreate.status === 403,
      JSON.stringify(driverCreate.body),
    );

    const driverRead = await get("/api/v1/providers", sDriverA.cookies);
    check(
      "DRIVER cannot read providers (403 provider:read)",
      driverRead.status === 403,
      JSON.stringify(driverRead.body),
    );
  }

  // ── H. Audit trail ───────────────────────────────────────────────────────
  {
    const res = await get("/api/v1/audit?limit=200", sMaint.cookies);
    const types = new Set((res.body?.entries ?? []).map((e) => e.eventType));
    check(
      "MAINTENANCE can read the audit log (200, has domain events)",
      res.status === 200 &&
        types.has("vehicle.status.changed") &&
        types.has("report.status.changed"),
      JSON.stringify([...types]).slice(0, 300),
    );

    const denial = await get("/api/v1/audit", sDriverA.cookies);
    check(
      "DRIVER cannot read the audit log (403 audit:read)",
      denial.status === 403 && /audit:read/.test(denial.body?.error?.message ?? ""),
      JSON.stringify(denial.body),
    );
  }

  // ── I. Incidents: create, ownership scoping, restricted review lifecycle ─
  let incidentId;
  {
    const createdInc = await send("POST", "/api/v1/incidents", sDriverA.cookies, {
      vehicleId: "e2e-veh-1",
      type: "BREAKDOWN",
      severity: "HIGH",
      location: "Spintex, Accra",
      description: "Smoke from engine bay after highway run.",
    });
    check(
      "DRIVER can report an incident (201 → OPEN)",
      createdInc.status === 201 && createdInc.body?.incident?.status === "OPEN",
      JSON.stringify(createdInc.body).slice(0, 250),
    );
    incidentId = createdInc.body?.incident?.id;
    if (incidentId) created.docIds.push(["incidentReports", incidentId]);

    const createdIncB = await send("POST", "/api/v1/incidents", sDriverB.cookies, {
      vehicleId: "e2e-veh-2",
      type: "PASSENGER",
      severity: "LOW",
      description: "Passenger complained about rattling window.",
    });
    check(
      "second DRIVER incident created (201)",
      createdIncB.status === 201 && createdIncB.body?.incident?.id,
      JSON.stringify(createdIncB.body).slice(0, 200),
    );
    if (createdIncB.body?.incident?.id) {
      created.docIds.push(["incidentReports", createdIncB.body.incident.id]);
    }

    const driverList = await get("/api/v1/incidents", sDriverA.cookies);
    const driverIncidentIds = (driverList.body?.incidents ?? []).map((i) => i.id);
    check(
      "DRIVER incident list is scoped to own reports",
      driverList.status === 200 &&
        incidentId &&
        driverIncidentIds.includes(incidentId) &&
        createdIncB.body?.incident?.id &&
        !driverIncidentIds.includes(createdIncB.body.incident.id),
      JSON.stringify(driverIncidentIds),
    );

    const driverResolve = await send(
      "POST",
      `/api/v1/incidents/${incidentId}/status`,
      sDriverA.cookies,
      { action: "resolve", resolution: "should be denied" },
    );
    check(
      "DRIVER cannot resolve incidents (403 incident:manage)",
      driverResolve.status === 403 &&
        /incident:manage/.test(driverResolve.body?.error?.message ?? ""),
      JSON.stringify(driverResolve.body),
    );

    const opsList = await get("/api/v1/incidents", sOps.cookies);
    const opsIncidentIds = (opsList.body?.incidents ?? []).map((i) => i.id);
    check(
      "OPERATIONS sees all incidents (incident:read:all)",
      opsList.status === 200 &&
        incidentId &&
        opsIncidentIds.includes(incidentId) &&
        opsIncidentIds.includes(createdIncB.body?.incident?.id),
      JSON.stringify(opsIncidentIds).slice(0, 250),
    );

    const noResolution = await send(
      "POST",
      `/api/v1/incidents/${incidentId}/status`,
      sOps.cookies,
      { action: "resolve" },
    );
    check(
      "resolving without a resolution note is 400 (accountability)",
      noResolution.status === 400 && /resolution/i.test(noResolution.body?.error?.message ?? ""),
      JSON.stringify(noResolution.body),
    );

    const resolve = await send("POST", `/api/v1/incidents/${incidentId}/status`, sOps.cookies, {
      action: "resolve",
      resolution: "Towed to garage; alternator replaced.",
    });
    check(
      "OPERATIONS resolves with resolution (200 → RESOLVED)",
      resolve.status === 200 &&
        resolve.body?.incident?.status === "RESOLVED" &&
        resolve.body?.incident?.resolution,
      JSON.stringify(resolve.body).slice(0, 250),
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
