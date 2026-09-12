"use strict";

const fs = require("fs");

const path = require("path");

const MODULES_DIR = path.join(__dirname, "modules");

let _cache = null;

let _cacheTime = 0;

const CACHE_TTL = 5e3;

function slugify(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "module";
}

function ensureDir() {
  if (!fs.existsSync(MODULES_DIR)) {
    fs.mkdirSync(MODULES_DIR, {
      recursive: true
    });
  }
}

function isPackageDir(dirPath) {
  return fs.existsSync(path.join(dirPath, "module.json"));
}

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

function resolveInheritance(mod, modules, _seen = new Set) {
  if (!mod) return mod;
  const parentId = mod.extends;
  if (!parentId) return mod;
  const modId = mod.id;
  if (_seen.has(modId)) {
    console.warn(`[modules] Circular inheritance detected for ${modId}`);
    return mod;
  }
  _seen.add(modId);
  const parent = modules[parentId];
  if (!parent) {
    console.warn(`[modules] Module ${modId} extends "${parentId}" but parent not found`);
    return mod;
  }
  const resolvedParent = resolveInheritance(parent, modules, _seen);
  const merged = deepMerge(resolvedParent, mod);
  merged.id = mod.id;
  merged.name = mod.name;
  merged.extends = parentId;
  merged.is_default = mod.is_default;
  merged.created_at = mod.created_at;
  merged.updated_at = mod.updated_at;
  return merged;
}

function loadPackageDir(dirPath) {
  const configPath = path.join(dirPath, "module.json");
  if (!fs.existsSync(configPath)) return null;
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (!config.id) return null;
    const hookFiles = {};
    for (const fname of [ "proxy-hooks.js", "modify.js", "shim.js", "shim-extra.js", "inject.js", "uni-con.js", "telegram.js" ]) {
      const fpath = path.join(dirPath, fname);
      if (fs.existsSync(fpath)) {
        hookFiles[fname] = true;
      }
    }
    return {
      ...config,
      _package_type: "package",
      _dirPath: dirPath,
      _hookFiles: hookFiles,
      _has_hooks: Object.keys(hookFiles).length > 0
    };
  } catch (err) {
    console.warn(`[modules] Failed to parse ${configPath}:`, err.message);
    return null;
  }
}

function loadFlatJson(filePath) {
  try {
    const config = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!config.id) return null;
    return {
      ...config,
      _package_type: "flat",
      _filePath: filePath,
      _hookFiles: {},
      _has_hooks: false
    };
  } catch (err) {
    console.warn(`[modules] Failed to parse ${filePath}:`, err.message);
    return null;
  }
}

function loadAll() {
  ensureDir();
  const entries = fs.readdirSync(MODULES_DIR, {
    withFileTypes: true
  });
  const modules = {};
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const dirPath = path.join(MODULES_DIR, entry.name);
      if (isPackageDir(dirPath)) {
        const mod = loadPackageDir(dirPath);
        if (mod) modules[mod.id] = mod;
      }
    }
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".json")) {
      const filePath = path.join(MODULES_DIR, entry.name);
      const mod = loadFlatJson(filePath);
      if (mod && !modules[mod.id]) {
        modules[mod.id] = mod;
      }
    }
  }
  for (const id of Object.keys(modules)) {
    if (modules[id].extends) {
      modules[id] = resolveInheritance(modules[id], modules);
    }
  }
  _cache = modules;
  _cacheTime = Date.now();
  return modules;
}

function getCached() {
  if (!_cache || Date.now() - _cacheTime > CACHE_TTL) {
    return loadAll();
  }
  return _cache;
}

