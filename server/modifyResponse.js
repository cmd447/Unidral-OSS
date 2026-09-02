"use strict";

const zlib = require("zlib");

const fs = require("fs");

const path = require("path");

const store = require("./db");

const {serializeRule: serializeRule} = require("./db");

const domains = require("./domains");

function isDomainProxied(baseDomain, req) {
  if (!baseDomain) return true;
  const doc = domains.getDomainByName(baseDomain);
  if (doc) return doc.cf_proxied !== false;

  if (req && req.headers) {
    return !!(req.headers["cf-ray"] || req.headers["cf-connecting-ip"]);
  }
  return true;
}

const BASE_DOMAIN = String(process.env.BASE_DOMAIN || "example.com").toLowerCase();

const EXTRA_BASE_DOMAINS = String(process.env.EXTRA_BASE_DOMAINS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);

const ALL_BASE_DOMAINS = [ BASE_DOMAIN, ...EXTRA_BASE_DOMAINS ];

function baseDomainOf(host) {
  if (!host) return "";
  const hostname = String(host).split(":")[0].toLowerCase();
  for (const base of ALL_BASE_DOMAINS) {
    if (hostname === base || hostname.endsWith(`.${base}`)) return base;
  }
  return "";
}

const PUBLIC_DIR = path.join(__dirname, "public");

function loadPublic(name) {

  const minPath = path.join(PUBLIC_DIR, name.replace(/\.js$/, ".min.js"));
  const obfPath = path.join(PUBLIC_DIR, name.replace(/\.js$/, ".obf.js"));
  const srcPath = path.join(PUBLIC_DIR, name);
  let content;
  if (process.env.NODE_ENV === "production") {
    if (fs.existsSync(minPath)) content = fs.readFileSync(minPath, "utf8");
    else if (fs.existsSync(obfPath)) content = fs.readFileSync(obfPath, "utf8");
    else if (fs.existsSync(srcPath)) content = fs.readFileSync(srcPath, "utf8");
    else {
      console.warn(`[unidral] Missing asset: ${name} — related features will be skipped`);
      return "";
    }
  } else {
    if (!fs.existsSync(srcPath)) {
      console.warn(`[unidral] Missing asset: ${name} — related features will be skipped`);
      return "";
    }
    content = fs.readFileSync(srcPath, "utf8");
  }

  return content.replace(/;+\s*$/, "");
}

const SHIM_CORE_JS = loadPublic("shim-core.js");

const TOOLBAR_JS = loadPublic("toolbar.js");

const RULES_RUNNER_JS = loadPublic("rules-runner.js");

const OVERRIDE_APPLIER_JS = loadPublic("override-applier.js");

const BOT_DETECT_JS = loadPublic("bot-detect.js");

const INSPECTOR_CSS = fs.readFileSync(path.join(PUBLIC_DIR, "inspector.css"), "utf8");

let RULE_TEMPLATES = [];

try {
  RULE_TEMPLATES = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, "rule-templates.json"), "utf8"));
} catch {}

const CONFIG_VAR = "__c";

const PROXY_VAR = "__p";

const TOOLBAR_FLAG = "__t";

const RUNNER_FLAG = "__r";

const SHIM_FLAG = "__s";

function pathMatches(reqPath, pattern) {
  if (!pattern || pattern === "*") return true;
  if (pattern.indexOf("*") !== -1) {
    const regexStr = pattern.split("*").map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
    try { return new RegExp("^" + regexStr + "$").test(reqPath); } catch (e) { return false; }
  }
  return reqPath === pattern;
}

const SECURITY_HEADERS = [ "content-security-policy", "content-security-policy-report-only", "x-content-security-policy", "x-webkit-csp", "x-frame-options", "x-content-type-options", "permissions-policy", "permissions-policy-report-only", "cross-origin-resource-policy", "cross-origin-opener-policy", "cross-origin-embedder-policy" ];

const MAX_HTML_BYTES = Number(process.env.MAX_HTML_BYTES || 10 * 1024 * 1024);

const AD_TRACKER_DOMAINS = [ "googletagmanager.com", "google-analytics.com", "googlesyndication.com", "doubleclick.net", "adservice.google.com", "facebook.net", "connect.facebook.net", "fbq.facebook.com", "hotjar.com", "mixpanel.com", "segment.com", "amplitude.com", "fullstory.com", "clarity.ms", "bing.com/bat", "quantserve.com", "scorecardresearch.com", "adnxs.com", "criteo.com", "taboola.com", "outbrain.com", "adsrvr.org", "adroll.com", "g.doubleclick.net", "static.doubleclick.net", "amazon-adsystem.com", "pubmatic.com", "rubiconproject.com", "openx.net", "moatads.com", "krxd.net", "bluekai.com", "demdex.net", "omtrdc.net", "2o7.net" ];

const AD_TRACKER_RE = new RegExp("<(?:script|iframe)[^>]*\\ssrc=[\"'][^\"']*?(?:" + AD_TRACKER_DOMAINS.map(d => d.replace(/\./g, "\\.")).join("|") + ")[^\"']*?[\"'][^>]*>\\s*</(?:script|iframe)>", "gi");

const MAX_INLINE_STRIP_BYTES = 2e3;

function stripInlineAdScripts(html) {
  let out = "";
  let pos = 0;
  const lower = html.toLowerCase();
  while (pos < html.length) {
    const start = lower.indexOf("<script", pos);
    if (start === -1) {
      out += html.slice(pos);
      break;
    }
    const tagEnd = lower.indexOf(">", start);
    if (tagEnd === -1) {
      out += html.slice(pos);
      break;
    }
    const closeTag = lower.indexOf("<\/script>", tagEnd + 1);
    if (closeTag === -1) {
      out += html.slice(pos);
      break;
    }
    const blockEnd = closeTag + 9;
    const block = html.slice(start, blockEnd);
    if (block.length <= MAX_INLINE_STRIP_BYTES) {
      const blockLower = block.toLowerCase();
      const isAd = AD_TRACKER_DOMAINS.some(d => blockLower.includes(d));
      if (isAd) {
        out += html.slice(pos, start);
        pos = blockEnd;
        continue;
      }
    }
    out += html.slice(pos, blockEnd);
    pos = blockEnd;
  }
  return out;
}

