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
  const candidates = [
    process.env.UNIDRAL_LOCK_PATH,
    "/repo/.installed",
    path.join(__dirname, "..", "..", ".installed"),
    path.join(__dirname, "..", ".installed")
  ].filter(Boolean);

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return path.join(__dirname, "..", "..", ".installed");
}

function isInstalled() {
  const lockFile = getInstalledLockPath();
  return fs.existsSync(lockFile);
}

function resolveEnvPath() {
  const candidates = [
    process.env.UNIDRAL_ENV_PATH,
    "/repo/.env",
    path.join(__dirname, "..", "..", ".env"),
    path.join(__dirname, "..", ".env")
  ].filter(Boolean);

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return path.join(__dirname, "..", "..", ".env");
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
    FIREBASE_SERVICE_ACCOUNT_JSON: cleanFbSaJson,
    UNICON_ENABLED: "true",
    WARP_SOCKS5: "socks5://172.18.0.1:40000",
    UNICON_WARP_SOCKS5: "socks5://172.18.0.1:40000"
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

  const iniContent = `dns_cloudflare_api_token = ${cleanCfToken}\n`;
  const iniPath = process.env.CLOUDFLARE_CREDENTIALS || "/repo/.cloudflare.ini";
  try {
    fs.writeFileSync(iniPath, iniContent, "utf8");
  } catch (err) {
    console.warn("[setup] Failed to write cloudflare.ini:", err.message);
  }

  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.write("[setup] Configuration saved to .env.\n");
  res.write("[setup] Created .installed lock file.\n");
  res.write("[setup] Wrote cloudflare.ini for certbot.\n\n");

  const bashPath = [ "/usr/bin/bash", "/bin/bash", "/usr/local/bin/bash" ].find(p => {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }) || "bash";

  const repoDir = process.env.UNIDRAL_REPO_PATH || "/repo";
  const composeDir = fs.existsSync("/repo") ? "/repo" : path.join(__dirname, "..", "..");

  res.write("[setup] Step 1/5: Restarting unidral-server with new configuration...\n");
  await runCommand(res, bashPath, ["-c", `cd "${composeDir}" && docker compose up -d unidral-server`], composeDir);
  res.write("\n");

  res.write("[setup] Step 2/5: Issuing wildcard SSL certificate via Let's Encrypt...\n");
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

  res.write("[setup] Step 3/5: Starting nginx (production mode)...\n");
  await runCommand(res, bashPath, ["-c", `cd "${composeDir}" && docker compose --profile production up -d nginx`], composeDir);
  res.write("\n");

  res.write("[setup] Step 4/4: Installing certificate renewal cron job...\n");
  try {
    const cronContent = `0 3 1 * * ${repoDir}/scripts/issue-wildcard-certs.sh >> /var/log/unidral-certs.log 2>&1\n`;
    fs.writeFileSync("/etc/cron.d/unidral-certs", cronContent, "utf8");
    res.write("[setup] Cron job installed: certs renew on the 1st of each month at 3 AM.\n");
  } catch (err) {
    res.write(`[setup] WARNING: Could not install cron job: ${err.message}\n`);
    res.write(`[setup] Add manually: 0 3 1 * * ${repoDir}/scripts/issue-wildcard-certs.sh\n`);
  }

  res.write("\n");
  res.write("[setup] ========================================\n");
  res.write("[setup]  Installation complete!\n");
  res.write("[setup] ========================================\n");
  res.write(`[setup] Dashboard: https://${cleanDashSub}.${cleanBaseDomain}\n`);
  res.write(`[setup] API:       https://${cleanApiSub}.${cleanBaseDomain}\n`);
  res.end();
}));

function runCommand(res, cmd, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: cwd || undefined,
      env: { ...process.env, COMPOSE_PROFILES: "production" }
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
