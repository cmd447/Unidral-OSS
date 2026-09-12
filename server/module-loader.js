"use strict";

const fs = require("fs");

const path = require("path");

const MODULES_DIR = path.join(__dirname, "modules");

const SUPPORTED_API_VERSIONS = [ 1, 2 ];

const registry = new Map;

function deepMerge(parent, child) {
  if (parent === null || parent === undefined) return child;
  if (child === null || child === undefined) return parent;
  if (typeof parent !== "object" || typeof child !== "object") return child;
  if (Array.isArray(parent) || Array.isArray(child)) return child;
  const result = {
    ...parent
  };
  for (const key of Object.keys(child)) {
    if (typeof parent[key] === "object" && typeof child[key] === "object" && !Array.isArray(parent[key]) && !Array.isArray(child[key])) {
      result[key] = deepMerge(parent[key], child[key]);
    } else {
      result[key] = child[key];
    }
  }
  return result;
}

function loadDirectoryPackageRaw(dirPath) {
  const configPath = path.join(dirPath, "module.json");
  if (!fs.existsSync(configPath)) {
    console.warn(`[module-loader] No module.json in ${dirPath}, skipping`);
    return null;
  }
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (err) {
    console.warn(`[module-loader] Failed to parse module.json in ${dirPath}:`, err.message);
    return null;
  }
  if (!config.id) {
    console.warn(`[module-loader] Module in ${dirPath} has no id, skipping`);
    return null;
  }
  const apiVersion = config.api_version || 1;
  if (!SUPPORTED_API_VERSIONS.includes(apiVersion)) {
    console.warn(`[module-loader] Module ${config.id} has unsupported api_version ${apiVersion}, skipping`);
    return null;
  }
  const hooks = {};
  const proxyHooksPath = path.join(dirPath, "proxy-hooks.js");
  if (fs.existsSync(proxyHooksPath)) {
    try {
      delete require.cache[require.resolve(proxyHooksPath)];
      const proxyHooks = require(proxyHooksPath);
      Object.assign(hooks, proxyHooks);
    } catch (err) {
      console.warn(`[module-loader] Failed to load proxy-hooks.js for ${config.id}:`, err.message);
    }
  }
  const modifyPath = path.join(dirPath, "modify.js");
  if (fs.existsSync(modifyPath)) {
    try {
      delete require.cache[require.resolve(modifyPath)];
      const modifyHooks = require(modifyPath);
      Object.assign(hooks, modifyHooks);
    } catch (err) {
      console.warn(`[module-loader] Failed to load modify.js for ${config.id}:`, err.message);
    }
  }
  let shimJs = null;
  const shimPath = path.join(dirPath, "shim.js");
  if (fs.existsSync(shimPath)) {
    try {
      shimJs = fs.readFileSync(shimPath, "utf8").replace(/;+\s*$/, "");
    } catch (err) {
      console.warn(`[module-loader] Failed to read shim.js for ${config.id}:`, err.message);
    }
  }
  let shimExtraJs = null;
  const files = config.files || {};
  const shimExtraName = files.shim_extra || "shim-extra.js";
  const shimExtraPath = path.join(dirPath, shimExtraName);
  const shimExtraMinPath = shimExtraPath.replace(/\.js$/, ".min.js");
  if (process.env.NODE_ENV === "production" && fs.existsSync(shimExtraMinPath)) {
    try {
      shimExtraJs = fs.readFileSync(shimExtraMinPath, "utf8").replace(/;+\s*$/, "");
    } catch (err) {
      console.warn(`[module-loader] Failed to read ${shimExtraName.replace(/\.js$/, ".min.js")} for ${config.id}:`, err.message);
    }
  } else if (fs.existsSync(shimExtraPath)) {
    try {
      shimExtraJs = fs.readFileSync(shimExtraPath, "utf8").replace(/;+\s*$/, "");
    } catch (err) {
      console.warn(`[module-loader] Failed to read ${shimExtraName} for ${config.id}:`, err.message);
    }
  }
  let injectJs = null;
  const injectPath = path.join(dirPath, "inject.js");
  if (fs.existsSync(injectPath)) {
    try {
      injectJs = fs.readFileSync(injectPath, "utf8");
    } catch (err) {
      console.warn(`[module-loader] Failed to read inject.js for ${config.id}:`, err.message);
    }
  }
  let routesFn = null;
  const routesPath = path.join(dirPath, "routes.js");
  if (fs.existsSync(routesPath)) {
    try {
      delete require.cache[require.resolve(routesPath)];
      routesFn = require(routesPath);
    } catch (err) {
      console.warn(`[module-loader] Failed to load routes.js for ${config.id}:`, err.message);
    }
  }
  return {
    config: config,
    hooks: hooks,
    shimJs: shimJs,
    shimExtraJs: shimExtraJs,
    injectJs: injectJs,
    routesFn: routesFn,
    path: dirPath,
    type: "package",
    dirPath: dirPath
  };
}

