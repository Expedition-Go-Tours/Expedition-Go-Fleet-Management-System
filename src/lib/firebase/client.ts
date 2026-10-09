import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

import { publicEnv } from "@/lib/env";

/**
 * Firebase client SDK. Browser-only, and used **solely** to sign the user in and
 * obtain a short-lived ID token. The application never reads Firestore or
 * Storage directly from the client — all data flows through /api/v1 using the
 * Admin SDK.
 */

let clientApp: FirebaseApp | undefined;
let clientAuth: Auth | undefined;

export function getFirebaseClientApp(): FirebaseApp {
  if (typeof window === "undefined") {
    throw new Error("getFirebaseClientApp() may only be called in the browser.");
  }
  if (!clientApp) {
    clientApp = getApps().length > 0 ? getApp() : initializeApp(publicEnv.firebase);
  }
  return clientApp;
}

export function getFirebaseClientAuth(): Auth {
  if (typeof window === "undefined") {
    throw new Error("getFirebaseClientAuth() may only be called in the browser.");
  }
  if (!clientAuth) {
    clientAuth = getAuth(getFirebaseClientApp());
  }
  return clientAuth;
}
