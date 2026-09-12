"use strict";

const http = require("http");

const https = require("https");

const store = require("./db");

const INTERVAL_MS = Number(process.env.HEALTH_CHECK_INTERVAL_MS || 6e4);

const TIMEOUT_MS = Number(process.env.HEALTH_CHECK_TIMEOUT_MS || 8e3);

const DEGRADED_MS = Number(process.env.HEALTH_DEGRADED_MS || 4e3);

const HEALTH_CONCURRENCY = Number(process.env.HEALTH_CHECK_CONCURRENCY || 10);

const results = new Map;

let timer = null;

let running = false;

function probe(targetUrl) {
  return new Promise(resolve => {
    let url;
    try {
      url = new URL(targetUrl);
    } catch {
      resolve({
        ok: false,
        error: "invalid target_url"
      });
      return;
    }
    const transport = url.protocol === "http:" ? http : https;
    const started = Date.now();
    const HEALTH_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    const req = transport.request({
      method: "HEAD",
      hostname: url.hostname,
      port: url.port || (url.protocol === "http:" ? 80 : 443),
      path: url.pathname || "/",
      timeout: TIMEOUT_MS,
      headers: {
        "user-agent": HEALTH_UA,
        accept: "*/*"
      },
      rejectUnauthorized: false
    }, res => {
      res.resume();
      resolve({
        ok: res.statusCode < 500,
        statusCode: res.statusCode,
        latencyMs: Date.now() - started
      });
    });
    req.on("timeout", () => {
      req.destroy();
      resolve({
        ok: false,
        error: "timeout",
        latencyMs: Date.now() - started
      });
    });
    req.on("error", err => {
      resolve({
        ok: false,
        error: err.code || err.message,
        latencyMs: Date.now() - started
      });
    });
    req.end();
  });
}

function classify(result) {
  if (!result.ok) return "down";
  if (result.latencyMs > DEGRADED_MS) return "degraded";
  return "up";
}

async function checkAll() {
  if (running) return;
  running = true;
  try {
    const sites = store.getSites();
    let idx = 0;
    async function worker() {
      while (idx < sites.length) {
        const site = sites[idx++];
        const result = await probe(site.target_url);
        results.set(site.id, {
          status: classify(result),
          latencyMs: result.latencyMs === undefined ? null : result.latencyMs,
          statusCode: result.statusCode === undefined ? null : result.statusCode,
          error: result.error || null,
          checkedAt: (new Date).toISOString()
        });
      }
    }
    const workers = Array.from({
      length: Math.min(HEALTH_CONCURRENCY, sites.length)
    }, worker);
    await Promise.all(workers);
  } finally {
    running = false;
  }
}

function start() {
  if (timer) return;
  store.ready().then(() => checkAll()).catch(() => {});
  timer = setInterval(checkAll, INTERVAL_MS);
  timer.unref();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

function statusFor(siteId) {
  return results.get(siteId) || {
    status: "unknown",
    latencyMs: null,
    statusCode: null,
    error: null,
    checkedAt: null
  };
}

function all() {
  const out = {};
  for (const [id, value] of results) out[id] = value;
  return out;
}

function getStatus() {
  const sites = store.getSites();
  let up = 0, degraded = 0, down = 0, unknown = 0;
  for (const site of sites) {
    const r = results.get(site.id);
    if (!r) { unknown++; continue; }
    if (r.status === "up") up++;
    else if (r.status === "degraded") degraded++;
    else if (r.status === "down") down++;
    else unknown++;
  }
  return {
    total: sites.length,
    up, degraded, down, unknown,
    checkedAt: new Date().toISOString()
  };
}

module.exports = {
  start: start,
  stop: stop,
  statusFor: statusFor,
  all: all,
  getStatus: getStatus
};