function stripAdsAndTrackers(html) {
  if (typeof html !== "string" || !html) return html;
  let result = html.replace(AD_TRACKER_RE, "");
  result = stripInlineAdScripts(result);
  return result;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hostVariants(host) {
  const variants = new Set;
  const bare = String(host || "").toLowerCase();
  if (!bare) return [];
  variants.add(bare);
  if (bare.startsWith("www.")) variants.add(bare.slice(4)); else variants.add(`www.${bare}`);
  return [ ...variants ];
}

function injectionDisabled(req) {
  return /[?&]__off=1(&|$)/i.test(String(req.url || ""));
}

function buildContext(req) {
  const site = req.unidralSite;
  const targetUrl = req.unidralTargetUrl || site && site.target_url;
  if (!targetUrl) throw new Error("buildContext: no target URL available");
  const target = new URL(targetUrl);
  const forwardedProto = req._forwardedProto || String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const proto = forwardedProto || (req.socket && req.socket.encrypted ? "https" : "http");

  const proxyHost = String(
    (req._pagesMode && req.headers["x-pages-host"]) || req.headers.host || ""
  );
  const lowerHost = proxyHost.toLowerCase();

  const pagesMode = !!req._pagesMode;
  const pagesBase = "/api/proxy";

  let pagesCurrentPrefix = "";
  if (pagesMode && req._pagesUpstreamPath) {

    const origUrl = req.originalUrl || req.url || "";
    const m = origUrl.match(/^\/api\/bitb\/proxy\/([^\/]+)/);
    if (m) pagesCurrentPrefix = m[1];
  }

  const dotMarker = `.${site.subdomain}.`;
  const dashMarker = `--${site.subdomain}.`;
  const dotIdx = `.${lowerHost}`.indexOf(dotMarker);
  const dashIdx = lowerHost.indexOf(dashMarker);
  let rootProxyHost;
  if (dotIdx !== -1) {
    rootProxyHost = proxyHost.slice(dotIdx);
  } else if (dashIdx !== -1) {
    rootProxyHost = proxyHost.slice(dashIdx + 2);
  } else {
    rootProxyHost = proxyHost;
  }
  const bd = site.base_domain || BASE_DOMAIN;
  const useDashFormat = isDomainProxied(bd, req);
  const proxyHostFor = prefix => {
    if (pagesMode) {

      if (!prefix) return rootProxyHost;
      return `${rootProxyHost}${pagesBase}/${prefix}`;
    }
    if (!prefix) return rootProxyHost;
    if (useDashFormat) {
      const dashPrefix = String(prefix).replace(/\./g, "--");
      return `${dashPrefix}--${rootProxyHost}`;
    }
    return `${prefix}.${rootProxyHost}`;
  };
  const baseHost = new URL(site.target_url).host.toLowerCase();
  const pairs = [];
  if (!pairs.some(([h]) => h === baseHost)) {
    pairs.push([ baseHost, proxyHostFor("") ]);
  }
  const www = hostVariants(baseHost).find(h => h !== baseHost);
  if (www && !pairs.some(([h]) => h === www)) {
    if (baseHost.startsWith("www.")) {
      pairs.push([ www, proxyHostFor("") ]);
    } else {
      pairs.push([ www, proxyHostFor("www") ]);
    }
  }
  {
    const baseLabels = baseHost.split(".");
    if (baseLabels.length >= 3) {
      const rootDom = baseLabels.slice(-2).join(".");
      if (rootDom !== baseHost && !pairs.some(([h]) => h === rootDom)) {
        pairs.push([ rootDom, proxyHostFor("") ]);
      }
    }
  }
  if (site.wildcard) {
    const baseLabels = baseHost.split(".");
    const rootDomain = baseLabels.length >= 2 ? baseLabels.slice(-2).join(".") : baseHost;
    const baseHasPrefix = baseHost !== rootDomain;
    for (const prefix of site.subdomains || []) {
      if (prefix === "www") continue;
      if (prefix.includes(".") && prefix.endsWith(`.${rootDomain}`)) {
        const siblingPrefix = prefix.slice(0, -(rootDomain.length + 1));
        const proxyHost = proxyHostFor(siblingPrefix);
        pairs.push([ prefix, proxyHost ]);
        if (baseHasPrefix) {
          pairs.push([ `${siblingPrefix}.${baseHost}`, proxyHost ]);
        }
      } else if (baseHasPrefix) {
        const proxyHost = proxyHostFor(prefix);
        pairs.push([ `${prefix}.${rootDomain}`, proxyHost ]);
        pairs.push([ `${prefix}.${baseHost}`, proxyHost ]);
      } else {
        pairs.push([ `${prefix}.${baseHost}`, proxyHostFor(prefix) ]);
      }
    }
  }
  const currentHost = target.host.toLowerCase();
  if (!pairs.some(([host]) => host === currentHost)) pairs.push([ currentHost, proxyHost ]);
  pairs.sort((a, b) => b[0].length - a[0].length);
  return {
    site: site,
    target: target,
    targetHost: currentHost,
    baseHost: baseHost,
    proto: proto,
    proxyHost: proxyHost,
    proxyOrigin: `${proto}://${proxyHost}`,
    wsProto: proto === "https" ? "wss" : "ws",
    hostEntries: pairs,
    rootProxyHost: rootProxyHost,
    wildcard: !!site.wildcard,
    proxyHostFor: proxyHostFor,
    useDashFormat: useDashFormat,
    rootDomain: baseHost.split(".").length >= 2 ? baseHost.split(".").slice(-2).join(".") : baseHost,
    pagesMode: pagesMode,
    pagesBase: pagesBase,
    pagesCurrentPrefix: pagesCurrentPrefix
  };
}

function mapTargetHost(host, ctx) {
  const key = String(host || "").toLowerCase();
  if (!key) return null;
  const entry = ctx.hostEntries.find(([h]) => h === key);
  if (entry) return entry[1];
  if (ctx.wildcard && ctx.baseHost && key.endsWith(`.${ctx.baseHost}`)) {
    const prefix = key.slice(0, -(ctx.baseHost.length + 1));
    if (prefix) return ctx.proxyHostFor(prefix);
  }
  return null;
}

function rewriteCspHeaders(headers, ctx) {
  const cspHeaders = [ "content-security-policy", "content-security-policy-report-only", "x-content-security-policy", "x-webkit-csp" ];
  const wsProto = ctx.wsProto || (ctx.proto === "https" ? "wss" : "ws");
  const proxyOrigins = new Set;
  if (ctx.pagesMode) {

    proxyOrigins.add("'self'");
    if (ctx.proxyHost) {
      proxyOrigins.add(`${ctx.proto}://${ctx.proxyHost}`);
      proxyOrigins.add(`${wsProto}://${ctx.proxyHost}`);
    }
  } else {
    for (const [, proxyHost] of ctx.hostEntries) {
      proxyOrigins.add(`${ctx.proto}://${proxyHost}`);
      proxyOrigins.add(`${wsProto}://${proxyHost}`);
    }
    if (ctx.wildcard && ctx.rootProxyHost) {
      proxyOrigins.add(`${ctx.proto}://*.${ctx.rootProxyHost}`);
      proxyOrigins.add(`${wsProto}://*.${ctx.rootProxyHost}`);
    }
  }
  const originMap = new Map;
  if (ctx.pagesMode) {

    for (const [targetHost] of ctx.hostEntries) {
      originMap.set(`https://${targetHost}`, "'self'");
      originMap.set(`http://${targetHost}`, "'self'");
      originMap.set(`wss://${targetHost}`, "'self'");
      originMap.set(`ws://${targetHost}`, "'self'");
    }
  } else {
    for (const [targetHost, proxyHost] of ctx.hostEntries) {
      originMap.set(`https://${targetHost}`, `${ctx.proto}://${proxyHost}`);
      originMap.set(`http://${targetHost}`, `${ctx.proto}://${proxyHost}`);
      originMap.set(`wss://${targetHost}`, `${wsProto}://${proxyHost}`);
      originMap.set(`ws://${targetHost}`, `${wsProto}://${proxyHost}`);
    }
  }
  const fetchDirectives = new Set([ "default-src", "script-src", "style-src", "img-src", "font-src", "connect-src", "frame-src", "worker-src", "child-src", "object-src", "media-src", "manifest-src" ]);
  const ancestorDirectives = new Set([ "frame-ancestors" ]);
  for (const headerName of cspHeaders) {
    const csp = headers[headerName];
    if (!csp) continue;
    const directives = csp.split(";").map(d => d.trim()).filter(Boolean);
    const rewritten = directives.map(directive => {
      const parts = directive.split(/\s+/);
      const name = parts[0];
      if (name === "report-uri" || name === "report-to") return "";
      const values = parts.slice(1);
      const isFetch = fetchDirectives.has(name);
      const isAncestor = ancestorDirectives.has(name);
      if (!isFetch && !isAncestor) return directive;
      const sources = new Set;
      for (const value of values) {
        if (value === "'none'") continue;
        if (isFetch && (name === "script-src" || name === "default-src") && /^'nonce-/i.test(value)) {
          continue;
        }
        let mapped = value;
        for (const [orig, proxy] of originMap) {
          if (value === orig) {
            mapped = proxy;
            break;
          }
        }
        if (ctx.wildcard && value.startsWith("*.") && value.slice(2) === ctx.baseHost) {
          mapped = `${ctx.proto}://*.${ctx.rootProxyHost}`;
        }
        sources.add(mapped);
      }
      for (const origin of proxyOrigins) sources.add(origin);
      if (name === "script-src" || name === "default-src") {
        sources.add("'unsafe-inline'");
        sources.add("'unsafe-eval'");
      }
      if (name === "img-src" || name === "font-src" || name === "default-src") {
        sources.add("data:");
        sources.add("blob:");
      }
      if (sources.size === 0) sources.add("'none'");
      return `${name} ${[ ...sources ].join(" ")}`;
    }).filter(Boolean);
    headers[headerName] = rewritten.join("; ");
  }
  delete headers["x-frame-options"];
  delete headers["report-to"];
  delete headers["reporting-endpoints"];
  delete headers["content-security-policy-report-only"];
  delete headers["permissions-policy-report-only"];
  return headers;
}

function stripSecurityHeaders(headers) {
  for (const name of SECURITY_HEADERS) delete headers[name];
  delete headers["report-to"];
  delete headers["reporting-endpoints"];
  delete headers["content-security-policy-report-only"];
  delete headers["permissions-policy-report-only"];
  return headers;
}

function stripSecurityHeadersSelective(headers) {

  delete headers["content-security-policy"];
  delete headers["x-content-security-policy"];
  delete headers["x-webkit-csp"];

  delete headers["cross-origin-opener-policy"];
  delete headers["cross-origin-embedder-policy"];
  delete headers["cross-origin-resource-policy"];

  delete headers["report-to"];
  delete headers["reporting-endpoints"];
  delete headers["content-security-policy-report-only"];
  delete headers["permissions-policy-report-only"];

  return headers;
}

function applyCorsHeaders(headers, req) {
  const origin = req._originalBrowserOrigin || req.headers.origin;
  const oldAcao = headers["access-control-allow-origin"];
  headers["access-control-allow-origin"] = origin || "*";
  if (origin) headers["access-control-allow-credentials"] = "true";
  if (!headers["access-control-allow-methods"]) {
    headers["access-control-allow-methods"] = "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS";
  }
  const requested = req.headers["access-control-request-headers"];
  if (!headers["access-control-allow-headers"]) {
    headers["access-control-allow-headers"] = requested || "*";
  }
  const varyValues = new Set(String(headers.vary || "").split(",").map(v => v.trim()).filter(Boolean));
  varyValues.add("Origin");
  headers.vary = [ ...varyValues ].join(", ");
  return headers;
}

function rewriteLocationHeader(headers, ctx, req) {
  const location = headers.location;
  if (!location) return headers;
  try {
    const url = new URL(location, ctx.target.origin);
    const mapped = mapTargetHost(url.host, ctx);
    if (mapped) {
      const reqPath = (req.url || "").split("?")[0];

      if (ctx.pagesMode && mapped === ctx.proxyHost && url.pathname === reqPath && !url.search) {
        delete headers.location;
        return headers;
      }
      const search = url.search;

      headers.location = `${ctx.proto}://${mapped}${url.pathname}${search}${url.hash}`;
    }
  } catch {}
  return headers;
}

function rewriteLinkHeader(headers, ctx) {
  if (!headers.link) return headers;
  headers.link = String(headers.link).replace(/<([^>]+)>/g, (match, url) => `<${rewriteUrls(url, ctx)}>`);
  return headers;
}

function rewriteSetCookieHeader(headers, ctx) {
  const cookies = headers["set-cookie"];
  if (!cookies) return headers;
  const isLegacy = !ctx.pagesMode;
  const list = Array.isArray(cookies) ? cookies : [ cookies ];
  headers["set-cookie"] = list.map(cookie => {
    const isHostPrefixed = /^__Host-/i.test(cookie);
    const hadDomain = /;\s*domain=/i.test(cookie);
    let next = cookie.split(";").filter(part => !/^\s*domain=/i.test(part)).join(";");
    if (isHostPrefixed) {

      if (!isLegacy) {
        next = next.replace(/^__Host-/i, "");
      }
    }
    if (ctx.rootProxyHost) {

      if (!ctx.pagesMode && hadDomain && !isHostPrefixed) {
        next += `; Domain=${ctx.rootProxyHost.split(":")[0]}`;
      }
    }
    if (ctx.proto !== "https") {
      next = next.split(";").filter(part => !/^\s*secure\s*$/i.test(part)).join(";").replace(/;\s*samesite=none/i, "; SameSite=Lax");
    } else {
      const hasSameSiteNone = /;\s*samesite=none/i.test(next);
      const hasSecure = /;\s*secure/i.test(next);
      if (isLegacy) {

        if (hasSameSiteNone && !hasSecure) {
          next += "; Secure";
        }
      } else {

        if (!hasSecure) {
          next += "; Secure";
        }
        next = next.replace(/;\s*samesite=strict/i, "; SameSite=Lax");
      }
    }
    return next;
  });
  return headers;
}

function decompressBody(buffer, encoding) {
  const enc = String(encoding || "").toLowerCase().trim();
  if (!enc || enc === "identity") return buffer;
  try {
    if (enc === "gzip" || enc === "x-gzip") return zlib.gunzipSync(buffer);
    if (enc === "deflate") return zlib.inflateSync(buffer);
    if (enc === "br") return zlib.brotliDecompressSync(buffer);
  } catch {
    return null;
  }
  return buffer;
}

function rewriteBaseHref(html, ctx) {
  return html.replace(/<base\b[^>]*\bhref\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)[^>]*>/gi, (tag, rawValue) => {
    const quote = rawValue[0] === '"' || rawValue[0] === "'" ? rawValue[0] : "";
    const value = quote ? rawValue.slice(1, -1) : rawValue;
    let resolved;
    try {
      resolved = new URL(value, ctx.target.origin);
    } catch {
      return tag;
    }
    const mapped = mapTargetHost(resolved.host, ctx);
    if (!mapped) return tag;
    const replacement = `${ctx.proto}://${mapped}${resolved.pathname}${resolved.search}`;
    return tag.replace(rawValue, quote ? `${quote}${replacement}${quote}` : replacement);
  });
}

