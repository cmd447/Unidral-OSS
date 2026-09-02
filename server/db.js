"use strict";

const crypto = require("crypto");

const {EventEmitter: EventEmitter} = require("events");

const {firestore: firestore, projectId: projectId, usingEmulator: usingEmulator, inMemory: inMemory} = require("./firebase");

const SITE_INDEX_COLLECTION = process.env.FIRESTORE_SITE_INDEX_COLLECTION || "site_index";

const SITES_COLLECTION = process.env.FIRESTORE_SITES_COLLECTION || "sites";

const RULES_COLLECTION = process.env.FIRESTORE_RULES_COLLECTION || "rules";

const TRACKED_COLLECTION = process.env.FIRESTORE_TRACKED_COLLECTION || "tracked_elements";

const siteIndexRef = firestore ? firestore.collection(SITE_INDEX_COLLECTION) : null;

const sitesRef = firestore ? firestore.collection(SITES_COLLECTION) : null;

const rulesRef = firestore ? firestore.collection(RULES_COLLECTION) : null;

const trackedRef = firestore ? firestore.collection(TRACKED_COLLECTION) : null;

const sitesById = new Map;

const sitesBySubdomain = new Map;

const enabledRulesBySite = new Map;

const trackedBySite = new Map;

const memRules = new Map;

const memTracked = new Map;

const events = new EventEmitter;

events.setMaxListeners(0);

let sitesReady = false;

let resolveReady;

const readyPromise = new Promise(resolve => {
  resolveReady = resolve;
});

function markReady() {
  sitesReady = true;
  resolveReady();
}

function nowIso() {
  return (new Date).toISOString().replace("T", " ").slice(0, 19);
}

function normalizeSubdomainList(value) {
  if (!Array.isArray(value)) return [];
  const clean = [];
  for (const entry of value) {
    const prefix = String(entry || "").trim().toLowerCase().replace(/^\.+|\.+$/g, "");
    if (!prefix || prefix.length > 100) continue;
    if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(prefix)) continue;
    if (!clean.includes(prefix)) clean.push(prefix);
  }
  return clean.slice(0, 200);
}

