"use strict";

const fs = require("fs");

const path = require("path");

const admin = require("firebase-admin");

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "";

function parseServiceAccount(raw) {
  const trimmed = String(raw).trim();
  const json = trimmed.startsWith("{") ? trimmed : Buffer.from(trimmed, "base64").toString("utf8");
  return JSON.parse(json);
}

function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      return parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } catch (err) {
      throw new Error(`FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON or base64 JSON: ${err.message}`);
    }
  }
  const filePath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (filePath) {
    const resolved = path.isAbsolute(filePath) ? filePath : path.join(__dirname, filePath);
    if (!fs.existsSync(resolved)) {
      console.warn(`[unidral] FIREBASE_SERVICE_ACCOUNT_PATH points at a missing file: ${resolved} - continuing without Firebase`);
      return null;
    }
    return JSON.parse(fs.readFileSync(resolved, "utf8"));
  }
  return null;
}

function buildApp() {
  if (admin.apps.length) return admin.app();
  const serviceAccount = loadServiceAccount();
  const projectId = process.env.FIREBASE_PROJECT_ID || serviceAccount && serviceAccount.project_id || process.env.GCLOUD_PROJECT || (EMULATOR_HOST ? "unidral-local" : "");
  if (!projectId) {
    console.warn("[unidral] Firebase not configured - using in-memory store. " + "Data is lost on restart. Set FIREBASE_PROJECT_ID + credentials for persistence.");
    return null;
  }
  if (serviceAccount) {
    return admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: projectId
    });
  }
  if (EMULATOR_HOST) {
    return admin.initializeApp({
      projectId: projectId
    });
  }
  return admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: projectId
  });
}

const app = buildApp();

const firestore = app ? admin.firestore(app) : null;

const projectId = app ? app.options.projectId : "in-memory";

if (firestore) {
  firestore.settings({
    ignoreUndefinedProperties: true
  });
}

module.exports = {
  firestore: firestore,
  projectId: projectId,
  usingEmulator: Boolean(EMULATOR_HOST),
  inMemory: !firestore
};