function rewriteUrls(text, ctx) {
  let output = text;
  for (const [host, mapped] of ctx.hostEntries) {
    const h = escapeRegExp(host);
    const boundary = "(?![a-z0-9.-])";
    const encProto = `${ctx.proto}%3a%2f%2f`;
    const encWsProto = `${ctx.wsProto}%3a%2f%2f`;

    if (ctx.pagesMode && mapped.includes("/")) {

      const fullMapped = `${ctx.proto}://${mapped}`;
      const encFullMapped = `${ctx.proto}%3a%2f%2f${mapped.replace(/\//g, "%2f")}`;
      output = output
        .replace(new RegExp(`https?:\\\\/\\\\/${h}${boundary}`, "gi"), fullMapped.replace(/\//g, "\\\\/"))
        .replace(new RegExp(`https?://${h}${boundary}`, "gi"), fullMapped)
        .replace(new RegExp(`https?%3a%2f%2f${h}${boundary}`, "gi"), encFullMapped)
        .replace(new RegExp(`(?<![a-z0-9+.-]:)//${h}${boundary}`, "gi"), fullMapped);
      continue;
    }

    output = output.replace(new RegExp(`wss?:\\\\/\\\\/${h}${boundary}`, "gi"), `${ctx.wsProto}:\\/\\/${mapped}`).replace(new RegExp(`https?:\\\\/\\\\/${h}${boundary}`, "gi"), `${ctx.proto}:\\/\\/${mapped}`).replace(new RegExp(`wss?%3a%2f%2f${h}${boundary}`, "gi"), `${encWsProto}${mapped}`).replace(new RegExp(`https?%3a%2f%2f${h}${boundary}`, "gi"), `${encProto}${mapped}`).replace(new RegExp(`wss?://${h}${boundary}`, "gi"), `${ctx.wsProto}://${mapped}`).replace(new RegExp(`https?://${h}${boundary}`, "gi"), `${ctx.proto}://${mapped}`).replace(new RegExp(`(?<![a-z0-9+.-]:)//${h}${boundary}`, "gi"), `//${mapped}`);
  }
  if (ctx.wildcard && ctx.baseHost && !ctx.pagesMode) {
    const base = escapeRegExp(ctx.baseHost);
    const subBoundary = "(?![a-z0-9.-])";
    const replaceSub = (match, scheme, prefix) => {
      const mapped = mapTargetHost(`${prefix}.${ctx.baseHost}`, ctx);
      return mapped ? `${scheme}${mapped}` : match;
    };
    output = output.replace(new RegExp(`(wss?:\\/\\/)((?:[a-z0-9-]+\\.)+)${base}${subBoundary}`, "gi"), (m, s, p) => replaceSub(m, s, p.slice(0, -1))).replace(new RegExp(`(https?:\\/\\/)((?:[a-z0-9-]+\\.)+)${base}${subBoundary}`, "gi"), (m, s, p) => replaceSub(m, s, p.slice(0, -1))).replace(new RegExp(`(wss?%3a%2f%2f)((?:[a-z0-9-]+\\.)+)${base}${subBoundary}`, "gi"), (m, s, p) => replaceSub(m, s, p.slice(0, -1))).replace(new RegExp(`(https?%3a%2f%2f)((?:[a-z0-9-]+\\.)+)${base}${subBoundary}`, "gi"), (m, s, p) => replaceSub(m, s, p.slice(0, -1))).replace(new RegExp(`(?<![a-z0-9+.-:])(\\/\\/)((?:[a-z0-9-]+\\.)+)${base}${subBoundary}`, "gi"), (m, s, p) => replaceSub(m, s, p.slice(0, -1)));
  }
  return output;
}

function stripIntegrity(html, ctx) {
  const mapped = ctx.hostEntries.map(([, proxy]) => proxy.toLowerCase());
  const known = ctx.hostEntries.map(([host]) => host);
  return html.replace(/<(?:script|link)\b[^>]*>/gi, tag => {
    if (!/\bintegrity\s*=/i.test(tag)) return tag;
    const lower = tag.toLowerCase();
    const affected = mapped.some(proxy => lower.includes(proxy)) || known.some(host => lower.includes(host));
    if (!affected) return tag;
    return tag.replace(/\s+integrity\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, "");
  });
}

function rewriteSrcset(html, ctx) {
  return html.replace(/\bsrcset\s*=\s*("([^"]*)"|'([^']*)')/gi, (match, _raw, dq, sq) => {
    const quote = dq !== undefined ? '"' : "'";
    const value = dq !== undefined ? dq : sq;
    const next = value.split(",").map(candidate => {
      const parts = candidate.trim().split(/\s+/);
      if (parts[0]) parts[0] = rewriteUrls(parts[0], ctx);
      return parts.join(" ");
    }).join(", ");
    return `srcset=${quote}${next}${quote}`;
  });
}