function normalizeSite(id, data) {
  let mode = data.mode === undefined ? null : String(data.mode).toLowerCase();
  if (mode !== "dev" && mode !== "live") mode = null;
  if (!mode) mode = data.live === false ? "live" : "dev";
  let cspMode = data.csp_mode === undefined ? null : String(data.csp_mode).toLowerCase();
  if (cspMode !== "strip" && cspMode !== "rewrite" && cspMode !== "keep") cspMode = null;
  if (!cspMode) cspMode = "strip";
  return {
    id: id,
    target_url: data.target_url || "",
    subdomain: String(data.subdomain || "").toLowerCase(),
    base_domain: data.base_domain ? String(data.base_domain).toLowerCase() : null,
    wildcard: Boolean(data.wildcard),
    mode: mode,
    live: mode === "dev",
    label: data.label == null ? null : data.label,
    notes: data.notes == null ? null : String(data.notes).slice(0, 4e3),
    custom_js: data.custom_js == null ? null : String(data.custom_js).slice(0, 102400),
    csp_mode: cspMode,
    waf_bypass: data.waf_bypass && typeof data.waf_bypass === "string" ? data.waf_bypass : "none",
    custom_css: data.custom_css == null ? null : String(data.custom_css).slice(0, 102400),
    block_ads: data.block_ads === true,
    text_replacements: Array.isArray(data.text_replacements) ? data.text_replacements.filter(r => r && typeof r.find === "string").map(r => ({
      find: String(r.find).slice(0, 1e3),
      replace: String(r.replace || "").slice(0, 1e3),
      regex: r.regex === true
    })).slice(0, 100) : [],
    dom_overrides: Array.isArray(data.dom_overrides) ? data.dom_overrides.filter(r => r && typeof r.selector === "string").map(r => ({
      id: String(r.id || crypto.randomUUID()),
      selector: String(r.selector).slice(0, 500),
      action: String(r.action || "remove").slice(0, 20),
      value: r.value == null ? "" : String(r.value).slice(0, 102400),
      path_pattern: String(r.path_pattern || "*").slice(0, 200),
      enabled: r.enabled !== false
    })).slice(0, 200) : [],
    css_overrides: Array.isArray(data.css_overrides) ? data.css_overrides.filter(r => r && typeof r.selector === "string").map(r => ({
      id: String(r.id || crypto.randomUUID()),
      selector: String(r.selector).slice(0, 500),
      property: String(r.property || "").slice(0, 100),
      value: String(r.value || "").slice(0, 102400),
      path_pattern: String(r.path_pattern || "*").slice(0, 200),
      enabled: r.enabled !== false
    })).slice(0, 200) : [],
    js_overrides: Array.isArray(data.js_overrides) ? data.js_overrides.filter(r => r && typeof r.code === "string").map(r => ({
      id: String(r.id || crypto.randomUUID()),
      code: String(r.code).slice(0, 102400),
      path_pattern: String(r.path_pattern || "*").slice(0, 200),
      conditions: r.conditions || null,
      enabled: r.enabled !== false
    })).slice(0, 50) : [],
    image_overrides: Array.isArray(data.image_overrides) ? data.image_overrides.filter(r => r && typeof r.original_src === "string").map(r => ({
      id: String(r.id || crypto.randomUUID()),
      original_src: String(r.original_src).slice(0, 2048),
      original_selector: String(r.original_selector || "").slice(0, 500),
      new_src: String(r.new_src || "").slice(0, 2048),
      width: r.width || null,
      height: r.height || null,
      path_pattern: String(r.path_pattern || "*").slice(0, 200),
      enabled: r.enabled !== false
    })).slice(0, 200) : [],
    response_header_rules: Array.isArray(data.response_header_rules) ? data.response_header_rules.filter(r => r && typeof r.header === "string").map(r => ({
      id: String(r.id || crypto.randomUUID()),
      header: String(r.header).slice(0, 200),
      action: String(r.action || "set").slice(0, 20),
      value: String(r.value || "").slice(0, 4096),
      path_pattern: String(r.path_pattern || "*").slice(0, 200),
      enabled: r.enabled !== false
    })).slice(0, 100) : [],
    request_header_rules: Array.isArray(data.request_header_rules) ? data.request_header_rules.filter(r => r && typeof r.header === "string").map(r => ({
      id: String(r.id || crypto.randomUUID()),
      header: String(r.header).slice(0, 200),
      action: String(r.action || "set").slice(0, 20),
      value: String(r.value || "").slice(0, 4096),
      path_pattern: String(r.path_pattern || "*").slice(0, 200),
      enabled: r.enabled !== false
    })).slice(0, 100) : [],
    path_rules: Array.isArray(data.path_rules) ? data.path_rules.filter(r => r && typeof r.path_pattern === "string").map(r => ({
      id: String(r.id || crypto.randomUUID()),
      path_pattern: String(r.path_pattern).slice(0, 500),
      action: String(r.action || "block").slice(0, 20),
      redirect_url: String(r.redirect_url || "").slice(0, 2048),
      response_body: String(r.response_body || "").slice(0, 10240),
      response_status: r.response_status || 404,
      enabled: r.enabled !== false
    })).slice(0, 100) : [],
    cookie_rules: Array.isArray(data.cookie_rules) ? data.cookie_rules.filter(r => r && typeof r.name === "string").map(r => ({
      id: String(r.id || crypto.randomUUID()),
      name: String(r.name).slice(0, 200),
      action: String(r.action || "set").slice(0, 20),
      value: String(r.value || "").slice(0, 4096),
      domain: String(r.domain || "").slice(0, 200),
      path: String(r.path || "/").slice(0, 200),
      path_pattern: String(r.path_pattern || "*").slice(0, 200),
      enabled: r.enabled !== false
    })).slice(0, 100) : [],
    modify_non_html: data.modify_non_html === true,
    subdomains: normalizeSubdomainList(data.subdomains),
    subdomains_detected_at: data.subdomains_detected_at || null,
    inject_orig_domain: data.inject_orig_domain === true,
    geo_bypass: data.geo_bypass === true,
    egress_mode: typeof data.egress_mode === "string" && [ "direct", "warp", "workers" ].includes(data.egress_mode) ? data.egress_mode : "direct",
    workers_url: data.workers_url == null ? "" : String(data.workers_url).slice(0, 500),
    frozen: data.frozen === true,
    created_at: data.created_at || nowIso(),
    updated_at: data.updated_at || data.created_at || nowIso()
  };
}

