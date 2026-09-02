"use strict";

const express = require("express");

const fs = require("fs");

const path = require("path");

const {spawn: spawn} = require("child_process");

const {asyncHandler: asyncHandler} = require("../util");

const {badRequest: badRequest} = require("../middleware/errorHandler");

const {firestore: firestore} = require("../firebase");

const router = express.Router();

const configRef = firestore ? firestore.collection("engine_config") : null;

async function saveConfigToFirebase(key, value) {
  if (!configRef) return;
  try {
    await configRef.doc(key).set({
      value: value,
      updated_at: (new Date).toISOString()
    });
  } catch (err) {
    console.error(`[env] Failed to save ${key} to Firebase:`, err.message);
  }
}

async function loadConfigFromFirebase(key) {
  if (!configRef) return null;
  try {
    const doc = await configRef.doc(key).get();
    if (!doc.exists) return null;
    return doc.data().value || null;
  } catch {
    return null;
  }
}

(async () => {
  if (!configRef) return;
  try {
    const keys = [ "PUBLIC_CF_API_TOKEN", "PUBLIC_CF_ACCOUNT_ID" ];
    for (const key of keys) {
      if (!process.env[key]) {
        const fbValue = await loadConfigFromFirebase(key);
        if (fbValue) {
          process.env[key] = fbValue;
        }
      }
    }
  } catch (err) {
    console.error("[env] Failed to load config from Firebase:", err.message);
  }
})();

function resolveEnvFile() {
  const candidates = [ process.env.UNIDRAL_ENV_PATH, "/repo/.env", path.join(__dirname, "..", "..", ".env") ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const SECRET_KEYS = new Set([ "CF_API_TOKEN", "PUBLIC_CF_API_TOKEN", "FIREBASE_SERVICE_ACCOUNT_JSON", "CLOUDFLARE_CREDENTIALS", "UPSTREAM_PROXY" ]);

const VAR_META = {
  BASE_DOMAIN: {
    label: "Base Domain",
    group: "Domain",
    desc: "Primary domain for subdomain routing"
  },
  EXTRA_BASE_DOMAINS: {
    label: "Extra Base Domains",
    group: "Domain",
    desc: "Comma-separated additional base domains"
  },
  DASHBOARD_SUBDOMAIN: {
    label: "Dashboard Subdomain",
    group: "Domain",
    desc: "Subdomain for the dashboard (e.g. thirdeye)"
  },
  API_SUBDOMAIN: {
    label: "API Subdomain",
    group: "Domain",
    desc: "Subdomain for the API (e.g. debian)"
  },
  RESERVED_SUBDOMAINS: {
    label: "Reserved Subdomains",
    group: "Domain",
    desc: "Comma-separated subdomains that cannot be used for sites"
  },
  NEXT_PUBLIC_API_BASE: {
    label: "Dashboard API Base",
    group: "Dashboard",
    desc: "URL the dashboard uses to reach the API (requires dashboard rebuild)"
  },
  NEXT_PUBLIC_BASE_DOMAIN: {
    label: "Dashboard Base Domain",
    group: "Dashboard",
    desc: "Base domain baked into the dashboard (requires dashboard rebuild)"
  },
  NEXT_PUBLIC_BASE_DOMAINS: {
    label: "Dashboard All Domains",
    group: "Dashboard",
    desc: "Comma-separated domains baked into the dashboard (requires dashboard rebuild)"
  },
  FIREBASE_PROJECT_ID: {
    label: "Firebase Project ID",
    group: "Firebase",
    desc: "Google Cloud/Firebase project ID"
  },
  FIREBASE_SERVICE_ACCOUNT_JSON: {
    label: "Firebase Service Account",
    group: "Firebase",
    desc: "Base64-encoded service account JSON",
    secret: true
  },
  FIRESTORE_EMULATOR_HOST: {
    label: "Firestore Emulator Host",
    group: "Firebase",
    desc: "Optional: Firestore emulator address"
  },
  PUBLIC_CF_API_TOKEN: {
    label: "Cloudflare API Token",
    group: "Cloudflare",
    desc: "CF token used for managing domains and DNS records.",
    secret: true
  },
  PUBLIC_CF_ACCOUNT_ID: {
    label: "Cloudflare Account ID",
    group: "Cloudflare",
    desc: "CF account ID for domain management"
  },
  VPS_IP: {
    label: "VPS IP Address",
    group: "Server",
    desc: "IPv4 address of this VPS (for DNS records)"
  },
  VPS_IPV6: {
    label: "VPS IPv6 Address",
    group: "Server",
    desc: "Optional IPv6 address"
  },
  UPSTREAM_PROXY: {
    label: "Upstream Proxy",
    group: "Server",
    desc: "SOCKS/HTTP proxy for geo-bypass",
    secret: true
  },
  SPOOF_GEO: {
    label: "Spoof Geo",
    group: "Server",
    desc: "Enable geo-spoofing headers (true/false)"
  },
  ALLOW_PRIVATE_TARGETS: {
    label: "Allow Private Targets",
    group: "Server",
    desc: "Allow proxying to private IP ranges"
  },
  MAX_HTML_BYTES: {
    label: "Max HTML Bytes",
    group: "Server",
    desc: "Max HTML response size for injection"
  },
  PROPAGATION_TIMEOUT_MS: {
    label: "Propagation Timeout",
    group: "Server",
    desc: "DNS propagation check timeout in ms"
  },
  PROPAGATION_INTERVAL_MS: {
    label: "Propagation Interval",
    group: "Server",
    desc: "DNS propagation check interval in ms"
  },
  PORT: {
    label: "Server Port",
    group: "Server",
    desc: "Port the engine listens on"
  },
  HOST: {
    label: "Server Host",
    group: "Server",
    desc: "Host interface to bind"
  }
};

function parseEnvFile(content) {
  const vars = [];
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    const meta = VAR_META[key] || {};
    const isSecret = meta.secret || SECRET_KEYS.has(key);
    vars.push({
      key: key,
      value: value,
      label: meta.label || key,
      group: meta.group || "Other",
      desc: meta.desc || "",
      secret: isSecret
    });
  }
  return vars;
}

function buildEnvContent(existingContent, updates) {
  const lines = existingContent.split("\n");
  const updatedKeys = new Set(Object.keys(updates));
  const result = [];
  const seenKeys = new Set;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      result.push(line);
      continue;
    }
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) {
      result.push(line);
      continue;
    }
    const key = trimmed.slice(0, eqIdx).trim();
    if (key in updates) {
      result.push(`${key}=${String(updates[key]).trim()}`);
      seenKeys.add(key);
    } else {
      result.push(line);
    }
  }
  for (const [key, value] of Object.entries(updates)) {
    if (!seenKeys.has(key)) {
      result.push(`${key}=${String(value).trim()}`);
    }
  }
  return result.join("\n");
}

