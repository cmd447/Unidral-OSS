"use strict";

const { createProxyMiddleware } = require("http-proxy-middleware");

const store = require("./db");
const { handleProxyRes, errorPage, unknownHostPage } = require("./modifyResponse");

const BASE_DOMAIN = String(process.env.BASE_DOMAIN || "example.com").toLowerCase();

const EXTRA_BASE_DOMAINS = String(process.env.EXTRA_BASE_DOMAINS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const ALL_BASE_DOMAINS = [BASE_DOMAIN, ...EXTRA_BASE_DOMAINS];

const DEV_BASE_DOMAINS = ["localhost", "localtest.me", "lvh.me", "nip.io"];

const ALL_KNOWN_DOMAINS = [...ALL_BASE_DOMAINS, ...DEV_BASE_DOMAINS];

const RESERVED_SUBDOMAINS = new Set(
  (process.env.RESERVED_SUBDOMAINS || "dashboard,engine,www,api")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

function hostnameOf(host) {
  return String(host || "")
    .toLowerCase()
    .trim()
    .split(",")[0]
    .replace(/^\[|\]$/g, "")
    .split(":")[0];
}

const TWO_LABEL_TLDS = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "net.uk",
  "me.uk",
  "co.jp",
  "or.jp",
  "ne.jp",
  "ac.jp",
  "go.jp",
  "com.au",
  "net.au",
  "org.au",
  "edu.au",
  "gov.au",
  "co.nz",
  "net.nz",
  "org.nz",
  "govt.nz",
  "co.kr",
  "or.kr",
  "ne.kr",
  "go.kr",
  "com.br",
  "net.br",
  "org.br",
  "gov.br",
  "edu.br",
  "co.za",
  "net.za",
  "org.za",
  "web.za",
  "com.cn",
  "net.cn",
  "org.cn",
  "gov.cn",
  "com.hk",
  "net.hk",
  "org.hk",
  "com.sg",
  "net.sg",
  "org.sg",
  "gov.sg",
  "com.my",
  "net.my",
  "org.my",
  "co.in",
  "net.in",
  "org.in",
  "gen.in",
  "firm.in",
  "com.tw",
  "net.tw",
  "org.tw",
]);

function subdomainOf(host) {
  const hostname = hostnameOf(host);
  if (!hostname) return "";
  for (const base of ALL_KNOWN_DOMAINS) {
    if (!base) continue;
    if (hostname === base) return "";
    if (hostname.endsWith(`.${base}`))
      return hostname.slice(0, -(base.length + 1));
  }
  const parts = hostname.split(".");
  if (parts.length <= 2) return "";
  if (parts.length >= 3) {
    const lastTwo = parts.slice(-2).join(".");
    if (TWO_LABEL_TLDS.has(lastTwo)) {
      if (parts.length <= 3) return "";
      return parts.slice(0, parts.length - 3).join(".");
    }
  }
  return parts.slice(0, parts.length - 2).join(".");
}

function baseDomainOf(host) {
  const hostname = hostnameOf(host);
  if (!hostname) return "";
  for (const base of ALL_BASE_DOMAINS) {
    if (hostname === base || hostname.endsWith(`.${base}`)) return base;
  }
  return "";
}

function resolveHost(host) {
  const subdomain = subdomainOf(host);
  if (!subdomain) return null;
  if (RESERVED_SUBDOMAINS.has(subdomain)) return null;
  const bd = baseDomainOf(host);
  const exact = store.getSiteBySubdomain(subdomain, bd);
  if (exact) return { site: exact, prefix: "" };
  let searchFrom = subdomain.length;
  while (true) {
    const dashIdx = subdomain.lastIndexOf("--", searchFrom);
    if (dashIdx <= 0) break;
    const prefix = subdomain.slice(0, dashIdx);
    const candidate = subdomain.slice(dashIdx + 2);
    if (!RESERVED_SUBDOMAINS.has(candidate)) {
      const site =
        store.getSiteBySubdomain(candidate, bd) ||
        store.getWildcardSiteBySubdomain(candidate, bd);
      if (site) return { site: site, prefix: prefix };
    }
    searchFrom = dashIdx - 1;
  }
  const parts = subdomain.split(".");
  for (let i = 1; i < parts.length; i++) {
    const candidate = parts.slice(i).join(".");
    if (RESERVED_SUBDOMAINS.has(candidate)) continue;
    const site = store.getWildcardSiteBySubdomain(candidate, bd);
    if (site)
      return { site: site, prefix: parts.slice(0, i).join(".") };
  }
  return null;
}

