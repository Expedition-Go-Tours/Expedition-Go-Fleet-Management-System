/**
 * Create or update an admin user. Used for bootstrapping the first
 * administrator before the invite flow exists (or when MFA is not yet
 * configured and an out-of-band account is needed).
 *
 *   node scripts/create-admin.mjs <email> <password> [name]
 */
import { readFileSync } from "node:fs";

import { cert, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const [, , email, password, name] = process.argv;

if (!email || !password) {
  console.error("Usage: node scripts/create-admin.mjs <email> <password> [name]");
  process.exit(1);
}

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

try {
  // Check if user already exists in Firebase Auth
  let uid;
  try {
    const existing = await adminAuth.getUserByEmail(email);
    uid = existing.uid;
    console.log(`User already exists in Firebase Auth (uid: ${uid}), updating password...`);
    await adminAuth.updateUser(uid, { password });
  } catch (e) {
    if (e.code === "auth/user-not-found") {
      const record = await adminAuth.createUser({ email, password, displayName: name || "Admin" });
      uid = record.uid;
      console.log(`Created Firebase Auth user (uid: ${uid})`);
    } else {
      throw e;
    }
  }

  // Use uid as the Firestore document ID (consistent with invite flow).
  const docRef = db.collection("users").doc(uid);
  const existingDoc = await docRef.get();

  if (existingDoc.exists) {
    await docRef.update({
      status: "ACTIVE",
      roles: ["ADMIN"],
      mustChangePassword: false,
      updatedAt: new Date(),
    });
    console.log(`Updated Firestore user doc: ${uid} → ADMIN`);
  } else {
    await docRef.set({
      firebaseUid: uid,
      name: name || "Admin",
      email: email.toLowerCase(),
      status: "ACTIVE",
      roles: ["ADMIN"],
      mustChangePassword: false,
      mfaEnabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    console.log(`Created Firestore user doc: ${uid} → ADMIN`);
  }

  console.log(`\n✓ Admin user ready: ${email}`);
  console.log(`  You can now sign in at http://localhost:3000/sign-in`);
} catch (error) {
  console.error("✗ Failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await deleteApp(app);
}