function normalizeRule(id, data) {
  let behavior = data.behavior === undefined ? null : String(data.behavior).toLowerCase();
  if (behavior !== "augment" && behavior !== "override") behavior = "augment";
  let codeType = String(data.code_type || "js").toLowerCase();
  if (codeType !== "js" && codeType !== "html") codeType = "js";
  return {
    id: id,
    site_id: data.site_id || null,
    page_path: data.page_path || "*",
    selector: data.selector || "",
    trigger: data.trigger || "click",
    event_name: data.event_name === undefined ? null : data.event_name,
    code: data.code || "",
    code_type: codeType,
    behavior: behavior,
    fingerprint: data.fingerprint || null,
    enabled: data.enabled === undefined ? true : Boolean(data.enabled),
    created_at: data.created_at || nowIso(),
    updated_at: data.updated_at || data.created_at || nowIso()
  };
}

function normalizeTracked(id, data) {
  const foundOn = {};
  if (data.found_on && typeof data.found_on === "object") {
    for (const [key, val] of Object.entries(data.found_on)) {
      if (val && typeof val === "object") {
        foundOn[key] = {
          path: String(val.path || ""),
          prefix: String(val.prefix || ""),
          foundAt: val.foundAt || nowIso()
        };
      }
    }
  }
  return {
    id: id,
    site_id: data.site_id || null,
    label: data.label || null,
    selector: data.selector || "",
    fingerprint: data.fingerprint || null,
    origin_path: data.origin_path || "*",
    origin_prefix: data.origin_prefix || "",
    rule_ids: Array.isArray(data.rule_ids) ? data.rule_ids : [],
    found_on: foundOn,
    created_at: data.created_at || nowIso(),
    updated_at: data.updated_at || data.created_at || nowIso()
  };
}

function indexSites() {
  sitesBySubdomain.clear();
  for (const site of sitesById.values()) {
    if (site.subdomain) {
      if (!sitesBySubdomain.has(site.subdomain)) {
        sitesBySubdomain.set(site.subdomain, site);
      }
      const bd = (site.base_domain || "").toLowerCase();
      if (bd) sitesBySubdomain.set(`${site.subdomain}@${bd}`, site);
    }
  }
}

function indexEnabledRules(siteId, rulesArray) {
  const map = new Map;
  if (Array.isArray(rulesArray)) {
    for (const r of rulesArray) {
      const rule = normalizeRule(r.id || crypto.randomUUID(), r);
      if (rule.enabled) map.set(rule.id, rule);
    }
  }
  enabledRulesBySite.set(siteId, map);
}

function indexTracked(siteId, trackedArray) {
  const map = new Map;
  if (Array.isArray(trackedArray)) {
    for (const t of trackedArray) {
      const tracked = normalizeTracked(t.id || crypto.randomUUID(), t);
      map.set(tracked.id, tracked);
    }
  }
  trackedBySite.set(siteId, map);
}

function memIndexSite(siteId) {
  if (!siteId) return;
  indexEnabledRules(siteId, [ ...memRules.values() ].filter(r => r.site_id === siteId));
  indexTracked(siteId, [ ...memTracked.values() ].filter(t => t.site_id === siteId));
}