function loadDirectoryPackage(dirPath, _seen = new Set) {
  let mod = loadDirectoryPackageRaw(dirPath);
  if (!mod) return null;
  const parentId = mod.config.extends;
  if (!parentId) return mod;
  const modId = mod.config.id;
  if (_seen.has(modId)) {
    console.warn(`[module-loader] Circular inheritance detected for ${modId}, skipping extends`);
    return mod;
  }
  _seen.add(modId);
  let parent = registry.get(parentId);
  if (!parent) {
    const parentDir = path.join(MODULES_DIR, parentId);
    if (fs.existsSync(parentDir)) {
      parent = loadDirectoryPackage(parentDir, _seen);
    }
  }
  if (!parent) {
    console.warn(`[module-loader] Module ${modId} extends "${parentId}" but parent not found`);
    return mod;
  }
  const mergedConfig = deepMerge(parent.config, mod.config);
  mergedConfig.id = mod.config.id;
  mergedConfig.name = mod.config.name;
  mergedConfig.extends = parentId;
  mergedConfig.created_at = mod.config.created_at;
  mergedConfig.updated_at = mod.config.updated_at;
  const mergedHooks = {
    ...parent.hooks,
    ...mod.hooks
  };
  const mergedShim = mod.shimJs !== null ? mod.shimJs : parent.shimJs;
  const mergedShimExtra = mod.shimExtraJs !== null ? mod.shimExtraJs : parent.shimExtraJs;
  const mergedInject = mod.injectJs !== null ? mod.injectJs : parent.injectJs;
  const mergedRoutes = mod.routesFn || parent.routesFn;
  const mergedUniCon = mod.uniConHooks || parent.uniConHooks;
  const mergedTelegram = mod.telegramHooks || parent.telegramHooks;
  console.log(`[module-loader] Module ${modId} extends ${parentId} (merged: ${Object.keys(mergedHooks).length} hooks, shim: ${mergedShim ? "yes" : "no"}, shim-extra: ${mergedShimExtra ? "yes" : "no"})`);
  return {
    config: mergedConfig,
    hooks: mergedHooks,
    shimJs: mergedShim,
    shimExtraJs: mergedShimExtra,
    injectJs: mergedInject,
    routesFn: mergedRoutes,
    uniConHooks: mergedUniCon,
    telegramHooks: mergedTelegram,
    path: dirPath,
    type: "package",
    dirPath: dirPath,
    extends: parentId
  };
}

function loadAll() {
  registry.clear();
  if (!fs.existsSync(MODULES_DIR)) {
    fs.mkdirSync(MODULES_DIR, {
      recursive: true
    });
  }
  const entries = fs.readdirSync(MODULES_DIR, {
    withFileTypes: true
  });
  let loaded = 0;
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const dirPath = path.join(MODULES_DIR, entry.name);
      const mod = loadDirectoryPackage(dirPath);
      if (mod) {
        registry.set(mod.config.id, mod);
        loaded++;
        console.log(`[module-loader] Loaded package: ${mod.config.id} (hooks: ${Object.keys(mod.hooks).length}, shim: ${mod.shimJs ? "yes" : "no"})`);
      }
    }
  }
  console.log(`[module-loader] Loaded ${loaded} module(s) from ${MODULES_DIR}`);
  return loaded;
}

function reloadModule(id) {
  const existing = registry.get(id);
  if (!existing) return false;
  if (existing.type === "package" && existing.dirPath) {
    const mod = loadDirectoryPackage(existing.dirPath);
    if (mod) {
      registry.set(id, mod);
      for (const [childId, child] of registry.entries()) {
        if (childId !== id && child.extends === id) {
          reloadModule(childId);
        }
      }
      return true;
    }
  }
  return false;
}

function getModule(id) {
  return registry.get(id) || null;
}

function getModuleConfig(id) {
  const mod = getModule(id);
  return mod ? mod.config : null;
}

function getModuleHooks(id) {
  const mod = getModule(id);
  if (!mod) return null;
  return Object.keys(mod.hooks).length > 0 ? mod.hooks : null;
}

