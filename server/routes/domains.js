"use strict";

const express = require("express");

const {spawn: spawn} = require("child_process");

const fs = require("fs");

const path = require("path");

const {asyncHandler: asyncHandler} = require("../util");

const {badRequest: badRequest, notFound: notFound} = require("../middleware/errorHandler");

const domains = require("../domains");

const router = express.Router();

router.get("/verify-cf", asyncHandler(async (req, res) => {
  const https = require("https");
  const token = (process.env.PUBLIC_CF_API_TOKEN || "").trim();
  if (!token) {
    return res.json({
      ok: false,
      error: "PUBLIC_CF_API_TOKEN is not set"
    });
  }
  const doRequest = (method, path) => new Promise(resolve => {
    const r = https.request({
      hostname: "api.cloudflare.com",
      port: 443,
      path: `/client/v4${path}`,
      method: method,
      headers: {
        authorization: `Bearer ${token}`
      },
      timeout: 1e4
    }, resp => {
      let body = "";
      resp.on("data", c => body += c);
      resp.on("end", () => {
        try {
          resolve({
            status: resp.statusCode,
            data: JSON.parse(body)
          });
        } catch {
          resolve({
            status: resp.statusCode,
            data: body
          });
        }
      });
    });
    r.on("error", e => resolve({
      error: e.message
    }));
    r.on("timeout", () => {
      r.destroy();
      resolve({
        error: "timeout"
      });
    });
    r.end();
  });
  const results = {};
  const verify = await doRequest("GET", "/user/tokens/verify");
  results.tokenVerify = verify.status === 200 ? "OK" : `Failed (${verify.status})`;
  const zones = await doRequest("GET", "/zones?per_page=1");
  results.listZones = zones.status === 200 ? "OK" : `Failed (${zones.status})`;
  const accounts = await doRequest("GET", "/accounts");
  results.listAccounts = accounts.status === 200 ? "OK" : `Failed (${accounts.status})`;
  res.json({
    ok: true,
    tokenLength: token.length,
    tokenPrefix: token.slice(0, 5),
    results: results,
    raw: {
      verify: verify,
      zones: zones,
      accounts: accounts
    }
  });
}));

router.get("/available", asyncHandler(async (req, res) => {
  await domains.ready();
  const list = domains.getAvailableBaseDomains();
  const current = domains.getCurrentBaseDomain();
  res.json({
    domains: list,
    current: current,
    count: list.length
  });
}));