function listModules() {
  const modules = getCached();
  return Object.values(modules).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

function getModule(id) {
  const modules = getCached();
  return modules[id] || null;
}

function createModule(data) {
  ensureDir();
  const id = slugify(data.id || data.name);
  if (!id || id === "." || id === "..") throw new Error("Invalid module id");
  let finalId = id;
  let suffix = 1;
  while (fs.existsSync(path.join(MODULES_DIR, finalId)) || fs.existsSync(path.join(MODULES_DIR, `${finalId}.json`))) {
    finalId = `${id}-${suffix++}`;
  }
  const dirPath = path.join(MODULES_DIR, finalId);
  fs.mkdirSync(dirPath, {
    recursive: true
  });
  const mod = {
    __unidral_module__: true,
    api_version: 1,
    id: finalId,
    name: String(data.name || "").trim(),
    version: String(data.version || "1.0.0"),
    description: String(data.description || "").trim(),
    icon: String(data.icon || "").trim(),
    target_url: String(data.target_url || "").trim(),
    type: String(data.type || "capture"),
    is_default: false,
    upstream_map: data.upstream_map || {},
    auth_landing_html: String(data.auth_landing_html || ""),
    auth_complete_html: String(data.auth_complete_html || ""),
    bitb_front_templates: Array.isArray(data.bitb_front_templates) ? data.bitb_front_templates : [],
    payload_js: String(data.payload_js || ""),
    payload_css: String(data.payload_css || ""),
    injection_point: String(data.injection_point || "body_end"),
    trigger: String(data.trigger || "engine"),
    config_schema: data.config_schema || {},
    extends: data.extends || null,
    created_at: (new Date).toISOString(),
    updated_at: (new Date).toISOString()
  };
  fs.writeFileSync(path.join(dirPath, "module.json"), JSON.stringify(mod, null, 2), "utf8");
  _cache = null;
  return mod;
}

function updateModule(id, updates) {
  const existing = getModule(id);
  if (!existing) return null;
  const mod = {
    ...existing
  };
  const allowed = [ "name", "description", "icon", "target_url", "type", "version", "upstream_map", "auth_landing_html", "auth_complete_html", "bitb_front_templates", "payload_js", "payload_css", "injection_point", "trigger", "config_schema", "extends" ];
  for (const key of allowed) {
    if (updates[key] !== undefined) {
      mod[key] = updates[key];
    }
  }
  mod.updated_at = (new Date).toISOString();
  const saveMod = {
    ...mod
  };
  delete saveMod._package_type;
  delete saveMod._dirPath;
  delete saveMod._filePath;
  delete saveMod._hookFiles;
  delete saveMod._has_hooks;
  if (existing._package_type === "package" && existing._dirPath) {
    fs.writeFileSync(path.join(existing._dirPath, "module.json"), JSON.stringify(saveMod, null, 2), "utf8");
  } else {
    const filePath = existing._filePath || path.join(MODULES_DIR, `${id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(saveMod, null, 2), "utf8");
  }
  _cache = null;
  return mod;
}

function deleteModule(id) {
  const existing = getModule(id);
  if (!existing) return {
    ok: false,
    error: "Module not found"
  };
  if (existing._package_type === "package" && existing._dirPath) {
    fs.rmSync(existing._dirPath, {
      recursive: true,
      force: true
    });
  } else {
    const filePath = existing._filePath || path.join(MODULES_DIR, `${id}.json`);
    fs.unlinkSync(filePath);
  }
  _cache = null;
  return {
    ok: true
  };
}

function duplicateModule(id) {
  const existing = getModule(id);
  if (!existing) return null;
  const newId = slugify(`${existing.name} copy`);
  let finalId = newId;
  let suffix = 1;
  while (fs.existsSync(path.join(MODULES_DIR, finalId)) || fs.existsSync(path.join(MODULES_DIR, `${finalId}.json`))) {
    finalId = `${newId}-${suffix++}`;
  }
  const mod = {
    ...existing,
    id: finalId,
    name: `${existing.name} (copy)`,
    is_default: false,
    created_at: (new Date).toISOString(),
    updated_at: (new Date).toISOString()
  };
  mod.bitb_front_templates = (existing.bitb_front_templates || []).map(t => ({
    ...t
  }));
  delete mod._package_type;
  delete mod._dirPath;
  delete mod._filePath;
  delete mod._hookFiles;
  delete mod._has_hooks;
  const dirPath = path.join(MODULES_DIR, finalId);
  fs.mkdirSync(dirPath, {
    recursive: true
  });
  fs.writeFileSync(path.join(dirPath, "module.json"), JSON.stringify(mod, null, 2), "utf8");
  if (existing._dirPath && fs.existsSync(existing._dirPath)) {
    for (const fname of [ "proxy-hooks.js", "modify.js", "shim.js", "shim-extra.js", "inject.js", "uni-con.js", "telegram.js" ]) {
      const srcPath = path.join(existing._dirPath, fname);
      if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, path.join(dirPath, fname));
      }
    }
  }
  _cache = null;
  return mod;
}

function importModule(data) {
  if (!data || !data.name) return {
    ok: false,
    error: "Module name is required"
  };
  if (!data.target_url && data.type !== "inject") return {
    ok: false,
    error: "target_url is required"
  };
  const mod = createModule({
    ...data,
    id: data.id || slugify(data.name),
    is_default: false
  });
  return {
    ok: true,
    module: mod
  };
}

function importZip(zipBuffer, expectedFilename, validateFn) {
  if (validateFn) {
    const result = validateFn(zipBuffer, expectedFilename);
    if (!result.ok) return result;
  }
  const {listZipEntries: listZipEntries, extractEntry: extractEntry} = require("./module-validator");
  const entries = listZipEntries(zipBuffer);
  if (!entries) return {
    ok: false,
    error: "Could not read ZIP central directory"
  };
  const {findModuleJson: findModuleJson} = require("./module-validator");
  const moduleJsonEntry = findModuleJson(entries);
  if (!moduleJsonEntry) return {
    ok: false,
    error: "No module.json found in ZIP"
  };
  const manifestBuffer = extractEntry(zipBuffer, moduleJsonEntry);
  if (!manifestBuffer) return {
    ok: false,
    error: "Could not extract module.json"
  };
  let manifest;
  try {
    manifest = JSON.parse(manifestBuffer.toString("utf8"));
  } catch (err) {
    return {
      ok: false,
      error: `module.json is not valid JSON: ${err.message}`
    };
  }
  const moduleId = path.basename(String(manifest.id || "")).replace(/[\\\/..]+/g, "_").trim();
  if (!moduleId || moduleId === "." || moduleId === "..") return {
    ok: false,
    error: "Module has invalid id"
  };
  let prefix = "";
  if (moduleJsonEntry.name.includes("/")) {
    prefix = moduleJsonEntry.name.replace(/module\.json$/, "");
  }
  ensureDir();
  const dirPath = path.join(MODULES_DIR, moduleId);
  if (fs.existsSync(dirPath)) {
    try {
      fs.rmSync(dirPath, {
        recursive: true,
        force: true
      });
    } catch (e) {
      return {
        ok: false,
        error: `Module "${moduleId}" already exists and could not be overwritten: ${e.message}`
      };
    }
  }
  try {
    fs.mkdirSync(dirPath, {
      recursive: true
    });
  } catch (e) {
    return {
      ok: false,
      error: `Could not create module directory: ${e.message}`
    };
  }
  const allowedFiles = [ "module.json", "proxy-hooks.js", "modify.js", "shim.js", "shim-extra.js", "inject.js", "uni-con.js", "telegram.js" ];
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    let relPath = entry.name;
    if (prefix && relPath.startsWith(prefix)) {
      relPath = relPath.slice(prefix.length);
    }
    if (!allowedFiles.includes(relPath)) continue;
    const data = extractEntry(zipBuffer, entry);
    if (data) {
      fs.writeFileSync(path.join(dirPath, relPath), data);
    }
  }
  _cache = null;
  return {
    ok: true,
    module: manifest
  };
}

function getHookFile(moduleId, filename) {
  const mod = getModule(moduleId);
  if (!mod || mod._package_type !== "package" || !mod._dirPath) return null;
  const allowed = [ "proxy-hooks.js", "modify.js", "shim.js", "shim-extra.js", "inject.js", "uni-con.js", "telegram.js", "routes.js" ];
  if (!allowed.includes(filename)) return null;
  const fpath = path.join(mod._dirPath, filename);
  if (!fs.existsSync(fpath)) return null;
  return fs.readFileSync(fpath, "utf8");
}

function listModuleFiles(moduleId) {
  const mod = getModule(moduleId);
  if (!mod || mod._package_type !== "package" || !mod._dirPath) return null;
  const entries = fs.readdirSync(mod._dirPath);
  const files = [];
  for (const name of entries) {
    const fpath = path.join(mod._dirPath, name);
    const stat = fs.statSync(fpath);
    if (stat.isFile()) {
      const ext = path.extname(name).slice(1).toLowerCase();
      files.push({
        name: name,
        size: stat.size,
        ext: ext,
        type: ext === "js" ? "javascript" : ext === "json" ? "json" : ext === "md" ? "markdown" : ext === "txt" ? "text" : ext === "html" ? "html" : ext === "css" ? "css" : "other"
      });
    }
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  return files;
}

function getModuleFile(moduleId, filename) {
  const mod = getModule(moduleId);
  if (!mod || mod._package_type !== "package" || !mod._dirPath) return null;
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) return null;
  const fpath = path.join(mod._dirPath, filename);
  if (!fs.existsSync(fpath)) return null;
  const stat = fs.statSync(fpath);
  if (!stat.isFile()) return null;
  if (stat.size > 500 * 1024) return {
    truncated: true,
    size: stat.size
  };
  return {
    content: fs.readFileSync(fpath, "utf8"),
    size: stat.size
  };
}

function saveHookFile(moduleId, filename, content) {
  const mod = getModule(moduleId);
  if (!mod) return {
    ok: false,
    error: "Module not found"
  };
  if (mod._package_type !== "package" || !mod._dirPath) {
    return {
      ok: false,
      error: "Module is not a directory package — cannot save hooks"
    };
  }
  const allowed = [ "proxy-hooks.js", "modify.js", "shim.js", "shim-extra.js", "inject.js", "uni-con.js", "telegram.js", "routes.js" ];
  if (!allowed.includes(filename)) {
    return {
      ok: false,
      error: `File "${filename}" is not a valid hook file`
    };
  }
  fs.writeFileSync(path.join(mod._dirPath, filename), content, "utf8");
  return {
    ok: true
  };
}

function getModuleUsage(moduleId, store) {
  if (!store || typeof store.getSites !== "function") return [];
  const sites = store.getSites();
  return sites.filter(s => s.session_capture && s.session_capture_config && s.session_capture_config.module_id === moduleId).map(s => ({
    id: s.id,
    subdomain: s.subdomain
  }));
}

function exportZip(moduleId) {
  const mod = getModule(moduleId);
  if (!mod) return {
    ok: false,
    error: `Module "${moduleId}" not found`
  };
  if (mod._package_type !== "package" || !mod._dirPath) {
    return {
      ok: false,
      error: "Module is not a directory package — cannot export as ZIP"
    };
  }
  const allowedFiles = [ "module.json", "proxy-hooks.js", "modify.js", "shim.js", "shim-extra.js", "inject.js", "uni-con.js", "telegram.js" ];
  const files = [];
  for (const fname of allowedFiles) {
    const fpath = path.join(mod._dirPath, fname);
    if (fs.existsSync(fpath)) {
      files.push({
        name: fname,
        data: fs.readFileSync(fpath)
      });
    }
  }
  if (files.length === 0) {
    return {
      ok: false,
      error: "No files found to export"
    };
  }
  const zipBuffer = createZip(files);
  return {
    ok: true,
    buffer: zipBuffer,
    filename: `${moduleId}.zip`
  };
}

function createZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const file of files) {
    const nameBuf = Buffer.from(file.name, "utf8");
    const data = file.data;
    const crc = crc32(data);
    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(67324752, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuf.copy(localHeader, 30);
    localParts.push(localHeader, data);
    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(33639248, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    nameBuf.copy(centralHeader, 46);
    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }
  const centralDir = Buffer.concat(centralParts);
  const centralDirOffset = offset;
  const centralDirSize = centralDir.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(101010256, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(centralDirOffset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([ ...localParts, centralDir, eocd ]);
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 4294967295;
  for (let i = 0; i < buf.length; i++) {
    crc = crc >>> 8 ^ crcTable[(crc ^ buf[i]) & 255];
  }
  return (crc ^ 4294967295) >>> 0;
}

module.exports = {
  listModules: listModules,
  getModule: getModule,
  createModule: createModule,
  updateModule: updateModule,
  deleteModule: deleteModule,
  duplicateModule: duplicateModule,
  importModule: importModule,
  importZip: importZip,
  exportZip: exportZip,
  getHookFile: getHookFile,
  saveHookFile: saveHookFile,
  listModuleFiles: listModuleFiles,
  getModuleFile: getModuleFile,
  getModuleUsage: getModuleUsage,
  slugify: slugify,
  loadAll: loadAll
};
