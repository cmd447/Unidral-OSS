"use strict";

require("dotenv").config();

const http = require("http");
const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");

const store = require("./db");
const { asyncHandler } = require("./util");
const health = require("./health");
const domains = require("./domains");

const sitesRouter = require("./routes/sites");
const rulesRouter = require("./routes/rules");
const certsRouter = require("./routes/certs");
const domainsRouter = require("./routes/domains");
const envRouter = require("./routes/env");
const setupRouter = require("./routes/setup");
const engineRouter = require("./routes/engine");
const modulesRouter = require("./routes/modules");

const moduleLoader = require("./module-loader");
const { resolveModuleConfig } = require("./module-resolver");

const { HttpError, errorHandler } = require("./middleware/errorHandler");

const {
  BASE_DOMAIN,
  resolveSite,
  resolveHost,
  targetUrlFor,
  proxyMiddleware,
  preflightShortCircuit,
  unknownHostPage,
} = require("./proxy");

const { buildContext, rewriteHtml } = require("./modifyResponse");
const modifyResponse = require("./modifyResponse");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const DASHBOARD_SUBDOMAIN = process.env.DASHBOARD_SUBDOMAIN || "dashboard";
const API_SUBDOMAIN = process.env.API_SUBDOMAIN || "api";

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

app.use("/__unidral", express.static(path.join(__dirname, "public"), {
  maxAge: "1h",
  setHeaders: (res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
  },
}));

app.get("/__unidral/health", (req, res) => {
  res.json(health.getStatus());
});

const api = express.Router();
api.use("/sites", sitesRouter);
api.use("/rules", rulesRouter);
api.use("/domains", domainsRouter);
api.use("/env", envRouter);
api.use("/setup", setupRouter);
api.use("/engine", engineRouter);
api.use("/certs", certsRouter);
api.use("/modules", modulesRouter);

const sseClients = new Set();
api.get("/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
  res.write(": connected\n\n");
  sseClients.add(res);
  req.on("close", () => sseClients.delete(res));
});

function sseBroadcast(siteId, data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    if (res.writableEnded) continue;
    res.write(msg);
  }
}

store.events.on("rule:changed", (event) => {
  sseBroadcast(event.rule.site_id, {
    type: `rule:${event.action}`,
    rule: store.serializeRule(event.rule),
  });
});

app.use("/__unidral/api", api);

app.use((req, res, next) => {
  const host = String(req.headers.host || "").toLowerCase();
  const isOwnSubdomain =
    host.startsWith(DASHBOARD_SUBDOMAIN + ".") ||
    host.startsWith(API_SUBDOMAIN + ".");
  if (isOwnSubdomain) {
    if (host.startsWith(API_SUBDOMAIN + ".")) {
      return api(req, res, next);
    }
    return next();
  }
  return proxyMiddleware(req, res, next);
});

app.use((req, res) => {
  unknownHostPage(req, res);
});

app.use(errorHandler);

server.on("upgrade", (req, socket, head) => {
  const host = String(req.headers.host || "").toLowerCase();
  const isOwnSubdomain =
    host.startsWith(DASHBOARD_SUBDOMAIN + ".") ||
    host.startsWith(API_SUBDOMAIN + ".");
  if (isOwnSubdomain) {
    socket.destroy();
    return;
  }
  const resolution = resolveHost(req.headers.host);
  const targetUrl = resolution && targetUrlFor(resolution.site, resolution.prefix);
  if (!resolution || !targetUrl) {
    socket.destroy();
    return;
  }
  req.unidralSite = resolution.site;
  req.unidralTargetUrl = targetUrl;
  socket.on("error", () => {});
});

async function start() {
  console.log("[unidral] connecting to Firestore...");
  await store.ready();
  await domains.initialize();

  const { addLiveDomain, removeLiveDomain } = require("./proxy");
  domains.events.on("domain:added", (doc) => addLiveDomain(doc.domain));
  domains.events.on("domain:removed", (doc) => removeLiveDomain(doc.domain));
  for (const name of domains.getActiveDomainNames()) {
    addLiveDomain(name);
  }

  const stats = store.stats();
  health.start();

  server.listen(PORT, HOST, () => {
    console.log(`[unidral] engine listening on http://${HOST}:${PORT}`);
    console.log(`[unidral] base domain: ${BASE_DOMAIN}`);
    console.log(
      `[unidral] firestore:   project ${stats.projectId}${stats.emulator ? " (emulator)" : ""} - ` +
      `${stats.sites} sites, ${stats.enabledRules || 0} enabled rules`
    );
    console.log(`[unidral] domains:     ${domains.getDomains().length} managed domain(s)`);
  });
}

start().catch((err) => {
  console.error("[unidral] failed to start:", err.message);
  process.exit(1);
});

function shutdown(signal) {
  console.log(`[unidral] ${signal} received, shutting down`);
  health.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5e3).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  console.error("[unidral] Unhandled Promise Rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[unidral] Uncaught Exception:", err);
  process.exit(1);
});
