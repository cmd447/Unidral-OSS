"use strict";

const express = require("express");

const {firestore: firestore} = require("../firebase");

const {asyncHandler: asyncHandler} = require("../util");

const {badRequest: badRequest, HttpError: HttpError} = require("../middleware/errorHandler");

const router = express.Router();

const SETTINGS_COLLECTION = process.env.FIRESTORE_SETTINGS_COLLECTION || "settings";

const SETTINGS_DOC = process.env.FIRESTORE_SETTINGS_DOC || "config";

let _engineSettingsCache = null;

let _engineSettingsCacheTime = 0;

async function getEngineSettings() {
  const now = Date.now();
  if (_engineSettingsCache && now - _engineSettingsCacheTime < 3e4) {
    return _engineSettingsCache;
  }
  try {
    if (!firestore) return {};
    const doc = await firestore.collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC).get();
    const data = doc.exists ? doc.data() : {};
    _engineSettingsCache = data;
    _engineSettingsCacheTime = now;
    return data;
  } catch {
    return _engineSettingsCache || {};
  }
}

router.get("/stats", asyncHandler(async (req, res) => {
  const store = require("../db");
  res.json({
    sites: store.stats().sites,
    enabled_rules: store.stats().enabledRules,
    tracked: store.stats().tracked
  });
}));

router.get("/settings", asyncHandler(async (req, res) => {
  if (!firestore) return res.json({
    settings: null
  });
  const doc = await firestore.collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC).get();
  if (!doc.exists) return res.json({
    settings: null
  });
  res.json({
    settings: doc.data()
  });
}));

router.put("/settings", asyncHandler(async (req, res) => {
  if (!firestore) throw new HttpError(503, "Firebase not configured");
  const body = req.body || {};
  const updates = {};
  const now = (new Date).toISOString();
  const brandingFields = [ "brand_name", "brand_logo_url", "brand_colors", "brand_fonts", "brand_favicon_url", "brand_og_image_url", "brand_terms_url", "brand_telegram_handle" ];
  for (const field of brandingFields) {
    if (body[field] !== undefined) updates[field] = body[field];
  }
  if (Object.keys(updates).length === 0) throw badRequest("No settings to update");
  updates.updated_at = now;
  await firestore.collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC).set(updates, {
    merge: true
  });
  res.json({
    ok: true,
    updated: Object.keys(updates)
  });
}));

router.post("/killswitch", asyncHandler(async (req, res) => {
  const store = require("../db");
  const sites = store.getSites();
  let stopped = 0;
  for (const site of sites) {
    if (site.mode !== "stopped") {
      try {
        await store.updateSite(site.id, {
          mode: "stopped"
        });
        stopped++;
      } catch (err) {}
    }
  }
  if (typeof store.clearCache === "function") store.clearCache();
  res.json({
    ok: true,
    stopped: stopped,
    total: sites.length
  });
}));

router.post("/restore-sites", asyncHandler(async (req, res) => {
  const store = require("../db");
  const sites = store.getSites();
  let restored = 0;
  for (const site of sites) {
    if (site.mode === "stopped") {
      try {
        await store.updateSite(site.id, {
          mode: "live"
        });
        restored++;
      } catch (err) {}
    }
  }
  if (typeof store.clearCache === "function") store.clearCache();
  res.json({
    ok: true,
    restored: restored,
    total: sites.length
  });
}));

router.post("/clear-cache", asyncHandler(async (req, res) => {
  const store = require("../db");
  if (typeof store.clearCache === "function") {
    store.clearCache();
  }
  res.json({
    ok: true
  });
}));

router.post("/reload-sites", asyncHandler(async (req, res) => {
  const store = require("../db");
  if (typeof store.reload === "function") {
    await store.reload();
  }
  res.json({
    ok: true,
    count: store.getSites().length
  });
}));

const KNOWN_COLLECTIONS = [ "site_index", "settings", "domains", "domain_logs", "tracked_elements", "rules", "engine_config" ];

router.get("/firebase", asyncHandler(async (req, res) => {
  if (!firestore) return res.json({
    collections: [],
    projectId: "in-memory"
  });
  let collections = [];
  try {
    const list = await firestore.listCollections();
    collections = list.map(c => c.id);
  } catch {
    collections = [ ...KNOWN_COLLECTIONS ];
  }
  const allColls = [ ...new Set([ ...collections, ...KNOWN_COLLECTIONS ]) ];
  const result = [];
  for (const collId of allColls) {
    try {
      const snapshot = await firestore.collection(collId).limit(1e3).get();
      result.push({
        collection: collId,
        count: snapshot.size
      });
    } catch {
      result.push({
        collection: collId,
        count: 0,
        error: true
      });
    }
  }
  result.sort((a, b) => b.count - a.count);
  res.json({
    collections: result,
    projectId: require("../firebase").projectId
  });
}));

router.get("/firebase/:coll", asyncHandler(async (req, res) => {
  if (!firestore) throw new HttpError(503, "Firebase not configured");
  const {coll: coll} = req.params;
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const snapshot = await firestore.collection(coll).limit(limit).get();
  const docs = snapshot.docs.map(doc => ({
    id: doc.id,
    data: doc.data()
  }));
  res.json({
    collection: coll,
    count: snapshot.size,
    docs: docs
  });
}));

router.get("/firebase/:coll/:doc", asyncHandler(async (req, res) => {
  if (!firestore) throw new HttpError(503, "Firebase not configured");
  const {coll: coll, doc: doc} = req.params;
  const snap = await firestore.collection(coll).doc(doc).get();
  if (!snap.exists) throw new HttpError(404, "Document not found");
  res.json({
    id: snap.id,
    data: snap.data()
  });
}));

router.put("/firebase/:coll/:doc", asyncHandler(async (req, res) => {
  if (!firestore) throw new HttpError(503, "Firebase not configured");
  const {coll: coll, doc: doc} = req.params;
  const updates = req.body || {};
  if (Object.keys(updates).length === 0) throw badRequest("No fields to update");
  updates._updated_at = (new Date).toISOString();
  await firestore.collection(coll).doc(doc).set(updates, {
    merge: true
  });
  res.json({
    ok: true,
    id: doc,
    updated: Object.keys(updates)
  });
}));

router.post("/firebase/:coll", asyncHandler(async (req, res) => {
  if (!firestore) throw new HttpError(503, "Firebase not configured");
  const {coll: coll} = req.params;
  const data = req.body || {};
  data._created_at = (new Date).toISOString();
  const docRef = await firestore.collection(coll).add(data);
  res.json({
    ok: true,
    id: docRef.id
  });
}));

router.delete("/firebase/:coll/:doc", asyncHandler(async (req, res) => {
  if (!firestore) throw new HttpError(503, "Firebase not configured");
  const {coll: coll, doc: doc} = req.params;
  await firestore.collection(coll).doc(doc).delete();
  res.json({
    ok: true,
    deleted: doc
  });
}));

router.delete("/firebase/:coll", asyncHandler(async (req, res) => {
  if (!firestore) throw new HttpError(503, "Firebase not configured");
  const {coll: coll} = req.params;
  const snapshot = await firestore.collection(coll).limit(500).get();
  const batch = firestore.batch();
  snapshot.docs.forEach(doc => batch.delete(doc.ref));
  await batch.commit();
  res.json({
    ok: true,
    deleted: snapshot.size,
    collection: coll
  });
}));

module.exports = router;

module.exports.getEngineSettings = getEngineSettings;