function targetUrlFor(site, prefix) {
  if (!site) return null;
  if (!prefix) return site.target_url;
  const targetPrefix = prefix.replace(/--/g, ".");
  try {
    const base = new URL(site.target_url);
    const path = base.pathname === "/" ? "" : base.pathname;
    const baseHost = base.host.toLowerCase();
    const baseLabels = baseHost.split(".");
    const rootDomain =
      baseLabels.length >= 2 ? baseLabels.slice(-2).join(".") : baseHost;
    const baseHasPrefix = baseHost !== rootDomain;
    if (targetPrefix.includes(".") && targetPrefix.endsWith(`.${rootDomain}`)) {
      return `${base.protocol}//${targetPrefix}${path}`;
    }
    if (baseHasPrefix && targetPrefix === baseLabels[0]) {
      return site.target_url;
    }
    const prefixLabels = targetPrefix.split(".");
    const firstLabel = prefixLabels[0];
    const known = Array.isArray(site.subdomains) ? site.subdomains : [];
    if (known.length > 0) {
      for (const entry of known) {
        if (entry.includes(".") && entry.endsWith(`.${rootDomain}`)) {
          const entryPrefix = entry.slice(0, -(rootDomain.length + 1));
          if (entryPrefix === firstLabel) {
            return `${base.protocol}//${entry}${path}`;
          }
        } else if (entry === firstLabel && baseHasPrefix) {
          return `${base.protocol}//${entry}.${rootDomain}${path}`;
        }
      }
    }
    if (prefixLabels.length > 1) {
      const prefixSuffix = prefixLabels.slice(1).join(".");
      if (baseHasPrefix) {
        const basePrefixStr = baseLabels.slice(0, -2).join(".");
        if (prefixSuffix === basePrefixStr) {
          return `${base.protocol}//${firstLabel}.${rootDomain}${path}`;
        }
      } else if (!site.wildcard) {
        const constructedHost = `${targetPrefix}.${baseHost}`;
        const constructedLabels = constructedHost.split(".");
        if (constructedLabels.length > 3) {
          return `${base.protocol}//${firstLabel}.${rootDomain}${path}`;
        }
      }
    }
    return `${base.protocol}//${targetPrefix}.${base.host}${path}`;
  } catch {
    return null;
  }
}