if (siteIndexRef) {
  siteIndexRef.onSnapshot(snapshot => {
    for (const change of snapshot.docChanges()) {
      const id = change.doc.id;
      if (change.type === "removed") {
        sitesById.delete(id);
        enabledRulesBySite.delete(id);
        trackedBySite.delete(id);
      } else {
        const data = change.doc.data();
        const site = normalizeSite(id, data);
        sitesById.set(id, site);
        indexEnabledRules(id, data.enabled_rules);
        indexTracked(id, data.tracked_elements);
      }
    }
    indexSites();
    events.emit("sites:changed");
    markReady();
  }, err => {
    console.error("[unidral] site_index listener failed:", err.message);
    markReady();
  });
} else {
  markReady();
}

function byCreatedAt(a, b) {
  return String(a.created_at).localeCompare(String(b.created_at));
}

function getSites() {
  return [ ...sitesById.values() ].sort(byCreatedAt).reverse();
}

function getSite(id) {
  return sitesById.get(id) || null;
}

function getSiteBySubdomain(subdomain, baseDomain) {
  const sub = String(subdomain || "").toLowerCase();
  if (baseDomain) {
    const bd = String(baseDomain).toLowerCase();
    const exact = sitesBySubdomain.get(`${sub}@${bd}`);
    if (exact) return exact;
    const PRIMARY = String(process.env.BASE_DOMAIN || "example.com").toLowerCase();
    if (bd === PRIMARY) {
      const fallback = sitesBySubdomain.get(sub);
      if (fallback && !fallback.base_domain) return fallback;
    }
    return null;
  }
  return sitesBySubdomain.get(sub) || null;
}

function getWildcardSiteBySubdomain(subdomain, baseDomain) {
  const site = getSiteBySubdomain(subdomain, baseDomain);
  return site && site.wildcard ? site : null;
}

function getEnabledRules(siteId) {
  const map = enabledRulesBySite.get(siteId);
  return map ? [ ...map.values() ].sort(byCreatedAt) : [];
}

function getTrackedElements(siteId) {
  const map = trackedBySite.get(siteId);
  return map ? [ ...map.values() ].sort(byCreatedAt) : [];
}

function countRules(siteId) {
  const map = enabledRulesBySite.get(siteId);
  return map ? map.size : 0;
}

function countTrackedElements(siteId) {
  const map = trackedBySite.get(siteId);
  return map ? map.size : 0;
}

async function getRules(siteId) {
  if (!rulesRef) {
    return [ ...memRules.values() ].filter(r => r.site_id === siteId).sort(byCreatedAt);
  }
  const site = getSite(siteId);
  if (!site) return [];
  const snapshot = await rulesRef.where("site_id", "==", siteId).get();
  return snapshot.docs.map(doc => normalizeRule(doc.id, doc.data())).sort(byCreatedAt);
}

async function getRule(ruleId) {
  if (!rulesRef) return memRules.get(ruleId) || null;
  const doc = await rulesRef.doc(ruleId).get();
  if (!doc.exists) return null;
  return normalizeRule(doc.id, doc.data());
}

async function getTrackedElement(trackedId) {
  if (!trackedRef) return memTracked.get(trackedId) || null;
  const doc = await trackedRef.doc(trackedId).get();
  if (!doc.exists) return null;
  return normalizeTracked(doc.id, doc.data());
}