function rewriteMetaRefresh(html, ctx) {
  return html.replace(/<meta\b[^>]*\bhttp-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, tag => tag.replace(/content\s*=\s*("([^"]*)"|'([^']*)')/i, (m, _raw, dq, sq) => {
    const quote = dq !== undefined ? '"' : "'";
    const value = dq !== undefined ? dq : sq;
    const mapped = value.replace(/(https?:\/\/[^\s;]+)/gi, url => rewriteUrls(url, ctx));
    return `content=${quote}${mapped}${quote}`;
  }));
}

function rewriteInlineStyleUrls(html, ctx) {
  return html.replace(/\bstyle\s*=\s*("([^"]*)"|'([^']*)')/gi, (match, _raw, dq, sq) => {
    const quote = dq !== undefined ? '"' : "'";
    const value = dq !== undefined ? dq : sq;
    const mapped = value.replace(/url\(\s*(['"]?)(https?:\/\/[^'")\s]+)\1\s*\)/gi, (m, q, url) => `url(${q}${rewriteUrls(url, ctx)}${q})`);
    return `style=${quote}${mapped}${quote}`;
  });
}

function stripPreconnectHints(html, ctx) {
  const targetHosts = new Set(ctx.hostEntries.map(([host]) => host));
  return html.replace(/<link\b[^>]*>/gi, tag => {
    if (!/\brel\s*=\s*["']?(preconnect|dns-prefetch)["']?/i.test(tag)) return tag;
    const hrefMatch = tag.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)')/i);
    if (!hrefMatch) return tag;
    const href = hrefMatch[2] !== undefined ? hrefMatch[2] : hrefMatch[3];
    try {
      const host = new URL(href).host.toLowerCase();
      if (targetHosts.has(host)) return "";
    } catch {}
    return tag;
  });
}

function stripCspMetaTags(html) {
  return html.replace(/<meta\b[^>]*\bhttp-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi, "");
}

function stripSpeculationRules(html) {
  return html.replace(/<script\b[^>]*\btype\s*=\s*["']?speculationrules["']?[^>]*>[\s\S]*?<\/script>/gi, "");
}

function rewritePagesRelativeUrls(html, ctx) {
  const prefix = ctx.pagesCurrentPrefix;
  if (!prefix) return html;
  const proxyPrefix = `${ctx.pagesBase}/${prefix}`;

  let out = html.replace(/\b(href|src|action|poster|data-src|data-href)\s*=\s*("([^"]*)"|'([^']*)')/gi, (match, attr, raw, dq, sq) => {
    const quote = dq !== undefined ? '"' : "'";
    let value = dq !== undefined ? dq : sq;
    if (value.startsWith("/") && !value.startsWith("//")) {
      if (value.startsWith("/api/")) return match;
      value = `${proxyPrefix}${value}`;
    }
    return `${attr}=${quote}${value}${quote}`;
  });

  out = out.replace(/"\/(?!\/|api\/|__unidral\/)([a-zA-Z0-9_\-\/\.]*?)"/g, (match, path) => {
    return `"${proxyPrefix}/${path}"`;
  });

  out = out.replace(/'\/(?!\/|api\/|__unidral\/)([a-zA-Z0-9_\-\/\.]*?)'/g, (match, path) => {
    return `'${proxyPrefix}/${path}'`;
  });
  return out;
}

function rewriteHtml(html, ctx) {
  let out = rewriteBaseHref(html, ctx);

  out = out.replace(/\s+nonce=["'][^"']*["']/gi, "");
  const flightPlaceholders = [];
  out = out.replace(/<script\b[^>]*>\s*self\.__next_f\.push\([\s\S]*?\)<\/script>/gi, match => {
    const idx = flightPlaceholders.length;
    flightPlaceholders.push(match);
    return `\0FLIGHT_${idx}\0`;
  });
  const configPlaceholders = [];

  out = out.replace(
    /<script\b[^>]*>\s*(?:var\s+)?(?:window\.|self\.)?(?:\$Config|ServerData)\s*=\s*[\s\S]*?<\/script>/gi,
    match => {
      const idx = configPlaceholders.length;
      configPlaceholders.push(match);
      return `\0CFG_${idx}\0`;
    }
  );
  out = rewriteUrls(out, ctx);

  if (ctx.pagesMode && ctx.pagesCurrentPrefix) {
    out = rewritePagesRelativeUrls(out, ctx);
  }
  out = stripCspMetaTags(out);
  out = stripSpeculationRules(out);
  out = rewriteMetaRefresh(out, ctx);
  out = rewriteSrcset(out, ctx);
  out = rewriteInlineStyleUrls(out, ctx);
  out = stripPreconnectHints(out, ctx);
  out = stripIntegrity(out, ctx);
  out = out.replace(/navigator\.serviceWorker\.register\s*\(\s*(['"`])([^'"`]+)\1/g, (match, quote, url) => {
    const rewritten = rewriteUrls(url, ctx);
    return `navigator.serviceWorker.register(${quote}${rewritten}${quote}`;
  });
  out = out.replace(/\x00CFG_(\d+)\x00/g, (m, idx) => {
    let restored = configPlaceholders[Number(idx)] || m;
    if (restored !== m) {
      restored = rewriteUrls(restored, ctx);
      if (ctx.pagesMode && ctx.pagesCurrentPrefix) {
        restored = rewritePagesRelativeUrls(restored, ctx);
      }
    }
    return restored;
  });
  out = out.replace(/\x00FLIGHT_(\d+)\x00/g, (m, idx) => flightPlaceholders[Number(idx)] || m);
  return out;
}

function scriptNonce(html) {
  const match = html.match(/<script[^>]*\snonce=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

function jsonForScript(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

function buildInjection(ctx, html) {
  const nonce = scriptNonce(html);
  const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
  const rules = store.getEnabledRules(ctx.site.id).map(serializeRule);
  const rulesB64 = Buffer.from(JSON.stringify(rules), "utf8").toString("base64");
  const config = {
    s: ctx.site.id,
    t: "",
    a: `${ctx.proxyOrigin}/__unidral/api`,
    e: `${ctx.proto}://${ctx.proxyHost}/sse?siteId=${ctx.site.id}`,
    r: rulesB64,
    rt: Buffer.from(JSON.stringify(RULE_TEMPLATES), "utf8").toString("base64"),
    ov: {
      dom: (ctx.site.dom_overrides || []).filter(r => r.enabled),
      css: (ctx.site.css_overrides || []).filter(r => r.enabled),
      js: (ctx.site.js_overrides || []).filter(r => r.enabled),
      img: (ctx.site.image_overrides || []).filter(r => r.enabled)
    }
  };
  const toolbarJs = TOOLBAR_JS.replace(/__UNIDRAL_CONFIG__/g, CONFIG_VAR).replace(/__UNIDRAL_TOOLBAR__/g, TOOLBAR_FLAG);
  const css = `<style data-unidral${nonceAttr}>${INSPECTOR_CSS}</style>`;

  const geoBypassEnabled = ctx.site && ctx.site.geo_bypass === true;
  const geoBypass = geoBypassEnabled ? `<script data-unidral${nonceAttr}>(function(){` + `if(document.currentScript&&document.currentScript.parentNode)document.currentScript.parentNode.removeChild(document.currentScript);` + `var GEO={country:"US",countryCode:"US",country_name:"United States",region:"CA",regionName:"California",city:"Los Angeles",allowed:true,restricted:false,isAllowed:true,isRestricted:false,status:"allowed"};` + `var origFetch=window.fetch;window.fetch=function(u,o){` + `if(typeof u==="string"&&/\\/api\\/(geo|geolocation|geoip|location|country|region|user-location)/i.test(u))` + `return Promise.resolve(new Response(JSON.stringify(GEO),{status:200,headers:{"content-type":"application/json"}}));` + `return origFetch.apply(this,arguments);};` + `var origOpen=XMLHttpRequest.prototype.open;` + `XMLHttpRequest.prototype.open=function(m,u){` + `if(typeof u==="string"&&/\\/api\\/(geo|geolocation|geoip|location|country|region|user-location)/i.test(u)){` + `Object.defineProperty(this,"readyState",{value:4});` + `Object.defineProperty(this,"status",{value:200});` + `Object.defineProperty(this,"responseText",{value:JSON.stringify(GEO)});` + `Object.defineProperty(this,"response",{value:JSON.stringify(GEO)});` + `setTimeout((function(){if(this.onreadystatechange)this.onreadystatechange();if(this.onload)this.onload();}).bind(this),0);` + `return;}` + `return origOpen.apply(this,arguments);};` + `})();<\/script>` : "";
  const parts = [ css, `<script data-unidral${nonceAttr}>window.${CONFIG_VAR}=${jsonForScript(config)};var ${TOOLBAR_FLAG}=false;<\/script>` ];
  if (geoBypass) parts.push(geoBypass);
  parts.push(`<script data-unidral${nonceAttr}>${OVERRIDE_APPLIER_JS}<\/script>`);
  parts.push(`<script data-unidral${nonceAttr}>${toolbarJs}<\/script>`);
  return parts.join("\n");
}

function buildRulesOnlyInjection(ctx, html) {
  const nonce = scriptNonce(html);
  const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
  const rules = store.getEnabledRules(ctx.site.id).map(serializeRule);
  const rulesB64 = Buffer.from(JSON.stringify(rules), "utf8").toString("base64");
  const config = {
    r: rulesB64
  };
  const runnerJs = RULES_RUNNER_JS.replace(/__UNIDRAL_CONFIG__/g, CONFIG_VAR).replace(/__UNIDRAL_RULES_RUNNER__/g, RUNNER_FLAG);
  const ovConfig = {
    ov: {
      dom: (ctx.site.dom_overrides || []).filter(r => r.enabled),
      css: (ctx.site.css_overrides || []).filter(r => r.enabled),
      js: (ctx.site.js_overrides || []).filter(r => r.enabled),
      img: (ctx.site.image_overrides || []).filter(r => r.enabled)
    }
  };
  return [ `<script data-unidral${nonceAttr}>window.${CONFIG_VAR}=${jsonForScript(config)};window.__c=Object.assign(window.__c||{},${jsonForScript(ovConfig)});var ${RUNNER_FLAG}=false;<\/script>`, `<script data-unidral${nonceAttr}>${OVERRIDE_APPLIER_JS}<\/script>`, `<script data-unidral${nonceAttr}>${runnerJs}<\/script>` ].join("\n");
}

function buildShimInjection(ctx, html) {
  const nonce = scriptNonce(html);
  const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
  const proxyConfig = {
    h: ctx.proxyHost,
    p: ctx.proto,
    th: ctx.hostEntries.map(([host]) => host),
    hm: Object.fromEntries(ctx.hostEntries),
    td: ctx.target.hostname,
    to: ctx.target.origin,
    pd: ctx.proxyHost.split(":")[0],
    w: ctx.wildcard,
    bh: ctx.baseHost,
    rd: ctx.rootDomain || "",
    rph: ctx.rootProxyHost,
    ud: ctx.useDashFormat,
    bb: false,
    pm: !!ctx.pagesMode,
    cih: null,
    sob: null,
    pdb: []
  };
  const shimJs = SHIM_CORE_JS;
  if (!shimJs) return "";
  const configJson = jsonForScript(proxyConfig);

  const inner = `var __a=(${shimJs})(${configJson});`;
  return `<script data-unidral${nonceAttr}>(function(){${inner}})();<\/script>`;
}

function injectShim(html, ctx) {

  if (html.includes("var __a=(") || html.includes(`window.${PROXY_VAR}=`)) return html;
  const injection = buildShimInjection(ctx, html);
  let customJsInjection = "";
  if (ctx.site.custom_js && typeof ctx.site.custom_js === "string" && ctx.site.custom_js.trim()) {
    customJsInjection = `\n${ctx.site.custom_js}\n`;
  }
  let customCssInjection = "";
  if (ctx.site.custom_css && typeof ctx.site.custom_css === "string" && ctx.site.custom_css.trim()) {
    customCssInjection = `\n<style>${ctx.site.custom_css}</style>\n`;
  }
  const customInjection = customJsInjection + customCssInjection;
  const fullInjection = injection + customInjection;
  if (/<head\b[^>]*>/i.test(html)) {
    html = html.replace(/<head\b[^>]*>/i, match => `${match}${fullInjection}`);
  } else if (/<html\b[^>]*>/i.test(html)) {
    html = html.replace(/<html\b[^>]*>/i, match => `${match}${fullInjection}`);
  } else {
    html = `${fullInjection}${html}`;
  }
  return html;
}

function injectOrigDomain(html, ctx) {
  if (!ctx.site.inject_orig_domain) return html;
  if (html.includes("window.__origDomain=")) return html;
  let origin = "";
  try {
    origin = new URL(ctx.site.target_url).origin;
  } catch (e) {
    return html;
  }
  if (!origin) return html;
  const nonce = scriptNonce(html);
  const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
  const tag = `<script data-unidral${nonceAttr}>window.__origDomain=${jsonForScript(origin)};<\/script>`;
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, match => `${match}${tag}`);
  }
  if (/<html\b[^>]*>/i.test(html)) {
    return html.replace(/<html\b[^>]*>/i, match => `${match}${tag}`);
  }
  return `${tag}${html}`;
}

function injectToolbar(html, ctx) {
  if (html.includes(`window.${CONFIG_VAR}=`) && html.includes(TOOLBAR_FLAG)) return html;
  const injection = buildInjection(ctx, html);
  if (/<\/body\s*>/i.test(html)) {
    return html.replace(/<\/body\s*>/i, match => `${injection}\n${match}`);
  }
  if (/<\/html\s*>/i.test(html)) {
    return html.replace(/<\/html\s*>/i, match => `${injection}\n${match}`);
  }
  return `${html}\n${injection}`;
}

function injectRulesOnly(html, ctx) {
  if (html.includes(`window.${CONFIG_VAR}=`) && html.includes(RUNNER_FLAG)) return html;
  const injection = buildRulesOnlyInjection(ctx, html);
  if (/<\/body\s*>/i.test(html)) {
    return html.replace(/<\/body\s*>/i, match => `${injection}\n${match}`);
  }
  if (/<\/html\s*>/i.test(html)) {
    return html.replace(/<\/html\s*>/i, match => `${injection}\n${match}`);
  }
  return `${html}\n${injection}`;
}

function injectBotDetect(html, ctx) {
  if (html.includes("window.__bd")) return html;
  const tag = "<script data-unidral>" + BOT_DETECT_JS + "<\/script>";
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, match => `${match}${tag}`);
  }
  if (/<html\b[^>]*>/i.test(html)) {
    return html.replace(/<html\b[^>]*>/i, match => `${match}${tag}`);
  }
  return `${tag}${html}`;
}

function handleProxyRes(proxyRes, req, res) {
  const ctx = buildContext(req);
  const headers = {
    ...proxyRes.headers
  };
  let status = proxyRes.statusCode || 502;
  delete headers["speculation-rules"];
  delete headers["x-powered-by"];
  delete headers["via"];
  delete headers["x-cache"];
  delete headers["x-squid-error"];
  delete headers["x-varnish"];
  delete headers["x-cf-hash"];

  if (!headers["server"] && process.env.SPOOF_SERVER_HEADER === "true") {
    headers["server"] = process.env.SPOOF_SERVER_VALUE || "nginx";
  }
  if (!headers["referrer-policy"]) {
    headers["referrer-policy"] = "no-referrer";
  }
  if (headers["transfer-encoding"]) {
    delete headers["transfer-encoding"];
  }
  const siteCspMode = ctx.site && ctx.site.csp_mode;

  const cspMode = siteCspMode || (process.env.REWRITE_CSP === "true" ? "rewrite" : (ctx.pagesMode ? "selective" : "strip"));
  if (cspMode === "keep") {} else if (cspMode === "rewrite") {
    rewriteCspHeaders(headers, ctx);
  } else if (cspMode === "strip" || cspMode === "strip-all") {
    stripSecurityHeaders(headers);
  } else {
    stripSecurityHeadersSelective(headers);
  }
  applyCorsHeaders(headers, req);
  rewriteLocationHeader(headers, ctx, req);

  if (ctx.site && Array.isArray(ctx.site.response_header_rules)) {
    const reqPath = (req.url || "").split("?")[0];
    for (const rule of ctx.site.response_header_rules) {
      if (!rule.enabled || !rule.header) continue;
      if (rule.path_pattern && rule.path_pattern !== "*" && !pathMatches(reqPath, rule.path_pattern)) continue;
      const hName = rule.header.toLowerCase();
      if (rule.action === "remove") {
        delete headers[hName];
      } else if (rule.action === "append") {
        const existing = headers[hName];
        if (existing) {
          headers[hName] = Array.isArray(existing) ? [...existing, rule.value] : [existing, rule.value];
        } else {
          headers[hName] = rule.value;
        }
      } else {

        headers[hName] = rule.value;
      }
    }
  }

  if (ctx.site && Array.isArray(ctx.site.cookie_rules) && headers["set-cookie"]) {
    const reqPath = (req.url || "").split("?")[0];
    const cookies = Array.isArray(headers["set-cookie"]) ? headers["set-cookie"] : [headers["set-cookie"]];
    const newCookies = [];
    for (const raw of cookies) {
      let cookie = raw;
      let skip = false;
      for (const rule of ctx.site.cookie_rules) {
        if (!rule.enabled || !rule.name) continue;
        if (rule.path_pattern && rule.path_pattern !== "*" && !pathMatches(reqPath, rule.path_pattern)) continue;
        const cookieName = cookie.split("=")[0].trim();
        if (cookieName.toLowerCase() !== rule.name.toLowerCase()) continue;
        if (rule.action === "remove") { skip = true; break; }
        if (rule.action === "set") {

          const parts = cookie.split(";");
          parts[0] = rule.name + "=" + rule.value;
          cookie = parts.join(";");
        }
        if (rule.action === "modify-domain") {
          cookie = cookie.replace(/Domain=[^;]*/i, "Domain=" + rule.value);
          if (!/Domain=/i.test(cookie)) cookie += "; Domain=" + rule.value;
        }
        if (rule.action === "modify-path") {
          cookie = cookie.replace(/Path=[^;]*/i, "Path=" + rule.value);
          if (!/Path=/i.test(cookie)) cookie += "; Path=" + rule.value;
        }
        if (rule.action === "add-secure") {
          if (!/Secure/i.test(cookie)) cookie += "; Secure";
        }
        if (rule.action === "add-httponly") {
          if (!/HttpOnly/i.test(cookie)) cookie += "; HttpOnly";
        }
      }
      if (!skip) newCookies.push(cookie);
    }

    for (const rule of ctx.site.cookie_rules) {
      if (!rule.enabled || rule.action !== "set" || !rule.name) continue;
      if (rule.path_pattern && rule.path_pattern !== "*" && !pathMatches(reqPath, rule.path_pattern)) continue;
      const exists = newCookies.some(c => c.split("=")[0].trim().toLowerCase() === rule.name.toLowerCase());
      if (!exists) {
        let newCookie = rule.name + "=" + rule.value + "; Path=" + (rule.path || "/");
        if (rule.domain) newCookie += "; Domain=" + rule.domain;
        newCookies.push(newCookie);
      }
    }
    headers["set-cookie"] = newCookies.length > 0 ? newCookies : undefined;
    if (!newCookies.length) delete headers["set-cookie"];
  }
  if (headers["set-cookie"]) {
    rewriteSetCookieHeader(headers, ctx);
  }
  rewriteLinkHeader(headers, ctx);
  const contentType = String(headers["content-type"] || "").toLowerCase();
  const isHtml = contentType.includes("text/html");
  const isJs = /javascript|ecmascript/.test(contentType);
  const isCss = contentType.includes("text/css");
  const rewritable = isHtml || isJs || isCss;
  if (!rewritable || req.method === "HEAD" || status === 204 || status === 304 || injectionDisabled(req)) {
    if (headers["transfer-encoding"]) {
      delete headers["transfer-encoding"];
      delete headers["content-length"];
    }
    res.writeHead(status, headers);
    proxyRes.on("error", () => {
      try {
        res.end();
      } catch {}
    });
    proxyRes.pipe(res);
    return;
  }
  const chunks = [];
  let buffered = 0;
  let streaming = false;
  proxyRes.on("data", chunk => {
    if (streaming) {
      res.write(chunk);
      return;
    }
    chunks.push(chunk);
    buffered += chunk.length;
    if (buffered > MAX_HTML_BYTES) {
      streaming = true;
      console.warn(`[unidral] response larger than ${MAX_HTML_BYTES} bytes, streaming without rewriting: ${req.url}`);
      res.writeHead(status, headers);
      for (const pending of chunks) res.write(pending);
      chunks.length = 0;
    }
  });
  proxyRes.on("error", () => {
    if (res.headersSent) {
      res.end();
      return;
    }
    res.writeHead(502, {
      "content-type": "text/html; charset=utf-8"
    });
    res.end(errorPage(502));
  });
  proxyRes.on("end", () => {
    if (streaming) {
      res.end();
      return;
    }
    const raw = Buffer.concat(chunks);
    const encoding = String(headers["content-encoding"] || "").toLowerCase().trim();
    const decodable = !encoding || [ "identity", "gzip", "x-gzip", "deflate", "br" ].includes(encoding);
    if (!decodable) {
      headers["content-length"] = String(raw.length);
      res.writeHead(status, headers);
      res.end(raw);
      return;
    }
    const plain = decompressBody(raw, encoding);
    if (plain === null) {
      headers["content-length"] = String(raw.length);
      res.writeHead(status, headers);
      res.end(raw);
      return;
    }
    delete headers["content-encoding"];
    delete headers["content-length"];
    delete headers["transfer-encoding"];
    let text = plain.toString("utf8");
    const applyTextReplacements = (input) => {
      if (!ctx.site.text_replacements || ctx.site.text_replacements.length === 0) return input;
      let out = input;
      for (const rule of ctx.site.text_replacements) {
        if (!rule.find) continue;
        if (rule.regex) {
          try {
            out = out.replace(new RegExp(rule.find, "g"), rule.replace || "");
          } catch (e) {  }
        } else {
          out = out.split(rule.find).join(rule.replace);
        }
      }
      return out;
    };
    if (isHtml) {
      text = rewriteHtml(text, ctx);
      if (ctx.site.block_ads) {
        text = stripAdsAndTrackers(text);
      }
      text = applyTextReplacements(text);
      text = injectOrigDomain(text, ctx);
      text = injectShim(text, ctx);
      if (process.env.BOT_FILTER !== "false" && !ctx.site.bot_filter_disabled) {
        text = injectBotDetect(text, ctx);
      }
      const devMode = ctx.site.mode ? ctx.site.mode === "dev" : ctx.site.live !== false;
      if (devMode) {
        text = injectToolbar(text, ctx);
      } else {
        text = injectRulesOnly(text, ctx);
      }
      headers["cache-control"] = "no-store, no-cache, must-revalidate";
      delete headers.etag;
      delete headers["last-modified"];
    } else {
      const jsFlightPlaceholders = [];
      let jsText = text.replace(/self\.__next_f\.push\(\[[\s\S]*?\]\)/g, match => {
        const idx = jsFlightPlaceholders.length;
        jsFlightPlaceholders.push(match);
        return `\0JSFLIGHT_${idx}\0`;
      });
      jsText = rewriteUrls(jsText, ctx);
      jsText = jsText.replace(/\x00JSFLIGHT_(\d+)\x00/g, (m, idx) => jsFlightPlaceholders[Number(idx)] || m);
      text = jsText;
      delete headers.etag;
    }

    if (!isHtml && ctx.site.modify_non_html) {
      text = applyTextReplacements(text);
    }
    const body = Buffer.from(text, "utf8");
    headers["content-length"] = String(body.length);
    res.writeHead(status, headers);
    res.end(body);
  });
}

function plainErrorPage(statusCode, statusText) {
  return `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1" />\n    <title>${statusCode} ${statusText}</title>\n    <style>\n      body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;\n             background: #fff; color: #333; font-family: ui-sans-serif, system-ui, "Segoe UI", Helvetica, Arial, sans-serif; }\n      .card { text-align: center; max-width: 480px; padding: 40px; }\n      h1 { margin: 0 0 8px; font-size: 64px; font-weight: 300; color: #999; }\n      p { margin: 0; font-size: 16px; color: #666; }\n    </style>\n  </head>\n  <body><div class="card"><h1>${statusCode}</h1><p>${statusText}</p></div></body>\n</html>`;
}

function unknownHostPage() {
  return plainErrorPage(404, "Not Found");
}

function errorPage(status) {
  const code = Number(status) || 502;
  const text = code === 502 ? "Bad Gateway" : code === 503 ? "Service Unavailable" : "Internal Server Error";
  return plainErrorPage(code, text);
}

module.exports = {
  handleProxyRes: handleProxyRes,
  unknownHostPage: unknownHostPage,
  errorPage: errorPage,
  buildContext: buildContext,
  rewriteHtml: rewriteHtml,
  rewriteUrls: rewriteUrls,
  injectShim: injectShim,
  pathMatches: pathMatches
};