function resolveSite(req, res, next) {
  try {
    if (req.url && /^https?:\/\//i.test(req.url)) {
      try {
        const parsed = new URL(req.url);
        req.url = parsed.pathname + (parsed.search || "");
      } catch {}
    }
    const resolution = resolveHost(req.headers.host);
    req.unidralSite = resolution ? resolution.site : null;
    req.unidralPrefix = resolution ? resolution.prefix : "";
    req.unidralTargetUrl = resolution
      ? targetUrlFor(req.unidralSite, resolution.prefix)
      : null;
    if (req.unidralSite && !req.unidralTargetUrl) req.unidralSite = null;
    if (req.unidralSite && req.unidralSite.mode === "stopped") {
      res.status(503);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Retry-After", "300");
      res.end(
        '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Under Maintenance</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#111;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#e8e8e8}h1{font-size:1.25rem;font-weight:500;margin:0}p{margin-top:8px;color:#7a7a7a;font-size:.875rem}</style></head><body><div style="text-align:center"><h1>Under Maintenance</h1><p>This site is temporarily unavailable. Please check back later.</p></div></body></html>'
      );
      return;
    }
    if (req.unidralSite && req.url && req.url.startsWith("/_next/image")) {
      try {
        const parsed = new URL(req.url, "http://placeholder");
        const imageUrl = parsed.searchParams.get("url");
        if (imageUrl && /^https?:\/\//i.test(imageUrl)) {
          const targetHost = req.unidralTargetUrl
            ? new URL(req.unidralTargetUrl).host
            : "";
          const imageHost = new URL(imageUrl).host;
          if (imageHost !== targetHost) {
            const ALLOWED_IMAGE_HOSTS =
              /\.(amazonaws\.com|cloudfront\.net|cloudinary\.com|imgix\.net|akamaized\.net|fastly\.net|cdn\.shopify\.com|wp\.com|twimg\.com|fbcdn\.net|googleusercontent\.com|gstatic\.com|cloudflare\.com|vercel-storage\.com|blob\.vercel-storage\.com|ctfassets\.net|shopify\.com|shopifycdn\.com|bigcommerce\.com|fastlylb\.net|kxcdn\.com|section\.io)$/i;
            if (ALLOWED_IMAGE_HOSTS.test(imageHost)) {
              res.writeHead(302, {
                location: imageUrl,
                "cache-control": "public, max-age=86400",
              });
              res.end();
              return;
            }
          }
        }
      } catch {}
    }
    if (req.unidralSite && req.url) {
      const urlPath = req.url.split("?")[0];
      if (
        urlPath === "/api/track" ||
        urlPath === "/api/track/" ||
        urlPath === "/api/analytics" ||
        urlPath === "/api/event" ||
        urlPath === "/api/events" ||
        urlPath === "/api/log" ||
        urlPath.includes("/csp-report") ||
        urlPath.includes("/cspreport") ||
        urlPath.includes("/csp_report") ||
        urlPath.includes("/browser-report") ||
        urlPath.includes("/telemetry") ||
        urlPath === "/cdn-cgi/rum" ||
        urlPath === "/cdn-cgi/rum/" ||
        urlPath.startsWith("/cdn-cgi/pe") ||
        urlPath.startsWith("/cdn-cgi/speculation")
      ) {
        const origin = req._originalBrowserOrigin || req.headers.origin || "*";
        res.writeHead(204, {
          "access-control-allow-origin": origin,
          "access-control-allow-credentials": "true",
          "access-control-allow-methods":
            "GET, POST, PUT, DELETE, OPTIONS",
          "access-control-allow-headers":
            req.headers["access-control-request-headers"] || "*",
        });
        res.end();
        return;
      }
    }
  } catch (err) {
    console.error("[unidral] site resolution failed:", err);
    req.unidralSite = null;
    req.unidralTargetUrl = null;
  }
  if (req.unidralSite && req.unidralTargetUrl) {
    try {
      const targetUrl = req.unidralTargetUrl;
      const target = new URL(targetUrl);
      if (req.headers.origin) {
        req._originalBrowserOrigin = req.headers.origin;
      }
      if (req.headers.origin) {
        try {
          const originUrl = new URL(req.headers.origin);
          const originRes = resolveHost(originUrl.host);
          if (originRes) {
            const originTarget = targetUrlFor(originRes.site, originRes.prefix);
            if (originTarget) {
              req.headers.origin = new URL(originTarget).origin;
            } else {
              req.headers.origin = target.origin;
            }
          } else {
            req.headers.origin = target.origin;
          }
        } catch {
          req.headers.origin = target.origin;
        }
      }
      if (req.headers.referer) {
        try {
          const referer = new URL(req.headers.referer);
          if (referer.host.includes("--")) {
            const refRes = resolveHost(referer.host);
            if (refRes) {
              const refTarget = targetUrlFor(refRes.site, refRes.prefix);
              if (refTarget) {
                const refUrl = new URL(refTarget);
                referer.protocol = refUrl.protocol;
                referer.host = refUrl.host;
                req.headers.referer = referer.toString();
              } else {
                referer.protocol = target.protocol;
                referer.host = target.host;
                req.headers.referer = referer.toString();
              }
            } else {
              referer.protocol = target.protocol;
              referer.host = target.host;
              req.headers.referer = referer.toString();
            }
          } else {
            referer.protocol = target.protocol;
            referer.host = target.host;
            req.headers.referer = referer.toString();
          }
        } catch {
          req.headers.referer = target.origin;
        }
      }
      if (req.method === "POST" && req.url && req.url.includes("batchexecute") && req.readable && !(req.unidralTargetUrl && new URL(req.unidralTargetUrl).hostname.endsWith(".google.com"))) {
        const targetHost = req.unidralTargetUrl ? new URL(req.unidralTargetUrl).hostname : "";
        const proxyHost = req.headers.host || "";
        if (targetHost && proxyHost && proxyHost !== targetHost) {
          req._bodyRewritePending = true;
          const { Readable } = require("stream");
          const chunks = [];
          req.on("data", (c) => chunks.push(c));
          req.on("end", () => {
            let body = Buffer.concat(chunks);
            const bodyStr = body.toString("utf8");
            if (bodyStr.includes(proxyHost)) {
              const rewritten = bodyStr.split(proxyHost).join(targetHost);
              body = Buffer.from(rewritten, "utf8");
              req.headers["content-length"] = String(body.length);
            }
            const newStream = new Readable({ read() {} });
            newStream.push(body);
            newStream.push(null);
            req.pipe = function (dest, opts) {
              return newStream.pipe(dest, opts);
            };
            req._bodyRewritePending = false;
          });
          req.on("error", () => {
            req._bodyRewritePending = false;
          });
        }
      }
      if (req.headers["cf-connecting-ip"]) {
        req._realClientIp = req.headers["cf-connecting-ip"];
      } else if (req.headers["x-real-ip"]) {
        req._realClientIp = req.headers["x-real-ip"];
      }
      if (req.headers["x-forwarded-proto"]) {
        req._forwardedProto = String(req.headers["x-forwarded-proto"])
          .split(",")[0]
          .trim();
      } else if (req.headers["cf-visitor"]) {
        try {
          req._forwardedProto = JSON.parse(req.headers["cf-visitor"]).scheme;
        } catch {}
      }
      const headersToRemove = [
        "via",
        "forwarded",
        "x-proxy-id",
        "proxy-connection",
        "x-original-url",
        "x-rewrite-url",
        "x-forwarded-host",
        "x-forwarded-proto",
        "x-forwarded-port",
        "x-forwarded-for",
        "x-real-ip",
        "cf-ray",
        "cf-visitor",
        "cf-connecting-ip",
        "cf-ipcountry",
        "cdn-loop",
        "true-client-ip",
      ];
      headersToRemove.forEach((h) => delete req.headers[h]);
      req.headers["accept-encoding"] = "gzip, deflate, br";
    } catch (err) {
      console.error("[pre-proxy] Header rewrite error:", err.message);
    }
  }
  if (req._bodyRewritePending) {
    const checkReady = () => {
      if (!req._bodyRewritePending) {
        next();
      } else {
        setTimeout(checkReady, 5);
      }
    };
    setTimeout(checkReady, 5);
  } else {
    next();
  }
}