async function syncSiteIndex(siteId) {
  if (!siteIndexRef) return;
  const rulesSnapshot = rulesRef ? await rulesRef.where("site_id", "==", siteId).get() : {
    docs: []
  };
  const allRules = rulesSnapshot.docs.map(doc => {
    const r = normalizeRule(doc.id, doc.data());
    return {
      id: r.id,
      site_id: r.site_id,
      page_path: r.page_path,
      selector: r.selector,
      trigger: r.trigger,
      event_name: r.event_name,
      code: r.code,
      code_type: r.code_type,
      behavior: r.behavior,
      fingerprint: r.fingerprint,
      enabled: r.enabled,
      created_at: r.created_at,
      updated_at: r.updated_at
    };
  });
  const enabledRules = allRules.filter(r => r.enabled);
  const trackedSnapshot = trackedRef ? await trackedRef.where("site_id", "==", siteId).get() : {
    docs: []
  };
  const allTracked = trackedSnapshot.docs.map(doc => {
    const t = normalizeTracked(doc.id, doc.data());
    return {
      id: t.id,
      site_id: t.site_id,
      label: t.label,
      selector: t.selector,
      fingerprint: t.fingerprint,
      origin_path: t.origin_path,
      origin_prefix: t.origin_prefix,
      rule_ids: t.rule_ids,
      found_on: t.found_on,
      created_at: t.created_at,
      updated_at: t.updated_at
    };
  });
  await siteIndexRef.doc(siteId).set({
    enabled_rules: enabledRules,
    tracked_elements: allTracked,
    updated_at: nowIso()
  }, {
    merge: true
  });
}

function persistAsync(promise, label) {
  if (!promise) return;
  promise.catch(err => {
    console.error(`[unidral] background write failed (${label}):`, err.message);
  });
}

async function createSite(input) {
  const id = crypto.randomUUID();
  const record = {
    ...input,
    created_at: nowIso(),
    updated_at: nowIso()
  };
  if (sitesRef) {
    persistAsync(sitesRef.doc(id).set(record), `createSite ${id}`);
  }
  const indexData = {
    ...record,
    enabled_rules: [],
    tracked_elements: []
  };
  persistAsync(siteIndexRef && siteIndexRef.doc(id).set(indexData), `createSite site_index ${id}`);
  const site = normalizeSite(id, record);
  sitesById.set(id, site);
  indexSites();
  enabledRulesBySite.set(id, new Map);
  trackedBySite.set(id, new Map);
  return site;
}

async function updateSite(id, changes) {
  const current = getSite(id);
  if (!current) return null;
  const record = {
    ...changes,
    updated_at: nowIso()
  };
  const site = normalizeSite(id, {
    ...current,
    ...record
  });
  sitesById.set(id, site);
  indexSites();
  events.emit("site:changed", { site_id: id, site: site });
  try {
    if (sitesRef) {
      await sitesRef.doc(id).set(record, {
        merge: true
      });
    }
    if (siteIndexRef) {
      await siteIndexRef.doc(id).set(record, {
        merge: true
      });
    }
  } catch (err) {
    console.error(`[unidral] updateSite write failed (${id}):`, err.message);
  }
  return site;
}

async function deleteSite(id) {
  if (rulesRef) {
    try {
      const rulesSnapshot = await rulesRef.where("site_id", "==", id).get();
      const batch = firestore.batch();
      for (const doc of rulesSnapshot.docs) batch.delete(doc.ref);
      persistAsync(batch.commit(), `deleteSite rules ${id}`);
    } catch {}
  }
  if (trackedRef) {
    try {
      const trackedSnapshot = await trackedRef.where("site_id", "==", id).get();
      const batch = firestore.batch();
      for (const doc of trackedSnapshot.docs) batch.delete(doc.ref);
      persistAsync(batch.commit(), `deleteSite tracked ${id}`);
    } catch {}
  }
  for (const [ rid, r ] of memRules) {
    if (r.site_id === id) memRules.delete(rid);
  }
  for (const [ tid, t ] of memTracked) {
    if (t.site_id === id) memTracked.delete(tid);
  }
  if (sitesRef) {
    persistAsync(sitesRef.doc(id).delete(), `deleteSite ${id}`);
  }
  persistAsync(siteIndexRef && siteIndexRef.doc(id).delete(), `deleteSite site_index ${id}`);
  sitesById.delete(id);
  enabledRulesBySite.delete(id);
  trackedBySite.delete(id);
  indexSites();
  return {
    id: id,
    deletedRules: countRules(id),
    deletedTracked: countTrackedElements(id)
  };
}

