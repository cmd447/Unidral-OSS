"use strict";

const express = require("express");
const fs = require("fs");
const path = require("path");
const https = require("https");
const dns = require("dns").promises;
const { spawn } = require("child_process");
const { asyncHandler } = require("../util");
const { badRequest, forbidden } = require("../middleware/errorHandler");

const router = express.Router();

function getInstalledLockPath() {
  if (process.env.UNIDRAL_LOCK_PATH) return process.env.UNIDRAL_LOCK_PATH;
  if (fs.existsSync("/repo")) return "/repo/.installed";
  const candidates = [
    path.join(__dirname, "..", "..", ".installed"),
    path.join(__dirname, "..", ".installed")
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

function isInstalled() {
  const lockFile = getInstalledLockPath();
  return fs.existsSync(lockFile);
}

function resolveEnvPath() {
  if (process.env.UNIDRAL_ENV_PATH) return process.env.UNIDRAL_ENV_PATH;
  if (fs.existsSync("/repo")) return "/repo/.env";
  const candidates = [
    path.join(__dirname, "..", "..", ".env"),
    path.join(__dirname, "..", ".env")
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

function buildEnvContent(existingContent, updates) {
  const lines = existingContent ? existingContent.split("\n") : [];
  const seenKeys = new Set();
  const result = [];

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
    if (!seenKeys.has(key) && value !== undefined && value !== null) {
      result.push(`${key}=${String(value).trim()}`);
    }
  }

  return result.join("\n");
}

router.get("/status", asyncHandler(async (req, res) => {
  const installed = isInstalled();
  const isConfigured = installed || Boolean(
    process.env.BASE_DOMAIN &&
    process.env.BASE_DOMAIN !== "example.com"
  );

  const setupKeyConfigured = Boolean(process.env.SETUP_KEY);

  res.json({
    installed: installed,
    isConfigured: isConfigured,
    setupKeyConfigured: setupKeyConfigured,
    baseDomain: process.env.BASE_DOMAIN || "",
    dashboardSubdomain: process.env.DASHBOARD_SUBDOMAIN || "thirdeye",
    apiSubdomain: process.env.API_SUBDOMAIN || "debian"
  });
}));

router.get("/verify-dns", asyncHandler(async (req, res) => {
  const domain = (req.query.domain || "").trim().toLowerCase();
  const expectedIp = (req.query.ip || "").trim();

  if (!domain) {
    throw badRequest("Domain is required.");
  }
  if (!expectedIp) {
    throw badRequest("VPS IP is required.");
  }

  const probe = `unidral-setup-check-${Date.now().toString(36)}.${domain}`;

  let resolvedIp = null;
  try {
    const addrs = await dns.resolve4(probe);
    if (addrs.length > 0) {
      resolvedIp = addrs[0];
    }
  } catch (err) {
    try {
      const apexAddrs = await dns.resolve4(domain);
      if (apexAddrs.length > 0) {
        resolvedIp = apexAddrs[0];
      }
    } catch {
      resolvedIp = null;
    }
  }

  const matches = resolvedIp === expectedIp;

  res.json({
    matches: matches,
    resolvedIp: resolvedIp,
    expectedIp: expectedIp,
    domain: domain,
    probe: probe
  });
}));

router.post("/validate-cloudflare", asyncHandler(async (req, res) => {
  const { token } = req.body || {};
  if (!token || typeof token !== "string") {
    throw badRequest("Cloudflare API token is required");
  }

  const cleanToken = token.trim();

  const verifyUrl = "https://api.cloudflare.com/client/v4/user/tokens/verify";

  const options = {
    headers: {
      "Authorization": `Bearer ${cleanToken}`,
      "User-Agent": "Unidral-Engine/1.0"
    },
    timeout: 10000
  };

  https.get(verifyUrl, options, (cfRes) => {
    let data = "";
    cfRes.on("data", chunk => data += chunk);
    cfRes.on("end", () => {
      try {
        const json = JSON.parse(data);
        if (json.success && json.result && json.result.status === "active") {
          return res.json({
            valid: true,
            message: "Cloudflare API token verified",
            status: json.result.status
          });
        }
        return res.status(400).json({
          valid: false,
          message: json.errors && json.errors[0] ? json.errors[0].message : "Invalid Cloudflare token"
        });
      } catch (e) {
        return res.status(500).json({
          valid: false,
          message: "Failed to parse Cloudflare response"
        });
      }
    });
  }).on("error", (err) => {
    res.status(500).json({
      valid: false,
      message: `Network error verifying token: ${err.message}`
    });
  });
}));

router.post("/initialize", asyncHandler(async (req, res) => {
  if (isInstalled()) {
    throw forbidden("Unidral Engine is already installed and locked.");
  }

  const requiredSetupKey = process.env.SETUP_KEY;
  if (requiredSetupKey) {
    const providedKey = req.body.setupKey || req.query.key || req.headers["x-setup-key"];
    if (!providedKey || providedKey !== requiredSetupKey) {
      throw forbidden("Invalid or missing SETUP_KEY.");
    }
  }

  const {
    baseDomain,
    dashboardSubdomain,
    apiSubdomain,
    cfToken,
    cfAccountId,
    vpsIp,
    firebaseProjectId,
    firebaseServiceAccountJson
  } = req.body || {};

  if (!baseDomain || typeof baseDomain !== "string" || !baseDomain.trim()) {
    throw badRequest("Base Domain is required.");
  }
  if (!cfToken || typeof cfToken !== "string" || !cfToken.trim()) {
    throw badRequest("Cloudflare API token is required.");
  }
  if (!cfAccountId || typeof cfAccountId !== "string" || !cfAccountId.trim()) {
    throw badRequest("Cloudflare Account ID is required.");
  }
  if (!vpsIp || typeof vpsIp !== "string" || !vpsIp.trim()) {
    throw badRequest("VPS IP address is required.");
  }
  if (!firebaseProjectId || typeof firebaseProjectId !== "string" || !firebaseProjectId.trim()) {
    throw badRequest("Firebase Project ID is required.");
  }
  if (!firebaseServiceAccountJson || typeof firebaseServiceAccountJson !== "string" || !firebaseServiceAccountJson.trim()) {
    throw badRequest("Firebase Service Account JSON is required.");
  }

  const cleanBaseDomain = baseDomain.trim().toLowerCase();
  const cleanDashSub = (dashboardSubdomain || "thirdeye").trim().toLowerCase();
  const cleanApiSub = (apiSubdomain || "debian").trim().toLowerCase();
  const cleanCfToken = cfToken.trim();
  const cleanCfAccount = cfAccountId.trim();
  const cleanVpsIp = vpsIp.trim();
  const cleanFbProject = firebaseProjectId.trim();
  let cleanFbSaJson = firebaseServiceAccountJson.trim();

  if (cleanFbSaJson.startsWith("{")) {
    cleanFbSaJson = Buffer.from(cleanFbSaJson).toString("base64");
  }

  const envUpdates = {
    BASE_DOMAIN: cleanBaseDomain,
    DASHBOARD_SUBDOMAIN: cleanDashSub,
    API_SUBDOMAIN: cleanApiSub,
    RESERVED_SUBDOMAINS: `${cleanDashSub},${cleanApiSub},www,api`,
    CF_API_TOKEN: cleanCfToken,
    CF_ACCOUNT_ID: cleanCfAccount,
    PUBLIC_CF_API_TOKEN: cleanCfToken,
    PUBLIC_CF_ACCOUNT_ID: cleanCfAccount,
    VPS_IP: cleanVpsIp,
    FIREBASE_PROJECT_ID: cleanFbProject,
    FIREBASE_SERVICE_ACCOUNT_JSON: cleanFbSaJson
  };

  const envPath = resolveEnvPath();
  let existingContent = "";
  if (fs.existsSync(envPath)) {
    existingContent = fs.readFileSync(envPath, "utf8");
  }

  const newEnvContent = buildEnvContent(existingContent, envUpdates);
  fs.writeFileSync(envPath, newEnvContent, "utf8");

  for (const [k, v] of Object.entries(envUpdates)) {
    if (v) process.env[k] = v;
  }

  const lockPath = getInstalledLockPath();
  fs.writeFileSync(
    lockPath,
    `INSTALLED_AT=${new Date().toISOString()}\nBASE_DOMAIN=${cleanBaseDomain}\n`,
    "utf8"
  );

  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.write("[setup] Configuration saved to .env.\n");
  res.write("[setup] Created .installed lock file.\n\n");

  const bashPath = [ "/usr/bin/bash", "/bin/bash", "/usr/local/bin/bash" ].find(p => {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }) || "bash";

  const inContainer = fs.existsSync("/.dockerenv") || process.env.RUNNING_IN_DOCKER === "true";

  res.write("[setup] Step 1/2: Issuing wildcard SSL certificate via Let's Encrypt...\n");
  const certScript = fs.existsSync("/repo/scripts/issue-wildcard-certs.sh")
    ? "/repo/scripts/issue-wildcard-certs.sh"
    : path.join(__dirname, "..", "..", "scripts", "issue-wildcard-certs.sh");
  if (fs.existsSync(certScript)) {
    await runCommand(res, bashPath, [certScript], path.dirname(certScript));
  } else {
    res.write("[setup] WARNING: issue-wildcard-certs.sh not found. Skipping cert issuance.\n");
    res.write("[setup] Run it manually after setup: ./scripts/issue-wildcard-certs.sh\n");
  }
  res.write("\n");

  res.write("[setup] Step 2/2: Switching to production mode...\n");
  if (inContainer) {
    const restartChild = spawn(bashPath, ["-c", "sleep 3; docker restart unidral-nginx"], {
      detached: true,
      stdio: "ignore"
    });
    restartChild.unref();
    res.write("[setup] nginx restarts in a few seconds with the production TLS config.\n");
    res.write("[setup] The engine restarts itself to load Firebase and domain config.\n");
  } else {
    res.write("[setup] Not running in Docker - restart the stack manually to apply the new config.\n");
  }

  res.write("\n");
  res.write("[setup] ========================================\n");
  res.write("[setup]  Installation complete!\n");
  res.write("[setup] ========================================\n");
  res.write(`[setup] Dashboard: https://${cleanDashSub}.${cleanBaseDomain}\n`);
  res.write(`[setup] API:       https://${cleanApiSub}.${cleanBaseDomain}\n`);
  res.write("[setup] Give the services ~10 seconds to come back up, then open the dashboard.\n");
  res.end();

  if (inContainer) {
    setTimeout(() => process.exit(0), 5000).unref();
  }
}));

function runCommand(res, cmd, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: cwd || undefined
    });
    child.stdout.on("data", chunk => res.write(chunk));
    child.stderr.on("data", chunk => res.write(chunk));
    child.on("close", () => resolve());
    child.on("error", (err) => {
      res.write(`[setup] Command error: ${err.message}\n`);
      resolve();
    });
  });
}

module.exports = router;
