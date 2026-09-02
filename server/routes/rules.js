"use strict";

const express = require("express");

const store = require("../db");

const {serializeRule: serializeRule} = require("../db");

const {badRequest: badRequest, notFound: notFound, HttpError: HttpError} = require("../middleware/errorHandler");

const {asyncHandler: asyncHandler, toFlag: toFlag} = require("../util");

const router = express.Router();

const TRIGGERS = new Set([ "click", "hover", "load", "submit", "custom" ]);

function resolveSiteIdForRules(req) {
  const siteId = req.query.site_id || req.query.siteId || req.body && (req.body.site_id || req.body.siteId);
  if (siteId) return String(siteId).trim();
  const ruleId = req.params.id;
  if (ruleId) {
    for (const site of store.getSites()) {
      const rules = store.getEnabledRules(site.id);
      if (rules.some(r => r.id === ruleId)) return site.id;
      const tracked = store.getTrackedElements(site.id);
      if (tracked.some(t => Array.isArray(t.rule_ids) && t.rule_ids.includes(ruleId))) return site.id;
    }
  }
  return null;
}

function siteIdFromBody(req) {
  return String(req.body && (req.body.site_id ?? req.body.siteId) || "").trim();
}

function siteIdFromQuery(req) {
  return String(req.query.site_id || req.query.siteId || "").trim();
}

function normalizeFingerprint(value) {
  if (!value || typeof value !== "object") return null;
  const pick = (key, max = 120) => {
    const raw = value[key];
    if (raw === undefined || raw === null) return null;
    const text = String(raw).trim();
    return text ? text.slice(0, max) : null;
  };
  return {
    tag: pick("tag", 32),
    text: pick("text", 120),
    id: pick("id"),
    name: pick("name"),
    type: pick("type", 32),
    role: pick("role", 32),
    testId: pick("testId"),
    ariaLabel: pick("ariaLabel"),
    href: pick("href", 300),
    classes: Array.isArray(value.classes) ? value.classes.slice(0, 8).map(c => String(c).slice(0, 60)) : [],
    index: Number.isInteger(value.index) ? value.index : null
  };
}

function normalizeTrigger(value, fallback = "click") {
  const trigger = String(value == null || value === "" ? fallback : value).trim().toLowerCase();
  if (!TRIGGERS.has(trigger)) {
    throw badRequest(`trigger must be one of: ${[ ...TRIGGERS ].join(", ")}`);
  }
  return trigger;
}

function normalizeSelector(value) {
  const selector = String(value == null ? "" : value).trim();
  if (!selector) throw badRequest("selector is required");
  return selector;
}

function normalizeCode(value) {
  const code = String(value == null ? "" : value);
  if (!code.trim()) throw badRequest("code is required");
  return code;
}

function normalizeCodeType(value) {
  const t = String(value == null || value === "" ? "js" : value).trim().toLowerCase();
  if (t !== "js" && t !== "html") return "js";
  return t;
}

function normalizePagePath(value) {
  const pagePath = String(value == null || value === "" ? "*" : value).trim();
  return pagePath || "*";
}

function normalizeEventName(value, trigger) {
  const eventName = value == null ? "" : String(value).trim();
  if (trigger === "custom" && !eventName) {
    throw badRequest('event_name is required when trigger is "custom"');
  }
  return eventName || null;
}

function normalizeBehavior(value, fallback = "augment") {
  const behavior = String(value == null || value === "" ? fallback : value).trim().toLowerCase();
  if (behavior !== "augment" && behavior !== "override") {
    throw badRequest('behavior must be "augment" or "override"');
  }
  return behavior;
}

router.get("/", asyncHandler(async (req, res) => {
  const siteId = siteIdFromQuery(req);
  if (!siteId) throw badRequest("site_id query parameter is required");
  const rules = await store.getRules(siteId);
  res.json(rules.map(serializeRule));
}));