async function createRule(input) {
  const id = crypto.randomUUID();
  const record = {
    ...input,
    created_at: nowIso(),
    updated_at: nowIso()
  };
  if (rulesRef) {
    await rulesRef.doc(id).set(record);
  } else {
    memRules.set(id, normalizeRule(id, record));
  }
  if (input.site_id) {
    try {
      await syncSiteIndex(input.site_id);
    } catch (err) {
      console.error("[unidral] syncSiteIndex failed (createRule):", err.message);
    }
    if (!rulesRef) memIndexSite(input.site_id);
  }
  const rule = normalizeRule(id, record);
  events.emit("rule:changed", {
    action: "create",
    rule: rule
  });
  return rule;
}

async function updateRule(id, changes) {
  let current = null;
  if (rulesRef) {
    const doc = await rulesRef.doc(id).get();
    if (!doc.exists) return null;
    current = normalizeRule(id, doc.data());
  } else {
    current = memRules.get(id) || null;
    if (!current) return null;
  }
  const record = {
    ...changes,
    updated_at: nowIso()
  };
  const rule = normalizeRule(id, {
    ...current,
    ...record
  });
  if (rulesRef) {
    await rulesRef.doc(id).set(record, {
      merge: true
    });
  } else {
    memRules.set(id, rule);
  }
  if (current.site_id) {
    try {
      await syncSiteIndex(current.site_id);
    } catch (err) {
      console.error("[unidral] syncSiteIndex failed (updateRule):", err.message);
    }
    if (!rulesRef) memIndexSite(current.site_id);
  }
  events.emit("rule:changed", {
    action: "update",
    rule: rule
  });
  return rule;
}

async function deleteRule(id) {
  let current = null;
  if (rulesRef) {
    const doc = await rulesRef.doc(id).get();
    if (!doc.exists) return null;
    current = normalizeRule(id, doc.data());
    await rulesRef.doc(id).delete();
  } else {
    current = memRules.get(id) || null;
    if (!current) return null;
    memRules.delete(id);
  }
  if (current.site_id) {
    try {
      await syncSiteIndex(current.site_id);
    } catch (err) {
      console.error("[unidral] syncSiteIndex failed (deleteRule):", err.message);
    }
    if (!rulesRef) memIndexSite(current.site_id);
  }
  events.emit("rule:changed", {
    action: "delete",
    rule: {
      ...current,
      deleted: true
    }
  });
  return current;
}

async function createTrackedElement(input) {
  const id = crypto.randomUUID();
  const record = {
    ...input,
    found_on: input.found_on || {},
    created_at: nowIso(),
    updated_at: nowIso()
  };
  if (trackedRef) {
    persistAsync(trackedRef.doc(id).set(record), `createTracked ${id}`);
  } else {
    memTracked.set(id, normalizeTracked(id, record));
  }
  if (input.site_id) {
    try {
      await syncSiteIndex(input.site_id);
    } catch (err) {
      console.error("[unidral] syncSiteIndex failed (createTracked):", err.message);
    }
    if (!trackedRef) memIndexSite(input.site_id);
  }
  const tracked = normalizeTracked(id, record);
  events.emit("tracked:changed", {
    action: "create",
    tracked: tracked
  });
  return tracked;
}

