"use strict";

const express = require("express");

const {spawn: spawn} = require("child_process");

const fs = require("fs");

const path = require("path");

const {asyncHandler: asyncHandler} = require("../util");

const domains = require("../domains");

const router = express.Router();

let certRunning = false;

function resolveScriptPath() {
  if (process.env.CERT_SCRIPT) return process.env.CERT_SCRIPT;
  if (fs.existsSync("/repo/scripts/issue-wildcard-certs.sh")) {
    return "/repo/scripts/issue-wildcard-certs.sh";
  }
  return path.join(__dirname, "..", "..", "scripts", "issue-wildcard-certs.sh");
}

function findBash() {
  const candidates = [ "/usr/bin/bash", "/bin/bash", "/usr/local/bin/bash" ];
  for (const p of candidates) {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {}
  }
  return null;
}

function isInsideContainer() {
  try {
    return fs.existsSync("/.dockerenv") || process.env.RUNNING_IN_DOCKER === "true";
  } catch {
    return false;
  }
}

router.post("/reissue", asyncHandler(async (req, res) => {
  if (certRunning) {
    res.status(409).json({
      error: "Certificate reissue is already in progress. Wait for it to finish before trying again."
    });
    return;
  }
  certRunning = true;
  const scriptPath = resolveScriptPath();
  const args = req.body && req.body.dryRun ? [ "--dry-run" ] : [];
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.setHeader("cache-control", "no-cache");
  res.setHeader("x-accel-buffering", "no");
  let child;
  try {
    const bashPath = findBash() || "bash";
    if (isInsideContainer()) {
      const scriptInContainer = "/repo/scripts/issue-wildcard-certs.sh";
      if (!fs.existsSync(scriptInContainer)) {
        res.write(`ERROR: Cert script not found at ${scriptInContainer}\n`);
        res.write("Make sure the repo is mounted at /repo in the container.\n");
        res.status(500).end();
        return;
      }
      const cfCreds = process.env.CLOUDFLARE_CREDENTIALS || "/root/.secrets/cloudflare.ini";
      const publicCfToken = domains.getPublicCfToken();
      const scriptEnv = {
        ...process.env,
        BASE_DOMAIN: process.env.BASE_DOMAIN || "",
        EXTRA_BASE_DOMAINS: process.env.EXTRA_BASE_DOMAINS || "",
        API_SUBDOMAIN: process.env.API_SUBDOMAIN || "debian",
        CLOUDFLARE_CREDENTIALS: cfCreds,
        COMPOSE_DIR: "/repo",
        PUBLIC_CF_API_TOKEN: publicCfToken,
        PATH: process.env.PATH || "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
      };
      res.write("[unidral] Running cert script...\n");
      child = spawn(bashPath, [ scriptInContainer, ...args ], {
        env: scriptEnv,
        cwd: "/repo"
      });
    } else {
      child = spawn(bashPath, [ scriptPath, ...args ], {
        env: {
          ...process.env,
          PATH: process.env.PATH || "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
        },
        cwd: path.dirname(scriptPath)
      });
    }
  } catch (err) {
    certRunning = false;
    res.write(`ERROR: Failed to spawn cert script: ${err.message}\n`);
    res.status(500).end();
    return;
  }
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
    certRunning = false;
    res.write(`\nERROR: Failed to run cert script: ${err.message}\n`);
    if (!res.headersSent) res.status(500);
    res.end();
  });
  child.on("close", (code, signal) => {
    certRunning = false;
    if (code === 0) {
      res.write(`\n[unidral] Certificate reissue completed successfully (exit ${code}).\n`);
    } else {
      const detail = signal ? `killed by signal ${signal}` : `exit ${code}`;
      res.write(`\n[unidral] Certificate reissue FAILED (${detail}).\n`);
      if (stderr && !stdout) {
        res.write(`\nstderr:\n${stderr}\n`);
      }
    }
    res.write("\n[unidral] Restarting nginx to pick up new certs...\n");
    if (!res.headersSent) res.status(code === 0 ? 200 : 500);
    const restartNginx = () => {
      const {exec: exec} = require("child_process");
      exec("docker restart unidral-nginx", {
        timeout: 3e4
      }, err => {
        if (err) {
          console.error("[unidral] docker restart failed, trying docker compose...", err.message);
          exec("docker compose restart nginx", {
            timeout: 3e4,
            cwd: "/repo"
          }, e2 => {
            if (e2) {
              console.error("[unidral] Could not restart nginx. Manual restart needed:", e2.message);
            }
          });
        }
      });
    };
    res.end(() => {
      setTimeout(restartNginx, 2e3);
    });
  });
  res.on("close", () => {
    if (child && !child.killed) {
      try {
        child.kill("SIGTERM");
      } catch {}
    }
  });
}));

router.post("/restart-nginx", asyncHandler(async (req, res) => {
  const {exec: exec} = require("child_process");
  exec("docker restart unidral-nginx", {
    timeout: 3e4
  }, (err, stdout, stderr) => {
    if (err) {
      console.error("[unidral] docker restart failed, trying docker compose...", err.message);
      exec("docker compose restart nginx", {
        timeout: 3e4,
        cwd: "/repo"
      }, e2 => {
        if (e2) {
          console.error("[unidral] Could not restart nginx:", e2.message);
        }
      });
    }
  });
  res.json({
    ok: true,
    message: "nginx restart initiated"
  });
}));

module.exports = router;
