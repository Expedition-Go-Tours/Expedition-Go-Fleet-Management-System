/**
 * End-to-end auth smoke test against the live Firebase project.
 * Requires the dev server to be running (npm run dev) and a filled .env.local.
 *
 *   npm run dev &                    # in another terminal
 *   node scripts/e2e-auth.mjs
 *
 * Covers: session establishment, temp-password onboarding (INVITED → password
 * change → ACTIVE), MFA policy, /me, revocation-without-caching, CSRF-protected
 * logout, suspended accounts, and Phase 2 authorization (role gating).
 * Creates and cleans up its own test users.
 */
import { readFileSync } from "node:fs";

import { cert, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const ORIGIN = process.env.E2E_ORIGIN ?? BASE_URL;
const PASSWORD = "Phase1-Test-2424!x";
const NEW_PASSWORD = "Phase2-Test-9876!y";
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

async function getMe(cookies) {
  const res = await fetch(`${BASE_URL}/api/v1/auth/me`, {
    headers: { cookie: cookieHeader(cookies) },
  });
  return { status: res.status, body: await res.json() };
}

async function logout(cookies) {
  const res = await fetch(`${BASE_URL}/api/v1/auth/logout`, {
    method: "POST",
    headers: {
      cookie: cookieHeader(cookies),
      origin: ORIGIN,
      "x-csrf-token": cookies.egt_csrf ?? "",
    },
  });
  return { status: res.status, body: await res.json(), cookies: parseCookies(res) };
}

async function changePassword(cookies, currentPassword, newPassword) {
  const res = await fetch(`${BASE_URL}/api/v1/auth/password`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: cookieHeader(cookies),
      origin: ORIGIN,
      "x-csrf-token": cookies.egt_csrf ?? "",
    },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  return { status: res.status, body: await res.json(), cookies: parseCookies(res) };
}

async function getUsers(cookies) {
  const res = await fetch(`${BASE_URL}/api/v1/users`, {
    headers: { cookie: cookieHeader(cookies) },
  });
  return { status: res.status, body: await res.json() };
}

function cookieHeader(cookies) {
  return Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

async function createUser(email, status, roles, opts = {}) {
  const record = await adminAuth.createUser({ email, password: PASSWORD });
  const uid = record.uid;
  const docId = `e2e-${uid}`;
  await db
    .collection("users")
    .doc(docId)
    .set({
      firebaseUid: uid,
      name: `E2E ${status}`,
      email,
      status,
      roles,
      mustChangePassword: opts.mustChangePassword ?? false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  return { uid, docId, email };
}

async function cleanup(users) {
  for (const user of users) {
    const sessions = await db.collection("sessions").where("userId", "==", user.docId).get();
    await Promise.all(sessions.docs.map((doc) => doc.ref.delete()));
    await db
      .collection("users")
      .doc(user.docId)
      .delete()
      .catch(() => {});
    await adminAuth.deleteUser(user.uid).catch(() => {});
  }
}

const created = [];
try {
  console.log(`\nPhase 2 auth e2e @ ${BASE_URL}\n`);

  const driver = await createUser(`driver.${EMAIL_SUFFIX}@e2e.local`, "ACTIVE", ["DRIVER"]);
  created.push(driver);
  const admin = await createUser(`admin.${EMAIL_SUFFIX}@e2e.local`, "ACTIVE", ["ADMIN"]);
  created.push(admin);
  const invited = await createUser(`invited.${EMAIL_SUFFIX}@e2e.local`, "INVITED", ["DRIVER"], {
    mustChangePassword: true,
  });
  created.push(invited);
  const suspended = await createUser(`suspended.${EMAIL_SUFFIX}@e2e.local`, "SUSPENDED", [
    "DRIVER",
  ]);
  created.push(suspended);

  console.log("  (test users created)");

  // 1. MFA policy for privileged roles (respect the REQUIRE_MFA dev gate).
  const requireMfa = env.REQUIRE_MFA !== "false";
  {
    const idToken = await signInPassword(admin.email);
    const res = await establishSession(idToken);
    if (requireMfa) {
      check(
        "ADMIN without MFA is refused (403 MFA_REQUIRED)",
        res.status === 403 && res.body.error?.code === "MFA_REQUIRED",
        JSON.stringify(res.body),
      );
    } else {
      check(
        "ADMIN session established (REQUIRE_MFA=false dev gate)",
        res.status === 200,
        JSON.stringify(res.body),
      );
    }
  }

  // 2. Active driver establishes a session.
  let driverCookies;
  {
    const idToken = await signInPassword(driver.email);
    const res = await establishSession(idToken);
    driverCookies = res.cookies;
    check(
      "active DRIVER establishes a session (200)",
      res.status === 200 && typeof res.body.csrfToken === "string",
      JSON.stringify(res.body),
    );
  }

  // 3. INVITED user gets a restricted session with passwordChangeRequired.
  let invitedCookies;
  {
    const idToken = await signInPassword(invited.email);
    const res = await establishSession(idToken);
    invitedCookies = res.cookies;
    check(
      "INVITED user gets restricted session (200, passwordChangeRequired)",
      res.status === 200 &&
        res.body.passwordChangeRequired === true &&
        res.body.permissions?.length === 0,
      JSON.stringify(res.body),
    );
  }

  // 4. Restricted session cannot access protected endpoints.
  {
    const res = await getMe(invitedCookies);
    check(
      "/me works for restricted session (200 with passwordChangeRequired)",
      res.status === 200 && res.body.passwordChangeRequired === true,
      JSON.stringify(res.body),
    );

    const usersRes = await getUsers(invitedCookies);
    check(
      "restricted session blocked from /users (403 PASSWORD_CHANGE_REQUIRED)",
      usersRes.status === 403 && usersRes.body.error?.code === "PASSWORD_CHANGE_REQUIRED",
      JSON.stringify(usersRes.body),
    );
  }

  // 5. Password change flow: wrong current password → 403.
  {
    const res = await changePassword(invitedCookies, "WrongPassword123!", NEW_PASSWORD);
    check(
      "password change with wrong current password fails (403)",
      res.status === 403,
      JSON.stringify(res.body),
    );
  }

  // 6. Password change with weak new password → 400.
  {
    const res = await changePassword(invitedCookies, PASSWORD, "weak");
    check(
      "password change with weak new password fails (400)",
      res.status === 400,
      JSON.stringify(res.body),
    );
  }

  // 7. Password change succeeds → account activated.
  {
    const res = await changePassword(invitedCookies, PASSWORD, NEW_PASSWORD);
    check(
      "password change succeeds (200, mustReauthenticate)",
      res.status === 200 &&
        res.body.mustReauthenticate === true &&
        res.body.user?.status === "ACTIVE",
      JSON.stringify(res.body),
    );
  }

  // 8. Old session is revoked after password change.
  {
    const me = await getMe(invitedCookies);
    check("old session revoked after password change (401)", me.status === 401, String(me.status));
  }

  // 9. User can sign in with NEW password after password change.
  {
    const idToken = await signInPassword(invited.email, NEW_PASSWORD);
    const res = await establishSession(idToken);
    check(
      "user signs in with new password (200, no passwordChangeRequired)",
      res.status === 200 &&
        res.body.passwordChangeRequired === false &&
        res.body.user?.status === "ACTIVE",
      JSON.stringify(res.body),
    );
  }

  // 10. /me returns the user and effective permissions for active driver.
  {
    const res = await getMe(driverCookies);
    const permissions = res.body.permissions ?? [];
    check(
      "GET /me returns 200 with user",
      res.status === 200 && res.body.user?.email === driver.email,
    );
    check(
      "driver permissions are correctly scoped",
      permissions.includes("vehicle:read") &&
        permissions.includes("report:read:own") &&
        !permissions.includes("expense:void"),
    );
  }

  // 11. Revocation takes effect on the next request (no caching).
  {
    await db
      .collection("sessions")
      .where("userId", "==", driver.docId)
      .get()
      .then((snap) => Promise.all(snap.docs.map((doc) => doc.ref.delete())));
    const res = await getMe(driverCookies);
    check("revoked session is rejected immediately (401)", res.status === 401, String(res.status));
  }

  // 12. CSRF-protected logout destroys the session + clears cookies.
  {
    const idToken = await signInPassword(driver.email);
    const session = await establishSession(idToken);
    const res = await logout(session.cookies);
    check(
      "logout succeeds (200)",
      res.status === 200 && res.body.ok === true,
      JSON.stringify(res.body),
    );
    const me = await getMe(session.cookies);
    check("session is gone after logout (401)", me.status === 401, String(me.status));
  }

  // 13. Suspended accounts are refused.
  {
    const idToken = await signInPassword(suspended.email);
    const res = await establishSession(idToken);
    check("suspended account is refused (403)", res.status === 403, String(res.status));
  }

  // 14. Phase 2 authorization: DRIVER cannot list users (403 user:read).
  {
    const idToken = await signInPassword(driver.email);
    const session = await establishSession(idToken);
    const res = await getUsers(session.cookies);
    check(
      "DRIVER cannot list users (403 user:read)",
      res.status === 403 && res.body.error?.code === "FORBIDDEN",
      JSON.stringify(res.body),
    );
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exitCode = failed > 0 ? 1 : 0;
} catch (error) {
  console.error("✗ e2e failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await cleanup(created);
  await deleteApp(app);
}