async function updateTrackedElement(id, changes) {
  let current = null;
  if (trackedRef) {
    const doc = await trackedRef.doc(id).get();
    if (!doc.exists) return null;
    current = normalizeTracked(id, doc.data());
  } else {
    current = memTracked.get(id) || null;
    if (!current) return null;
  }
  const record = {
    ...changes,
    updated_at: nowIso()
  };
  const tracked = normalizeTracked(id, {
    ...current,
    ...record
  });
  if (trackedRef) {
    persistAsync(trackedRef.doc(id).set(record, {
      merge: true
    }), `updateTracked ${id}`);
  } else {
    memTracked.set(id, tracked);
  }
  if (current.site_id) {
    try {
      await syncSiteIndex(current.site_id);
    } catch (err) {
      console.error("[unidral] syncSiteIndex failed (updateTracked):", err.message);
    }
    if (!trackedRef) memIndexSite(current.site_id);
  }
  events.emit("tracked:changed", {
    action: "update",
    tracked: tracked
  });
  return tracked;
}

async function reportTrackedFound(id, path, prefix) {
  const current = await getTrackedElement(id);
  if (!current) return null;
  const key = `${prefix || ""}|${path || ""}`;
  const foundOn = {
    ...current.found_on
  };
  foundOn[key] = {
    path: path || "",
    prefix: prefix || "",
    foundAt: nowIso()
  };
  return updateTrackedElement(id, {
    found_on: foundOn
  });
}

async function deleteTrackedElement(id) {
  let current = null;
  if (trackedRef) {
    const doc = await trackedRef.doc(id).get();
    if (!doc.exists) return null;
    current = normalizeTracked(id, doc.data());
    persistAsync(trackedRef.doc(id).delete(), `deleteTracked ${id}`);
  } else {
    current = memTracked.get(id) || null;
    if (!current) return null;
    memTracked.delete(id);
  }
  if (current.site_id) {
    try {
      await syncSiteIndex(current.site_id);
    } catch (err) {
      console.error("[unidral] syncSiteIndex failed (deleteTracked):", err.message);
    }
    if (!trackedRef) memIndexSite(current.site_id);
  }
  events.emit("tracked:changed", {
    action: "delete",
    tracked: {
      ...current,
      deleted: true
    }
  });
  return current;
}

async function deleteTrackedBySite(siteId) {
  if (!trackedRef) {
    let removed = 0;
    for (const [ tid, t ] of memTracked) {
      if (t.site_id === siteId) {
        memTracked.delete(tid);
        removed += 1;
      }
    }
    if (removed) memIndexSite(siteId);
    return removed;
  }
  const snapshot = await trackedRef.where("site_id", "==", siteId).get();
  const batch = firestore.batch();
  for (const doc of snapshot.docs) batch.delete(doc.ref);
  persistAsync(batch.commit(), `deleteTrackedBySite ${siteId}`);
  return snapshot.size;
}

function clearCache() {
  sitesBySubdomain.clear();
  indexSites();
}

async function reload() {
  if (!siteIndexRef) return;
  const snapshot = await siteIndexRef.get();
  sitesById.clear();
  enabledRulesBySite.clear();
  trackedBySite.clear();
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const site = normalizeSite(doc.id, data);
    sitesById.set(doc.id, site);
    indexEnabledRules(doc.id, data.enabled_rules);
    indexTracked(doc.id, data.tracked_elements);
  }
  indexSites();
  events.emit("sites:changed");
}

function ready() {
  return readyPromise;
}

function stats() {
  return {
    backend: inMemory ? "in-memory" : "firestore",
    projectId: projectId,
    emulator: usingEmulator,
    sites: sitesById.size,
    enabledRules: [ ...enabledRulesBySite.values() ].reduce((sum, m) => sum + m.size, 0),
    tracked: [ ...trackedBySite.values() ].reduce((sum, m) => sum + m.size, 0)
  };
}