router.get("/:id", asyncHandler(async (req, res) => {
  const siteId = resolveSiteIdForRules(req);
  if (!siteId) throw notFound(`Rule "${req.params.id}" not found`);
  const rule = await store.getRule(req.params.id);
  if (!rule) throw notFound(`Rule "${req.params.id}" not found`);
  res.json(serializeRule(rule));
}));

router.post("/", asyncHandler(async (req, res) => {
  const body = req.body || {};
  const siteId = siteIdFromBody(req);
  if (!siteId) throw badRequest("site_id is required");
  if (!store.getSite(siteId)) throw notFound(`Site "${siteId}" not found`);
  const trigger = normalizeTrigger(body.trigger);
  const rule = await store.createRule({
    site_id: siteId,
    page_path: normalizePagePath(body.page_path ?? body.pagePath),
    selector: normalizeSelector(body.selector),
    trigger: trigger,
    event_name: normalizeEventName(body.event_name ?? body.eventName, trigger),
    code: normalizeCode(body.code),
    code_type: normalizeCodeType(body.code_type ?? body.codeType),
    behavior: normalizeBehavior(body.behavior),
    fingerprint: normalizeFingerprint(body.fingerprint),
    enabled: toFlag(body.enabled, true)
  });
  res.status(201).json(serializeRule(rule));
}));

router.put("/:id", asyncHandler(async (req, res) => {
  const siteId = resolveSiteIdForRules(req);
  if (!siteId) throw notFound(`Rule "${req.params.id}" not found`);
  const current = await store.getRule(req.params.id);
  if (!current) throw notFound(`Rule "${req.params.id}" not found`);
  const body = req.body || {};
  const trigger = body.trigger !== undefined ? normalizeTrigger(body.trigger) : current.trigger;
  const changes = {
    page_path: body.page_path !== undefined || body.pagePath !== undefined ? normalizePagePath(body.page_path ?? body.pagePath) : current.page_path,
    selector: body.selector !== undefined ? normalizeSelector(body.selector) : current.selector,
    trigger: trigger,
    event_name: body.event_name !== undefined || body.eventName !== undefined || body.trigger !== undefined ? normalizeEventName(body.event_name ?? body.eventName ?? current.event_name, trigger) : current.event_name,
    code: body.code !== undefined ? normalizeCode(body.code) : current.code,
    code_type: body.code_type !== undefined || body.codeType !== undefined ? normalizeCodeType(body.code_type ?? body.codeType) : current.code_type || "js",
    behavior: body.behavior !== undefined ? normalizeBehavior(body.behavior) : current.behavior,
    fingerprint: body.fingerprint !== undefined ? normalizeFingerprint(body.fingerprint) : current.fingerprint,
    enabled: toFlag(body.enabled, current.enabled)
  };
  const rule = await store.updateRule(current.id, changes);
  res.json(serializeRule(rule));
}));

router.patch("/:id/toggle", asyncHandler(async (req, res) => {
  const siteId = resolveSiteIdForRules(req);
  if (!siteId) throw notFound(`Rule "${req.params.id}" not found`);
  const current = await store.getRule(req.params.id);
  if (!current) throw notFound(`Rule "${req.params.id}" not found`);
  const enabled = req.body && req.body.enabled !== undefined ? toFlag(req.body.enabled, !current.enabled) : !current.enabled;
  const rule = await store.updateRule(current.id, {
    enabled: enabled
  });
  res.json(serializeRule(rule));
}));

router.delete("/:id", asyncHandler(async (req, res) => {
  const siteId = resolveSiteIdForRules(req);
  if (!siteId) throw notFound(`Rule "${req.params.id}" not found`);
  const current = await store.getRule(req.params.id);
  if (!current) throw notFound(`Rule "${req.params.id}" not found`);
  await store.deleteRule(current.id);
  res.json({
    deleted: true,
    id: current.id,
    site_id: current.site_id
  });
}));

module.exports = router;
