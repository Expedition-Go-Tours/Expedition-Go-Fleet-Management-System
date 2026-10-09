import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { serverEnv } from "@/lib/env";

/**
 * Firebase Admin SDK singleton. Server-only — never import this from a client
 * component. Initialization is lazy so that unrelated routes do not require
 * credentials at import time.
 */

let adminApp: App | undefined;

export function getAdminApp(): App {
  if (adminApp) return adminApp;

  const existing = getApps();
  if (existing.length > 0) {
    adminApp = existing[0]!;
    return adminApp;
  }

  const { projectId, clientEmail, privateKey } = serverEnv.firebaseAdmin;
  adminApp = initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
    projectId,
  });
  return adminApp;
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

export function getAdminDb(): Firestore {
  return getFirestore(getAdminApp());
}