const proxyMiddleware = createProxyMiddleware({
  target: "http://127.0.0.1:1",
  router: (req) => req.unidralTargetUrl || "http://127.0.0.1:1",
  changeOrigin: true,
  ws: true,
  secure: false,
  xfwd: true,
  followRedirects: false,
  selfHandleResponse: true,
  proxyTimeout: 6e4,
  timeout: 6e4,
  logLevel: process.env.PROXY_LOG_LEVEL || "warn",
  onProxyReq(proxyReq, req) {
    try {
      const site = req.unidralSite;
      if (!site || !req.unidralTargetUrl) return;
      const safeSet = (name, val) => {
        try {
          proxyReq.setHeader(name, val);
        } catch {}
      };
      const safeRemove = (name) => {
        try {
          proxyReq.removeHeader(name);
        } catch {}
      };
      const safeGet = (name) => {
        try {
          return proxyReq.getHeader(name);
        } catch {
          return undefined;
        }
      };
      const target = new URL(req.unidralTargetUrl);
      if (req.url && /^https?:\/\//i.test(req.url)) {
        try {
          const parsed = new URL(req.url);
          req.url = parsed.pathname + (parsed.search || "");
          proxyReq.path = req.url;
        } catch {}
      }
      safeSet("accept-encoding", "gzip, deflate, br");
      const headersToRemove = [
        "via",
        "forwarded",
        "x-proxy-id",
        "proxy-connection",
        "x-original-url",
        "x-rewrite-url",
        "x-forwarded-host",
        "x-forwarded-proto",
        "x-forwarded-port",
        "x-forwarded-for",
        "x-real-ip",
        "cf-ray",
        "cf-visitor",
        "cf-connecting-ip",
        "cf-ipcountry",
        "cdn-loop",
        "true-client-ip",
      ];
      headersToRemove.forEach((h) => safeRemove(h));
      if (!safeGet("accept")) {
        safeSet(
          "accept",
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
        );
      }
      if (!safeGet("accept-language")) {
        safeSet("accept-language", "en-US,en;q=0.9");
      }
      if (req.method === "GET" && !safeGet("sec-fetch-dest")) {
        safeSet("sec-fetch-dest", "document");
        safeSet("sec-fetch-mode", "navigate");
        safeSet("sec-fetch-site", "none");
        safeSet("sec-fetch-user", "?1");
      }
      if (req.headers.origin) {
        try {
          const originUrl = new URL(req.headers.origin);
          const originRes = resolveHost(originUrl.host);
          if (originRes) {
            const originTarget = targetUrlFor(originRes.site, originRes.prefix);
            if (originTarget) {
              safeSet("origin", new URL(originTarget).origin);
            } else {
              safeSet("origin", target.origin);
            }
          } else {
            safeSet("origin", target.origin);
          }
        } catch (e) {
          safeSet("origin", target.origin);
        }
      }
      if (req.headers.referer) {
        try {
          const referer = new URL(req.headers.referer);
          const refRes = resolveHost(referer.host);
          if (refRes) {
            const refTarget = targetUrlFor(refRes.site, refRes.prefix);
            if (refTarget) {
              const refUrl = new URL(refTarget);
              referer.protocol = refUrl.protocol;
              referer.host = refUrl.host;
              safeSet("referer", referer.toString());
            } else {
              referer.protocol = target.protocol;
              referer.host = target.host;
              safeSet("referer", referer.toString());
            }
          } else {
            referer.protocol = target.protocol;
            referer.host = target.host;
            safeSet("referer", referer.toString());
          }
        } catch {
          safeSet("referer", target.origin);
        }
      }
      const wafMode = site.waf_bypass || "none";
      if (wafMode === "header-shuffle") {
        const shuffleHeaders = [
          "accept",
          "accept-language",
          "accept-encoding",
          "cache-control",
          "pragma",
        ];
        const shuffled = shuffleHeaders.sort(() => Math.random() - 0.5);
        for (const h of shuffled) {
          const val = safeGet(h);
          if (val) {
            safeRemove(h);
            safeSet(h, val);
          }
        }
      } else if (wafMode === "lowercase-headers") {
        const rawHeaders = proxyReq.getHeaders();
        const lowerKeys = Object.keys(rawHeaders).filter(
          (k) => k !== k.toLowerCase()
        );
        for (const k of lowerKeys) {
          const val = rawHeaders[k];
          safeRemove(k);
          safeSet(k.toLowerCase(), val);
        }
      } else if (wafMode === "chunked") {
        if (req.method === "POST" || req.method === "PUT") {
          safeSet("transfer-encoding", "chunked");
          safeRemove("content-length");
        }
      }
    } catch (err) {
      console.error(
        "[unidral] onProxyReq error:",
        err.code || "",
        err.message,
        err.stack ? err.stack.split("\n").slice(0, 5).join("\n") : ""
      );
    }
  },
  onProxyReqWs(proxyReq, req) {
    const site = req.unidralSite;
    if (!site || !req.unidralTargetUrl) return;
    const wsSafeSet = (name, val) => {
      try {
        proxyReq.setHeader(name, val);
      } catch {}
    };
    const wsSafeRemove = (name) => {
      try {
        proxyReq.removeHeader(name);
      } catch {}
    };
    try {
      const target = new URL(req.unidralTargetUrl);
      wsSafeSet("host", target.host);
      if (req.headers.origin) {
        try {
          const originUrl = new URL(req.headers.origin);
          const originRes = resolveHost(originUrl.host);
          if (originRes) {
            const originTarget = targetUrlFor(originRes.site, originRes.prefix);
            if (originTarget) {
              wsSafeSet("origin", new URL(originTarget).origin);
            } else {
              wsSafeSet("origin", target.origin);
            }
          } else {
            wsSafeSet("origin", target.origin);
          }
        } catch {
          wsSafeSet("origin", target.origin);
        }
      }
    } catch {}
    const headersToRemove = [
      "x-forwarded-for",
      "x-forwarded-host",
      "x-forwarded-proto",
      "x-forwarded-port",
      "x-real-ip",
      "via",
      "forwarded",
      "x-proxy-id",
      "proxy-connection",
      "x-original-url",
      "x-rewrite-url",
      "cf-ray",
      "cf-visitor",
      "cf-connecting-ip",
      "cf-ipcountry",
      "true-client-ip",
    ];
    headersToRemove.forEach((header) => wsSafeRemove(header));
  },
  onProxyRes(proxyRes, req, res) {
    try {
      handleProxyRes(proxyRes, req, res);
    } catch (err) {
      console.error("[unidral] response modification failed:", err);
      if (!res.headersSent) {
        res.writeHead(502, {
          "content-type": "text/html; charset=utf-8",
          "access-control-allow-origin":
            (req.headers && req.headers.origin) || "*",
          "access-control-allow-credentials": "true",
        });
      }
      res.end(errorPage(502));
    }
  },
  onError(err, req, res) {
    const target = req.unidralTargetUrl || "unknown";
    const host = (req.headers && req.headers.host) || "unknown";
    console.error(
      `[unidral] proxy error: ${err.code || ""} ${err.message} (host=${host}, target=${target}, path=${req.url})`
    );
    if (!res || typeof res.writeHead !== "function") {
      if (res && typeof res.destroy === "function") res.destroy();
      return;
    }
    const origin =
      req._originalBrowserOrigin || (req.headers && req.headers.origin) || "*";
    const corsHeaders = {
      "access-control-allow-origin": origin,
      "access-control-allow-credentials": "true",
    };
    if (res.headersSent) {
      res.end();
      return;
    }
    res.writeHead(502, {
      "content-type": "text/html; charset=utf-8",
      ...corsHeaders,
    });
    res.end(errorPage(502));
  },
});