function resolveCloudflareIni() {
  const candidates = [ process.env.CLOUDFLARE_CREDENTIALS, "/root/.secrets/cloudflare.ini" ].filter(Boolean);
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  return null;
}

function maskCloudflareIni(content) {
  return content.split("\n").map(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || !trimmed) return line;
    if (trimmed.includes("=")) {
      const eqIdx = trimmed.indexOf("=");
      const key = trimmed.slice(0, eqIdx).trim();
      return `${key} = ••••••••••••`;
    }
    return line;
  }).join("\n");
}

router.get("/", asyncHandler(async (req, res) => {
  const envPath = resolveEnvFile();
  if (!envPath) {
    res.json({
      vars: [],
      available: false,
      error: ".env file not found"
    });
    return;
  }
  const content = fs.readFileSync(envPath, "utf8");
  const vars = parseEnvFile(content);
  const safeVars = vars.map(v => ({
    ...v,
    masked: v.secret ? "••••••••••••" : v.value,
    isSet: !!v.value
  }));
  let cloudflareIni = {
    available: false,
    content: "",
    masked: "",
    path: ""
  };
  const cfIniPath = resolveCloudflareIni();
  if (cfIniPath) {
    try {
      const cfContent = fs.readFileSync(cfIniPath, "utf8");
      cloudflareIni = {
        available: true,
        content: cfContent,
        masked: maskCloudflareIni(cfContent),
        path: cfIniPath
      };
    } catch {}
  }
  res.json({
    vars: safeVars,
    available: true,
    path: envPath.replace(process.env.HOME || "/home", "~"),
    cloudflareIni: cloudflareIni
  });
}));