function serializeSite(row) {
  if (!row) return null;
  return {
    id: row.id,
    target_url: row.target_url,
    subdomain: row.subdomain,
    base_domain: row.base_domain || null,
    wildcard: Boolean(row.wildcard),
    mode: row.mode === "live" ? "live" : "dev",
    live: row.mode === "live" ? false : true,
    label: row.label === undefined ? null : row.label,
    notes: row.notes === undefined ? null : row.notes,
    custom_js: row.custom_js === undefined ? null : row.custom_js,
    custom_css: row.custom_css === undefined ? null : row.custom_css,
    csp_mode: row.csp_mode === "rewrite" || row.csp_mode === "keep" ? row.csp_mode : "strip",
    waf_bypass: row.waf_bypass || "none",
    block_ads: Boolean(row.block_ads),
    text_replacements: Array.isArray(row.text_replacements) ? row.text_replacements : [],
    dom_overrides: Array.isArray(row.dom_overrides) ? row.dom_overrides : [],
    css_overrides: Array.isArray(row.css_overrides) ? row.css_overrides : [],
    js_overrides: Array.isArray(row.js_overrides) ? row.js_overrides : [],
    image_overrides: Array.isArray(row.image_overrides) ? row.image_overrides : [],
    response_header_rules: Array.isArray(row.response_header_rules) ? row.response_header_rules : [],
    request_header_rules: Array.isArray(row.request_header_rules) ? row.request_header_rules : [],
    path_rules: Array.isArray(row.path_rules) ? row.path_rules : [],
    cookie_rules: Array.isArray(row.cookie_rules) ? row.cookie_rules : [],
    modify_non_html: Boolean(row.modify_non_html),
    subdomains: Array.isArray(row.subdomains) ? row.subdomains : [],
    subdomains_detected_at: row.subdomains_detected_at || null,
    inject_orig_domain: Boolean(row.inject_orig_domain),
    geo_bypass: Boolean(row.geo_bypass),
    egress_mode: row.egress_mode || "direct",
    workers_url: row.workers_url || "",
    frozen: Boolean(row.frozen),
    created_at: row.created_at,
    updated_at: row.updated_at,
    rule_count: countRules(row.id),
    tracked_count: countTrackedElements(row.id)
  };
}

function serializeRule(row) {
  if (!row) return null;
  return {
    id: row.id,
    site_id: row.site_id,
    page_path: row.page_path,
    selector: row.selector,
    trigger: row.trigger,
    event_name: row.event_name === undefined ? null : row.event_name,
    code: row.code,
    code_type: row.code_type === "html" ? "html" : "js",
    behavior: row.behavior === "override" ? "override" : "augment",
    fingerprint: row.fingerprint || null,
    enabled: Boolean(row.enabled),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function serializeTracked(row) {
  if (!row) return null;
  return {
    id: row.id,
    site_id: row.site_id,
    label: row.label || null,
    selector: row.selector || "",
    fingerprint: row.fingerprint || null,
    origin_path: row.origin_path || "*",
    origin_prefix: row.origin_prefix || "",
    rule_ids: Array.isArray(row.rule_ids) ? row.rule_ids : [],
    found_on: row.found_on || {},
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

module.exports = {
  events: events,
  ready: ready,
  stats: stats,
  nowIso: nowIso,
  getSites: getSites,
  getSite: getSite,
  getSiteBySubdomain: getSiteBySubdomain,
  getWildcardSiteBySubdomain: getWildcardSiteBySubdomain,
  getEnabledRules: getEnabledRules,
  getTrackedElements: getTrackedElements,
  getRules: getRules,
  getRule: getRule,
  getTrackedElement: getTrackedElement,
  createSite: createSite,
  updateSite: updateSite,
  deleteSite: deleteSite,
  createRule: createRule,
  updateRule: updateRule,
  deleteRule: deleteRule,
  createTrackedElement: createTrackedElement,
  updateTrackedElement: updateTrackedElement,
  reportTrackedFound: reportTrackedFound,
  deleteTrackedElement: deleteTrackedElement,
  deleteTrackedBySite: deleteTrackedBySite,
  syncSiteIndex: syncSiteIndex,
  clearCache: clearCache,
  reload: reload,
  serializeSite: serializeSite,
  serializeRule: serializeRule,
  serializeTracked: serializeTracked,
  normalizeSubdomainList: normalizeSubdomainList
};