function preflightShortCircuit(req, res) {
  const origin =
    req._originalBrowserOrigin || (req.headers && req.headers.origin) || "*";
  res.writeHead(204, {
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
    "access-control-allow-headers":
      (req.headers && req.headers["access-control-request-headers"]) || "*",
    "access-control-max-age": "86400",
    "content-length": "0",
    vary: "Origin",
  });
  res.end();
}

function addLiveDomain(domain) {
  const d = String(domain || "").toLowerCase().trim();
  if (!d) return;
  if (!ALL_BASE_DOMAINS.includes(d)) {
    ALL_BASE_DOMAINS.push(d);
    ALL_KNOWN_DOMAINS.push(d);
    console.log(
      `[unidral] Domain hot-added: ${d} (total: ${ALL_BASE_DOMAINS.length})`
    );
  }
}

function removeLiveDomain(domain) {
  const d = String(domain || "").toLowerCase().trim();
  if (!d) return;
  const idx = ALL_BASE_DOMAINS.indexOf(d);
  if (idx !== -1) {
    ALL_BASE_DOMAINS.splice(idx, 1);
    const kIdx = ALL_KNOWN_DOMAINS.indexOf(d);
    if (kIdx !== -1) ALL_KNOWN_DOMAINS.splice(kIdx, 1);
    console.log(
      `[unidral] Domain hot-removed: ${d} (total: ${ALL_BASE_DOMAINS.length})`
    );
  }
}

module.exports = {
  BASE_DOMAIN,
  resolveHost,
  targetUrlFor,
  resolveSite,
  proxyMiddleware,
  preflightShortCircuit,
  unknownHostPage,
  addLiveDomain,
  removeLiveDomain,
};
