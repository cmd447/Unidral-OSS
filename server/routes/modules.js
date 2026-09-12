"use strict";

const express = require("express");

const modulesStore = require("../modules-store");

const moduleLoader = require("../module-loader");

const { validateZip } = require("../module-validator");

const { asyncHandler } = require("../util");

const { badRequest, notFound, HttpError } = require("../middleware/errorHandler");

const router = express.Router();

router.get("/", asyncHandler(async (req, res) => {
  const modules = modulesStore.listModules();
  const summary = modules.map(m => ({
    id: m.id,
    name: m.name,
    description: m.description,
    icon: m.icon,
    type: m.type || "capture",
    target_url: m.target_url,
    is_default: m.is_default,
    upstream_count: Object.keys(m.upstream_map || {}).length,
    trigger: m.trigger || "engine",
    package_type: m._package_type,
    api_version: m.api_version || 1,
    has_hooks: m._has_hooks || false,
    hook_files: Object.keys(m._hookFiles || {}),
    hook_count: Object.keys(m._hookFiles || {}).length,
    extends: m.extends || null,
    capabilities: m.capabilities || null,
    created_at: m.created_at,
    updated_at: m.updated_at
  }));
  res.json({ modules: summary });
}));

router.get("/:id", asyncHandler(async (req, res) => {
  const mod = modulesStore.getModule(req.params.id);
  if (!mod) return notFound(res, "Module not found");
  res.json({ module: mod });
}));

router.get("/:id/files", asyncHandler(async (req, res) => {
  const mod = modulesStore.getModule(req.params.id);
  if (!mod) return notFound(res, "Module not found");
  const files = moduleLoader.listModuleFiles(req.params.id) || [];
  res.json({ files });
}));

router.get("/:id/files/:filename", asyncHandler(async (req, res) => {
  const mod = modulesStore.getModule(req.params.id);
  if (!mod) return notFound(res, "Module not found");
  const content = moduleLoader.readModuleFile(req.params.id, req.params.filename);
  if (content === null) return notFound(res, "File not found");
  res.type("text/plain").send(content);
}));

router.delete("/:id", asyncHandler(async (req, res) => {
  const ok = modulesStore.deleteModule(req.params.id);
  if (!ok) return notFound(res, "Module not found");
  moduleLoader.reload();
  res.json({ ok: true });
}));

module.exports = router;