router.post("/switch-base", asyncHandler(async (req, res) => {
  const {domain: domain} = req.body || {};
  if (!domain || typeof domain !== "string") {
    throw badRequest("Missing required field: domain");
  }
  const available = domains.getAvailableBaseDomains();
  const valid = available.find(d => d.domain === domain.toLowerCase());
  if (!valid) {
    throw badRequest(`Domain "${domain}" is not an available base domain`);
  }
  const current = domains.getCurrentBaseDomain();
  if (domain.toLowerCase() === current) {
    throw badRequest(`"${domain}" is already the active base domain`);
  }
  const scriptPath = process.env.SWITCH_DOMAIN_SCRIPT || (fs.existsSync("/repo/scripts/switch-base-domain.sh") ? "/repo/scripts/switch-base-domain.sh" : path.join(__dirname, "..", "..", "scripts", "switch-base-domain.sh"));
  if (!fs.existsSync(scriptPath)) {
    throw badRequest("Switch script not found. Ensure scripts/switch-base-domain.sh exists.");
  }
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.setHeader("cache-control", "no-cache");
  res.setHeader("x-accel-buffering", "no");
  const bashPath = [ "/usr/bin/bash", "/bin/bash", "/usr/local/bin/bash" ].find(p => {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }) || "bash";
  const child = spawn(bashPath, [ scriptPath, domain.toLowerCase() ], {
    env: {
      ...process.env,
      NEW_BASE_DOMAIN: domain.toLowerCase()
    },
    cwd: path.dirname(scriptPath)
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", chunk => {
    const text = chunk.toString();
    stdout += text;
    res.write(text);
  });
  child.stderr.on("data", chunk => {
    const text = chunk.toString();
    stderr += text;
    res.write(text);
  });
  child.on("error", err => {
    res.write(`\nERROR: Failed to run switch script: ${err.message}\n`);
    if (!res.headersSent) res.status(500);
    res.end();
  });
  child.on("close", code => {
    if (code === 0) {
      res.write(`\n[unidral] Base domain switched to "${domain}" successfully.\n`);
    } else {
      res.write(`\n[unidral] Switch failed (exit ${code}).\n`);
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
}));

router.get("/", asyncHandler(async (req, res) => {
  await domains.ready();
  const list = domains.getDomains();
  res.json({
    domains: list,
    count: list.length
  });
}));

router.get("/logs", asyncHandler(async (req, res) => {
  const options = {};
  if (req.query.domain_id) options.domain_id = req.query.domain_id;
  if (req.query.level) options.level = req.query.level;
  if (req.query.limit) options.limit = Math.min(Number(req.query.limit) || 100, 500);
  const logs = domains.getLogs(options);
  res.json({
    logs: logs,
    count: logs.length
  });
}));

router.get("/vps-ip", asyncHandler(async (req, res) => {
  await domains.ready();
  const https = require("https");
  const currentIp = domains.getVpsIp();
  try {
    const fetchIp = () => new Promise((resolve, reject) => {
      const r = https.request("https://api.ipify.org?format=json", { timeout: 5000, method: "GET" }, resp => {
        let data = "";
        resp.on("data", chunk => { data += chunk; });
        resp.on("end", () => {
          try { resolve(JSON.parse(data).ip); } catch { reject(new Error("Failed to parse IP")); }
        });
      });
      r.on("error", reject);
      r.on("timeout", () => { r.destroy(); reject(new Error("Timeout")); });
      r.end();
    });
    const actualIp = await fetchIp();
    res.json({ ip: actualIp, configuredIp: currentIp, match: actualIp === currentIp });
  } catch (err) {
    res.json({ ip: currentIp, configuredIp: currentIp, match: true, error: err.message });
  }
}));

router.post("/sync-ip", asyncHandler(async (req, res) => {
  await domains.ready();
  let newIp = (req.body && req.body.ip) || null;
  if (!newIp) {
    try {
      const https = require("https");
      newIp = await new Promise((resolve, reject) => {
        const r = https.request("https://api.ipify.org?format=json", { timeout: 5000, method: "GET" }, resp => {
          let data = "";
          resp.on("data", chunk => { data += chunk; });
          resp.on("end", () => {
            try { resolve(JSON.parse(data).ip); } catch { reject(new Error("Failed to parse IP")); }
          });
        });
        r.on("error", reject);
        r.on("timeout", () => { r.destroy(); reject(new Error("Timeout")); });
        r.end();
      });
    } catch (err) {
      newIp = null;
    }
  }
  const result = await domains.syncAllDnsToVps(newIp);
  res.json(result);
}));

router.post("/backfill-mail-posture", asyncHandler(async (req, res) => {
  await domains.ready();
  const result = await domains.backfillMailPostureAll();
  res.json(result);
}));

router.post("/", asyncHandler(async (req, res) => {
  const {domain: domain, proxied: proxied} = req.body || {};
  if (!domain || typeof domain !== "string") {
    throw badRequest("Missing required field: domain");
  }
  const options = {};
  if (typeof proxied === "boolean") options.proxied = proxied;
  options.owner = "operator";
  try {
    const doc = await domains.addDomain(domain, options);
    res.status(201).json(doc);
  } catch (err) {
    if (err.message.includes("already exists") || err.message.includes("Invalid")) {
      throw badRequest(err.message);
    }
    throw err;
  }
}));

router.get("/:id", asyncHandler(async (req, res) => {
  await domains.ready();
  const doc = domains.getDomain(req.params.id);
  if (!doc) throw notFound("Domain not found");
  res.json(doc);
}));

router.post("/:id/verify", asyncHandler(async (req, res) => {
  await domains.ready();
  const doc = domains.getDomain(req.params.id);
  if (!doc) throw notFound("Domain not found");
  try {
    const updated = await domains.verifyDomain(req.params.id);
    res.json(updated);
  } catch (err) {
    if (err.message === "Domain not found") throw notFound(err.message);
    throw err;
  }
}));

router.patch("/:id/proxied", asyncHandler(async (req, res) => {
  const {proxied: proxied} = req.body || {};
  if (typeof proxied !== "boolean") {
    throw badRequest("Missing or invalid field: proxied (must be boolean)");
  }
  await domains.ready();
  const doc = domains.getDomain(req.params.id);
  if (!doc) throw notFound("Domain not found");
  try {
    const updated = await domains.updateProxied(req.params.id, proxied);
    res.json(updated);
  } catch (err) {
    if (err.message === "Domain not found") throw notFound(err.message);
    throw err;
  }
}));

router.delete("/:id", asyncHandler(async (req, res) => {
  await domains.ready();
  const doc = domains.getDomain(req.params.id);
  if (!doc) throw notFound("Domain not found");
  try {
    const removed = await domains.removeDomain(req.params.id);
    res.json({
      removed: true,
      domain: removed.domain
    });
  } catch (err) {
    if (err.message === "Domain not found") throw notFound(err.message);
    throw err;
  }
}));

router.get("/:id/logs", asyncHandler(async (req, res) => {
  const doc = domains.getDomain(req.params.id);
  if (!doc) throw notFound("Domain not found");
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const logs = domains.getLogs({
    domain_id: req.params.id,
    limit: limit
  });
  res.json({
    logs: logs,
    count: logs.length
  });
}));

module.exports = router;