function getModuleShim(id) {
  const mod = getModule(id);
  return mod && mod.shimJs ? mod.shimJs : null;
}

function getModuleShimExtra(id) {
  const mod = getModule(id);
  return mod && mod.shimExtraJs ? mod.shimExtraJs : null;
}

function getModuleInject(id) {
  const mod = getModule(id);
  return mod && mod.injectJs ? mod.injectJs : null;
}

function getModuleRoutes(id) {
  const mod = getModule(id);
  return mod && mod.routesFn ? mod.routesFn : null;
}

function listModules() {
  return Array.from(registry.values()).map(m => ({
    id: m.config.id,
    name: m.config.name || m.config.id,
    version: m.config.version || "1.0.0",
    api_version: m.config.api_version || 1,
    type: m.type,
    target_url: m.config.target_url || "",
    has_hooks: Object.keys(m.hooks).length > 0,
    has_shim: m.shimJs !== null,
    has_shim_extra: m.shimExtraJs !== null,
    has_inject: m.injectJs !== null,
    extends: m.extends || m.config.extends || null
  }));
}

function callHook(moduleId, hookName, ctx) {
  try {
    const mod = registry.get(moduleId);
    if (!mod || !mod.hooks) return undefined;
    const fn = mod.hooks[hookName];
    if (typeof fn !== "function") return undefined;
    return fn(ctx);
  } catch (err) {
    console.error(`[module:${moduleId}] Hook "${hookName}" failed:`, err.message);
    return undefined;
  }
}

async function callHookAsync(moduleId, hookName, ctx) {
  try {
    const mod = registry.get(moduleId);
    if (!mod || !mod.hooks) return undefined;
    const fn = mod.hooks[hookName];
    if (typeof fn !== "function") return undefined;
    return await fn(ctx);
  } catch (err) {
    console.error(`[module:${moduleId}] Hook "${hookName}" failed:`, err.message);
    return undefined;
  }
}

function hasHook(moduleId, hookName) {
  const hooks = getModuleHooks(moduleId);
  return hooks && typeof hooks[hookName] === "function";
}

function callHookWithConfig(moduleId, hookName, ctx) {
  try {
    const mod = registry.get(moduleId);
    if (!mod || !mod.hooks) return undefined;
    const fn = mod.hooks[hookName];
    if (typeof fn !== "function") return undefined;
    const enrichedCtx = {
      ...ctx,
      moduleConfig: mod.config,
      siteConfig: ctx.siteConfig || ctx.moduleConfig || null
    };
    return fn(enrichedCtx);
  } catch (err) {
    console.error(`[module:${moduleId}] Hook "${hookName}" failed:`, err.message);
    return undefined;
  }
}

async function callHookWithConfigAsync(moduleId, hookName, ctx) {
  try {
    const mod = registry.get(moduleId);
    if (!mod || !mod.hooks) return undefined;
    const fn = mod.hooks[hookName];
    if (typeof fn !== "function") return undefined;
    const enrichedCtx = {
      ...ctx,
      moduleConfig: mod.config,
      siteConfig: ctx.siteConfig || ctx.moduleConfig || null
    };
    return await fn(enrichedCtx);
  } catch (err) {
    console.error(`[module:${moduleId}] Hook "${hookName}" failed:`, err.message);
    return undefined;
  }
}

function getModuleUniCon(id) {
  const mod = getModule(id);
  return mod && mod.uniConHooks ? mod.uniConHooks : null;
}

function getModuleTelegram(id) {
  const mod = getModule(id);
  return mod && mod.telegramHooks ? mod.telegramHooks : null;
}

module.exports = {
  loadAll: loadAll,
  reloadModule: reloadModule,
  getModule: getModule,
  getModuleConfig: getModuleConfig,
  getModuleHooks: getModuleHooks,
  getModuleShim: getModuleShim,
  getModuleShimExtra: getModuleShimExtra,
  getModuleInject: getModuleInject,
  getModuleRoutes: getModuleRoutes,
  getModuleUniCon: getModuleUniCon,
  getModuleTelegram: getModuleTelegram,
  listModules: listModules,
  callHook: callHook,
  callHookAsync: callHookAsync,
  callHookWithConfig: callHookWithConfig,
  callHookWithConfigAsync: callHookWithConfigAsync,
  hasHook: hasHook,
  SUPPORTED_API_VERSIONS: SUPPORTED_API_VERSIONS
};
