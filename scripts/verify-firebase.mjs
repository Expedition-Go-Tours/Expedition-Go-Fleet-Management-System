/**
 * Verifies Firebase Admin credentials against the live project.
 * Reads .env.local directly so it can run outside the Next.js runtime.
 *
 *   node scripts/verify-firebase.mjs
 */
import { readFileSync } from "node:fs";

import { cert, initializeApp, deleteApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const envPath = new URL("../.env.local", import.meta.url);
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    }),
);

const projectId = env.FIREBASE_ADMIN_PROJECT_ID;
if (!projectId || !env.FIREBASE_ADMIN_CLIENT_EMAIL || !env.FIREBASE_ADMIN_PRIVATE_KEY) {
  console.error("✗ Firebase Admin credentials are not set in .env.local");
  process.exit(1);
}

const app = initializeApp({
  credential: cert({
    projectId,
    clientEmail: env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
  projectId,
});

try {
  const auth = getAuth(app);
  const users = await auth.listUsers(1);
  console.log(`✓ Auth reachable (project ${projectId}, ${users.users.length} user(s) sampled)`);

  const db = getFirestore(app);
  const ref = db.collection("_health").doc("connectivity");
  await ref.set({ verifiedAt: new Date().toISOString(), ok: true });
  const snap = await ref.get();
  console.log("✓ Firestore read/write reachable:", snap.data());
  await ref.delete();

  console.log("\n✓ Firebase Admin verified.");
} catch (error) {
  console.error("✗ Verification failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await deleteApp(app);
}
