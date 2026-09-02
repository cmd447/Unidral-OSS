"use strict";

const dns = require("dns").promises;

const net = require("net");

const express = require("express");

const store = require("../db");

const {serializeSite: serializeSite, serializeRule: serializeRule, serializeTracked: serializeTracked} = require("../db");

const {badRequest: badRequest, notFound: notFound} = require("../middleware/errorHandler");

const {discoverAndStore: discoverAndStore} = require("../discovery");

const rulesRouter = require("./rules");

const {asyncHandler: asyncHandler, toFlag: toFlag} = require("../util");

let certReissueTimer = null;

function triggerCertReissue() {
  if (certReissueTimer) clearTimeout(certReissueTimer);
  certReissueTimer = setTimeout(async () => {
    certReissueTimer = null;
    try {
      const {spawn: spawn} = require("child_process");
      const fs = require("fs");
      const path = require("path");
      let scriptPath = null;
      if (fs.existsSync("/repo/scripts/issue-wildcard-certs.sh")) {
        scriptPath = "/repo/scripts/issue-wildcard-certs.sh";
      } else {
        const p = path.join(__dirname, "..", "..", "scripts", "issue-wildcard-certs.sh");
        if (fs.existsSync(p)) scriptPath = p;
      }
      if (!scriptPath) return;
      const bashPath = [ "/usr/bin/bash", "/bin/bash" ].find(p => {
        try {
          fs.accessSync(p, fs.constants.X_OK);
          return true;
        } catch {
          return false;
        }
      }) || "bash";
      const child = spawn(bashPath, [ scriptPath ], {
        env: {
          ...process.env,
          COMPOSE_DIR: "/repo"
        },
        cwd: "/repo",
        detached: true,
        stdio: "ignore"
      });
      child.unref();
    } catch (err) {
      console.error("[sites] Auto cert reissue failed:", err.message);
    }
  }, 1e4);
}

const router = express.Router();

const siteScoped = express.Router();

const ALLOW_PRIVATE_TARGETS = /^(1|true|yes)$/i.test(process.env.ALLOW_PRIVATE_TARGETS || "");

const LABEL_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/;

const RESERVED_SUBDOMAINS = new Set((process.env.RESERVED_SUBDOMAINS || "dashboard,engine,www,api").split(",").map(s => s.trim().toLowerCase()).filter(Boolean));

function isPrivateAddress(address) {
  const version = net.isIP(address);
  if (version === 4) {
    const parts = address.split(".").map(Number);
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  if (version === 6) {
    let lower = address.toLowerCase().trim();
    if (lower.startsWith("[") && lower.endsWith("]")) lower = lower.slice(1, -1);
    if (lower === "::" || lower === "::1" || lower === "0:0:0:0:0:0:0:1" || lower === "0:0:0:0:0:0:0:0") return true;
    if (lower.startsWith("fe80") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
    const v4MappedMatch = lower.match(/^(?:::(?:ffff(?::0{1,4})?:)?|0:0:0:0:0:ffff:)(.+)$/i);
    if (v4MappedMatch) {
      const target = v4MappedMatch[1];
      if (net.isIPv4(target)) return isPrivateAddress(target);
      const hexParts = target.split(":");
      if (hexParts.length === 2) {
        const p1 = parseInt(hexParts[0], 16);
        const p2 = parseInt(hexParts[1], 16);
        if (!isNaN(p1) && !isNaN(p2)) {
          const ip4 = `${p1 >> 8 & 255}.${p1 & 255}.${p2 >> 8 & 255}.${p2 & 255}`;
          return isPrivateAddress(ip4);
        }
      }
    }
    return false;
  }
  return false;
}

async function assertPublicTarget(url) {
  if (ALLOW_PRIVATE_TARGETS) return;
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".internal")) {
    throw badRequest(`target_url resolves to a private host (${hostname}). Set ALLOW_PRIVATE_TARGETS=1 to allow it.`);
  }
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw badRequest(`target_url points at a private address (${hostname}). Set ALLOW_PRIVATE_TARGETS=1 to allow it.`);
    }
    return;
  }
  let addresses;
  try {
    addresses = await dns.lookup(hostname, {
      all: true
    });
  } catch (err) {
    throw badRequest(`target_url host "${hostname}" could not be resolved (${err.code || err.message})`);
  }
  const blocked = addresses.filter(entry => isPrivateAddress(entry.address));
  if (blocked.length) {
    throw badRequest(`target_url resolves to a private address (${blocked.map(e => e.address).join(", ")}). ` + "Set ALLOW_PRIVATE_TARGETS=1 to allow it.");
  }
}