const updateEnvHandler = asyncHandler(async (req, res) => {
  const {updates: updates, restart: restart, cloudflareIni: cloudflareIni} = req.body || {};
  if (!updates || typeof updates !== "object") {
    if (!cloudflareIni) {
      throw badRequest("Missing required field: updates (object) or cloudflareIni (string)");
    }
  }
  const envPath = resolveEnvFile();
  if (!envPath) {
    throw badRequest(".env file not found. Ensure the repo is mounted correctly.");
  }
  let backupPath = "";
  if (updates && Object.keys(updates).length > 0) {
    const existingContent = fs.readFileSync(envPath, "utf8");
    const criticalKeys = [ "BASE_DOMAIN", "VPS_IP" ];
    for (const key of criticalKeys) {
      if (key in updates && !updates[key]) {
        throw badRequest(`${key} cannot be empty`);
      }
    }
    backupPath = `${envPath}.bak.${Date.now()}`;
    fs.copyFileSync(envPath, backupPath);
    const newContent = buildEnvContent(existingContent, updates);
    fs.writeFileSync(envPath, newContent, "utf8");
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined && value !== null) {
        process.env[key] = String(value).trim();
      }
    }
    for (const key of [ "PUBLIC_CF_API_TOKEN", "PUBLIC_CF_ACCOUNT_ID" ]) {
      if (key in updates && updates[key]) {
        await saveConfigToFirebase(key, String(updates[key]).trim());
      }
    }
  }
  let cfIniWritten = false;
  let cfIniTempPath = "";
  if (typeof cloudflareIni === "string" && cloudflareIni.trim()) {
    const cfIniPath = resolveCloudflareIni();
    if (cfIniPath) {
      try {
        fs.writeFileSync(cfIniPath, cloudflareIni, "utf8");
        cfIniWritten = true;
      } catch {
        cfIniTempPath = "/repo/.cloudflare.ini.tmp";
        try {
          fs.writeFileSync(cfIniTempPath, cloudflareIni, "utf8");
        } catch (writeErr) {
          cfIniTempPath = path.join(__dirname, "..", "..", ".cloudflare.ini.tmp");
          fs.writeFileSync(cfIniTempPath, cloudflareIni, "utf8");
        }
      }
    } else {
      cfIniTempPath = "/repo/.cloudflare.ini.tmp";
      try {
        fs.writeFileSync(cfIniTempPath, cloudflareIni, "utf8");
      } catch {
        cfIniTempPath = path.join(__dirname, "..", "..", ".cloudflare.ini.tmp");
        fs.writeFileSync(cfIniTempPath, cloudflareIni, "utf8");
      }
    }
  }
  const shouldRestart = restart !== false;
  if (!shouldRestart) {
    res.json({
      ok: true,
      message: "Secrets updated. Restart the server manually to apply changes.",
      backup: backupPath,
      cfIniWritten: cfIniWritten
    });
    return;
  }
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.setHeader("cache-control", "no-cache");
  res.setHeader("x-accel-buffering", "no");
  res.write("[secrets] .env updated successfully.\n");
  if (backupPath) res.write(`[secrets] Backup: ${backupPath}\n`);
  if (cfIniWritten) res.write("[secrets] cloudflare.ini updated directly.\n");
  if (cfIniTempPath) res.write(`[secrets] cloudflare.ini staged at ${cfIniTempPath} - restart script will install it.\n`);
  res.write("[secrets] Restarting containers to apply changes...\n\n");
  const scriptPath = process.env.UPDATE_ENV_SCRIPT || (fs.existsSync("/repo/scripts/update-env-restart.sh") ? "/repo/scripts/update-env-restart.sh" : path.join(__dirname, "..", "..", "scripts", "update-env-restart.sh"));
  if (!fs.existsSync(scriptPath)) {
    res.write("[env] WARNING: Restart script not found. .env was updated but containers were not restarted.\n");
    res.write(`[env] Manually run: docker compose up -d unidral-server\n`);
    res.status(200).end();
    return;
  }
  const bashPath = [ "/usr/bin/bash", "/bin/bash", "/usr/local/bin/bash" ].find(p => {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }) || "bash";
  const child = spawn(bashPath, [ scriptPath ], {
    env: {
      ...process.env
    },
    cwd: path.dirname(scriptPath)
  });
  let exited = false;
  child.stdout.on("data", chunk => res.write(chunk));
  child.stderr.on("data", chunk => res.write(chunk));
  child.on("error", err => {
    if (exited) return;
    exited = true;
    res.write(`\n[secrets] ERROR: Failed to run restart script: ${err.message}\n`);
    if (!res.headersSent) res.status(500);
    res.end();
  });
  child.on("close", code => {
    if (exited) return;
    exited = true;
    if (code === 0) {
      res.write("\n[secrets] Containers restarted. Changes are now live.\n");
    } else {
      res.write(`\n[secrets] Restart script exited with code ${code}. .env was updated but restart may have failed.\n`);
    }
    if (!res.headersSent) res.status(code === 0 ? 200 : 500);
    res.end();
  });
  res.on("close", () => {
    if (child && !child.killed) {
      try {
        child.kill("SIGTERM");
      } catch {}
    }
  });
});

router.put("/", updateEnvHandler);
router.post("/", updateEnvHandler);

module.exports = router;