function normalizeSubdomain(value) {
  const raw = String(value == null ? "" : value).trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  if (!raw) throw badRequest("subdomain is required");
  const labels = raw.split(".");
  for (const label of labels) {
    if (!LABEL_RE.test(label)) {
      throw badRequest("subdomain must contain only letters, numbers and hyphens (each label must start and end with a letter or number)");
    }
  }
  if (RESERVED_SUBDOMAINS.has(raw)) {
    throw badRequest(`"${raw}" is a reserved subdomain`);
  }
  return raw;
}

async function normalizeTargetUrl(value) {
  const raw = String(value == null ? "" : value).trim();
  if (!raw) throw badRequest("target_url is required");
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw badRequest("target_url must be a valid URL, e.g. https://example.com");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw badRequest("target_url must use http or https");
  }
  await assertPublicTarget(url);
  const pathname = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${pathname}`;
}

function normalizeLabel(value) {
  if (value === undefined || value === null) return null;
  const label = String(value).trim();
  return label ? label.slice(0, 200) : null;
}

function normalizeNotes(value) {
  if (value === undefined || value === null) return null;
  const notes = String(value).trim();
  return notes ? notes.slice(0, 4e3) : null;
}

function normalizeCustomJs(value) {
  if (value === undefined || value === null) return null;
  const js = String(value);
  return js ? js.slice(0, 102400) : null;
}

function normalizeCspMode(value, fallback) {
  if (value === undefined || value === null) return fallback;
  const raw = String(value).toLowerCase().trim();
  if (raw === "strip" || raw === "rewrite" || raw === "keep") return raw;
  return fallback;
}

function normalizeMode(body, fallback) {
  const raw = body.mode === undefined ? null : String(body.mode).toLowerCase();
  if (raw === "dev" || raw === "live") return raw;
  if (body.live !== undefined) return toFlag(body.live, true) ? "dev" : "live";
  return fallback;
}

function requireSite(id) {
  const site = store.getSite(id);
  if (!site) throw notFound(`Site "${id}" not found`);
  return site;
}

const ALL_BASE_DOMAINS = [ String(process.env.BASE_DOMAIN || "example.com").toLowerCase(), ...String(process.env.EXTRA_BASE_DOMAINS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean) ];

function normalizeBaseDomain(value) {
  if (!value) return null;
  const bd = String(value).trim().toLowerCase();
  if (ALL_BASE_DOMAINS.includes(bd)) return bd;
  try {
    const domains = require("../domains");
    const available = domains.getAvailableBaseDomains();
    if (available.some(d => d.domain === bd)) return bd;
  } catch {}
  throw badRequest(`Unknown base domain "${bd}". Available: ${ALL_BASE_DOMAINS.join(", ")}`);
}

function assertSubdomainFree(subdomain, ignoreId, baseDomain) {
  const existing = store.getSiteBySubdomain(subdomain, baseDomain);
  if (existing && existing.id !== ignoreId) {
    const label = baseDomain ? `"${subdomain}" on "${baseDomain}"` : `"${subdomain}"`;
    throw badRequest(`Subdomain ${label} is already in use`);
  }
}

router.use(siteScoped);

router.get("/", (req, res) => {
  const sites = store.getSites();
  res.json(sites.map(serializeSite));
});

router.post("/", asyncHandler(async (req, res) => {
  const body = req.body || {};
  const baseDomain = normalizeBaseDomain(body.base_domain ?? body.baseDomain);
  const input = {
    target_url: await normalizeTargetUrl(body.target_url ?? body.targetUrl),
    subdomain: normalizeSubdomain(body.subdomain),
    base_domain: baseDomain,
    wildcard: toFlag(body.wildcard, false),
    mode: normalizeMode(body, "dev"),
    label: normalizeLabel(body.label),
    notes: normalizeNotes(body.notes),
    custom_js: normalizeCustomJs(body.custom_js),
    csp_mode: normalizeCspMode(body.csp_mode, "strip"),
    geo_bypass: body.geo_bypass === true,
    egress_mode: String(body.egress_mode || "direct").trim().toLowerCase(),
    workers_url: String(body.workers_url || "").trim().slice(0, 500),
    text_replacements: Array.isArray(body.text_replacements) ? body.text_replacements : [],
    dom_overrides: Array.isArray(body.dom_overrides) ? body.dom_overrides : [],
    css_overrides: Array.isArray(body.css_overrides) ? body.css_overrides : [],
    js_overrides: Array.isArray(body.js_overrides) ? body.js_overrides : [],
    image_overrides: Array.isArray(body.image_overrides) ? body.image_overrides : [],
    response_header_rules: Array.isArray(body.response_header_rules) ? body.response_header_rules : [],
    request_header_rules: Array.isArray(body.request_header_rules) ? body.request_header_rules : [],
    path_rules: Array.isArray(body.path_rules) ? body.path_rules : [],
    cookie_rules: Array.isArray(body.cookie_rules) ? body.cookie_rules : [],
    modify_non_html: body.modify_non_html === true
  };
  if (![ "direct", "warp", "workers" ].includes(input.egress_mode)) {
    input.egress_mode = "direct";
  }
  if (input.egress_mode === "workers" && !input.workers_url) {
    input.egress_mode = "direct";
  }
  assertSubdomainFree(input.subdomain, null, baseDomain);
  const site = await store.createSite(input);
  discoverAndStore(site).catch(err => console.error("[sites] discovery failed:", err.message));
  if (input.wildcard) {
    triggerCertReissue();
  }
  res.status(201).json(serializeSite(site));
}));

router.get("/:id", (req, res) => {
  const site = requireSite(req.params.id);
  res.json(serializeSite(site));
});

router.put("/:id", asyncHandler(async (req, res) => {
  const current = requireSite(req.params.id);
  const body = req.body || {};
  const baseDomain = body.base_domain !== undefined || body.baseDomain !== undefined ? normalizeBaseDomain(body.base_domain ?? body.baseDomain) : current.base_domain;
  const changes = {
    target_url: body.target_url !== undefined || body.targetUrl !== undefined ? await normalizeTargetUrl(body.target_url ?? body.targetUrl) : current.target_url,
    subdomain: body.subdomain !== undefined ? normalizeSubdomain(body.subdomain) : current.subdomain,
    base_domain: baseDomain,
    wildcard: toFlag(body.wildcard, current.wildcard),
    mode: normalizeMode(body, current.mode),
    label: body.label !== undefined ? normalizeLabel(body.label) : current.label,
    notes: body.notes !== undefined ? normalizeNotes(body.notes) : current.notes,
    custom_js: body.custom_js !== undefined ? normalizeCustomJs(body.custom_js) : current.custom_js,
    csp_mode: body.csp_mode !== undefined ? normalizeCspMode(body.csp_mode, current.csp_mode) : current.csp_mode,
    subdomains: body.subdomains !== undefined ? store.normalizeSubdomainList(body.subdomains) : current.subdomains,
    inject_orig_domain: body.inject_orig_domain !== undefined ? toFlag(body.inject_orig_domain, false) : current.inject_orig_domain,
    geo_bypass: body.geo_bypass !== undefined ? body.geo_bypass === true : current.geo_bypass,
    egress_mode: body.egress_mode !== undefined ? String(body.egress_mode || "direct").trim().toLowerCase() : current.egress_mode,
    workers_url: body.workers_url !== undefined ? String(body.workers_url || "").trim().slice(0, 500) : current.workers_url,
    text_replacements: body.text_replacements !== undefined ? body.text_replacements : current.text_replacements,
    dom_overrides: body.dom_overrides !== undefined ? body.dom_overrides : current.dom_overrides,
    css_overrides: body.css_overrides !== undefined ? body.css_overrides : current.css_overrides,
    js_overrides: body.js_overrides !== undefined ? body.js_overrides : current.js_overrides,
    image_overrides: body.image_overrides !== undefined ? body.image_overrides : current.image_overrides,
    response_header_rules: body.response_header_rules !== undefined ? body.response_header_rules : current.response_header_rules,
    request_header_rules: body.request_header_rules !== undefined ? body.request_header_rules : current.request_header_rules,
    path_rules: body.path_rules !== undefined ? body.path_rules : current.path_rules,
    cookie_rules: body.cookie_rules !== undefined ? body.cookie_rules : current.cookie_rules,
    modify_non_html: body.modify_non_html !== undefined ? body.modify_non_html : current.modify_non_html
  };
  if (![ "direct", "warp", "workers" ].includes(changes.egress_mode)) {
    changes.egress_mode = "direct";
  }
  if (changes.egress_mode === "workers" && !changes.workers_url) {
    changes.egress_mode = "direct";
  }
  assertSubdomainFree(changes.subdomain, current.id, baseDomain);
  const site = await store.updateSite(current.id, changes);
  if (changes.target_url !== current.target_url) discoverAndStore(site).catch(err => console.error("[sites] discovery failed:", err.message));
  if (changes.wildcard && !current.wildcard) {
    triggerCertReissue();
  }
  res.json(serializeSite(site));
}));

router.post("/:id/discover-subdomains", asyncHandler(async (req, res) => {
  const site = requireSite(req.params.id);
  const subdomains = await discoverAndStore(site);
  if (subdomains === null) {
    res.json({
      detected: false,
      subdomains: site.subdomains,
      message: "discovery failed, kept previous list"
    });
    return;
  }
  res.json({
    detected: true,
    subdomains: subdomains
  });
}));

router.delete("/:id", asyncHandler(async (req, res) => {
  const site = requireSite(req.params.id);
  const result = await store.deleteSite(site.id);
  res.json({
    deleted: true,
    id: site.id,
    deletedRules: result.deletedRules
  });
}));

router.get("/:id/rules", asyncHandler(async (req, res) => {
  const site = requireSite(req.params.id);
  const rules = await store.getRules(site.id);
  res.json(rules.map(serializeRule));
}));

router.use("/:id/rules", (req, res, next) => {
  if (req.method === "GET") return next();
  const site = requireSite(req.params.id);
  req.body = req.body || {};
  req.body.site_id = site.id;
  if (req.method === "PUT" && (req.url === "/" || req.url === "") && req.body.id) {
    req.url = `/${encodeURIComponent(String(req.body.id))}`;
  }
  rulesRouter(req, res, next);
});

function window_location_path(req) {
  const referer = String(req.headers["referer"] || req.headers["referrer"] || "");
  if (referer) {
    try {
      return new URL(referer).pathname || "/";
    } catch {}
  }
  return "/";
}

function current_prefix(req) {
  const host = String(req.headers["host"] || "");
  return "";
}

siteScoped.get("/:id/tracked-elements", (req, res) => {
  const site = requireSite(req.params.id);
  res.json(store.getTrackedElements(site.id).map(serializeTracked));
});

siteScoped.post("/:id/tracked-elements", asyncHandler(async (req, res) => {
  const site = requireSite(req.params.id);
  const body = req.body || {};
  if (!body.selector || !String(body.selector).trim()) {
    throw badRequest("selector is required");
  }
  const input = {
    site_id: site.id,
    label: body.label ? String(body.label).trim().slice(0, 200) : null,
    selector: String(body.selector).trim(),
    fingerprint: body.fingerprint || null,
    origin_path: body.origin_path || window_location_path(req),
    origin_prefix: body.origin_prefix || current_prefix(req),
    rule_ids: Array.isArray(body.rule_ids) ? body.rule_ids.slice(0, 50) : [],
    found_on: body.found_on || {}
  };
  const tracked = await store.createTrackedElement(input);
  res.status(201).json(serializeTracked(tracked));
}));

siteScoped.put("/:id/tracked-elements/:trackId", asyncHandler(async (req, res) => {
  requireSite(req.params.id);
  const current = await store.getTrackedElement(req.params.trackId);
  if (!current) throw notFound(`Tracked element "${req.params.trackId}" not found`);
  const body = req.body || {};
  const changes = {
    label: body.label !== undefined ? body.label ? String(body.label).trim().slice(0, 200) : null : current.label,
    selector: body.selector !== undefined ? String(body.selector).trim() : current.selector,
    fingerprint: body.fingerprint !== undefined ? body.fingerprint : current.fingerprint,
    rule_ids: body.rule_ids !== undefined ? Array.isArray(body.rule_ids) ? body.rule_ids.slice(0, 50) : [] : current.rule_ids,
    found_on: body.found_on !== undefined ? body.found_on : current.found_on
  };
  const tracked = await store.updateTrackedElement(current.id, changes);
  res.json(serializeTracked(tracked));
}));

siteScoped.post("/:id/tracked-elements/:trackId/report", asyncHandler(async (req, res) => {
  requireSite(req.params.id);
  const current = await store.getTrackedElement(req.params.trackId);
  if (!current) throw notFound(`Tracked element "${req.params.trackId}" not found`);
  const body = req.body || {};
  const path = String(body.path || window_location_path(req));
  const prefix = String(body.prefix || current_prefix(req));
  const tracked = await store.reportTrackedFound(current.id, path, prefix);
  res.json(serializeTracked(tracked));
}));

siteScoped.delete("/:id/tracked-elements/:trackId", asyncHandler(async (req, res) => {
  requireSite(req.params.id);
  const current = await store.getTrackedElement(req.params.trackId);
  if (!current) throw notFound(`Tracked element "${req.params.trackId}" not found`);
  await store.deleteTrackedElement(current.id);
  res.json({
    deleted: true,
    id: current.id
  });
}));

const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const imageUploadDir = path.join(__dirname, "..", "data", "site-images");
try { fs.mkdirSync(imageUploadDir, { recursive: true }); } catch {}

const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, imageUploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase().slice(0, 10) || ".png";
    const id = crypto.randomUUID();
    cb(null, id + ext);
  }
});
const imageUpload = multer({
  storage: imageStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  }
});

siteScoped.post("/:id/images", imageUpload.single("image"), asyncHandler(async (req, res) => {
  requireSite(req.params.id);
  if (!req.file) throw badRequest("No image file uploaded");
  const filename = req.file.filename;
  const url = `/__unidral/site-img/${filename}`;
  res.json({ url, filename, size: req.file.size });
}));

siteScoped.delete("/:id/images/:filename", asyncHandler(async (req, res) => {
  requireSite(req.params.id);
  const filename = path.basename(req.params.filename);
  const filePath = path.join(imageUploadDir, filename);
  try {
    fs.unlinkSync(filePath);
  } catch {}
  res.json({ deleted: true, filename });
}));

module.exports = router;
