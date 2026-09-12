const API_BASE = (typeof window !== "undefined" && window.location.protocol.startsWith("http") && !window.location.hostname.includes("localhost") ? "/api" : process.env.NEXT_PUBLIC_API_BASE || "http://localhost:4000/api").replace(/\/+$/, "");

export const BASE_DOMAIN = process.env.NEXT_PUBLIC_BASE_DOMAIN || "example.com";

export const BASE_DOMAINS = (process.env.NEXT_PUBLIC_BASE_DOMAINS || BASE_DOMAIN).split(",").map(s => s.trim().toLowerCase()).filter(Boolean);

const siteListeners = new Set;

export function notifySiteChange() {
  for (const fn of siteListeners) fn();
}

export function onSiteChange(fn) {
  siteListeners.add(fn);
  return () => siteListeners.delete(fn);
}

export function siteUrl(site) {
  if (!site) return "";
  const bd = site.base_domain || BASE_DOMAIN;
  const protocol = bd.includes("localhost") ? "http" : "https";
  return `${protocol}://${site.subdomain}.${bd}`;
}

async function request(method, path, body, retries = 2) {
  const headers = {};
  if (body) headers["content-type"] = "application/json";
  let response;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      response = await fetch(`${API_BASE}${path}`, {
        method: method,
        headers: Object.keys(headers).length ? headers : undefined,
        credentials: "include",
        body: body ? JSON.stringify(body) : undefined
      });
      break;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }
  if (!response) {
    throw new Error("Cannot reach the Unidral engine. Check your connection.");
  }
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    throw new Error(payload && payload.error || `Request failed with status ${response.status}`);
  }
  return payload;
}

async function streamingRequest(path, body) {
  let response;
  try {
    const headers = { "content-type": "application/json" };
    response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify(body)
    });
  } catch (err) {
    return {
      ok: false,
      output: "Cannot reach the Unidral engine. Check your connection."
    };
  }
  const output = await response.text();
  return {
    ok: response.ok,
    output: output
  };
}

export const api = {
  base: API_BASE,
  request: (method, path, body) => request(method, path, body),
  listSites: () => request("GET", "/sites"),
  getSite: id => request("GET", `/sites/${id}`),
  createSite: payload => request("POST", "/sites", payload),
  updateSite: (id, payload) => request("PUT", `/sites/${id}`, payload),
  deleteSite: id => request("DELETE", `/sites/${id}`),
  discoverSubdomains: id => request("POST", `/sites/${id}/discover-subdomains`),
  siteHealth: () => request("GET", "/site-health"),
  listRules: siteId => request("GET", `/sites/${siteId}/rules`),
  createRule: payload => request("POST", "/rules", payload),
  updateRule: (id, payload, siteId) => request("PUT", `/rules/${id}${siteId ? `?site_id=${encodeURIComponent(siteId)}` : ""}`, payload),
  toggleRule: (id, enabled, siteId) => request("PATCH", `/rules/${id}/toggle`, {
    enabled: enabled,
    site_id: siteId
  }),
  deleteRule: (id, siteId) => request("DELETE", `/rules/${id}${siteId ? `?site_id=${encodeURIComponent(siteId)}` : ""}`),
  listTrackedElements: siteId => request("GET", `/sites/${siteId}/tracked-elements`),
  deleteTrackedElement: (siteId, trackId) => request("DELETE", `/sites/${siteId}/tracked-elements/${trackId}`),
  listDomains: () => request("GET", "/domains"),
  getDomain: id => request("GET", `/domains/${id}`),
  addDomain: (domain, opts = {}) => request("POST", "/domains", {
    domain: domain,
    ...opts
  }),
  removeDomain: id => request("DELETE", `/domains/${id}`),
  verifyDomain: id => request("POST", `/domains/${id}/verify`),
  updateDomainProxy: (id, proxied) => request("PATCH", `/domains/${id}/proxied`, {
    proxied: proxied
  }),
  getVpsIp: () => request("GET", "/domains/vps-ip"),
  syncDomainIps: (ip) => request("POST", "/domains/sync-ip", ip ? { ip } : {}),
  domainLogs: (opts = {}) => {
    const params = new URLSearchParams;
    if (opts.domain_id) params.set("domain_id", opts.domain_id);
    if (opts.level) params.set("level", opts.level);
    if (opts.limit) params.set("limit", opts.limit);
    const qs = params.toString();
    return request("GET", `/domains/logs${qs ? `?${qs}` : ""}`);
  },
  availableBaseDomains: () => request("GET", "/domains/available"),
  getEnv: () => request("GET", "/env"),
  updateEnv: (updates, restart = true, cloudflareIni = undefined) => {
    const body = {
      updates: updates,
      restart: restart
    };
    if (cloudflareIni !== undefined) body.cloudflareIni = cloudflareIni;
    return streamingRequest("/env", body);
  },
  setEnvVar: async (key, value) => {
    const res = await fetch(`${API_BASE}/env`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        updates: {
          [key]: value
        },
        restart: false
      }),
      credentials: "include"
    });
    if (!res.ok) throw new Error((await res.json()).error || "Failed");
    return res.json();
  },
  switchBaseDomain: domain => streamingRequest("/domains/switch-base", {
    domain: domain
  }),
  reissueCerts: (dryRun = false) => streamingRequest("/certs/reissue", {
    dryRun: dryRun
  }),
  restartNginx: () => request("POST", "/certs/restart-nginx"),
  listModules: () => request("GET", "/modules"),
  getModule: id => request("GET", `/modules/${id}`),
  getModuleFiles: id => request("GET", `/modules/${id}/files`),
  getModuleFile: (id, filename) => request("GET", `/modules/${id}/files/${encodeURIComponent(filename)}`),
  createModule: payload => request("POST", "/modules", payload),
  updateModule: (id, payload) => request("PUT", `/modules/${id}`, payload),
  deleteModule: id => request("DELETE", `/modules/${id}`),
  duplicateModule: id => request("POST", `/modules/${id}/duplicate`),
  exportModule: id => request("GET", `/modules/${id}/export`),
  exportModuleZip: id => fetch(`${API_BASE}/modules/${id}/export`, {
    method: "GET",
    credentials: "include"
  }).then(async r => {
    if (!r.ok) {
      const err = await r.json().catch(() => ({
        error: r.statusText
      }));
      throw new Error(err.error || `HTTP ${r.status}`);
    }
    return r.blob();
  }),
  importModule: payload => request("POST", "/modules/import", payload),
  getHookFile: async (id, filename) => {
    const res = await fetch(`${API_BASE}/modules/${id}/hooks/${filename}`, {
      credentials: "include"
    });
    if (!res.ok) throw new Error(`Failed to load hook file (${res.status})`);
    return await res.text();
  },
  saveHookFile: (id, filename, content) => request("PUT", `/modules/${id}/hooks/${filename}`, {
    content: content
  }),
  reloadModule: id => request("POST", `/modules/${id}/reload`),
  importModuleZip: file => {
    const formData = new FormData;
    formData.append("file", file);
    return fetch(`${API_BASE}/modules/import-zip`, {
      method: "POST",
      credentials: "include",
      body: formData
    }).then(async r => {
      if (!r.ok) {
        const err = await r.json().catch(() => ({
          error: r.statusText
        }));
        throw new Error(err.error || `HTTP ${r.status}`);
      }
      return r.json();
    });
  },
  listModulePackages: () => request("GET", "/module-packages"),
  listShells: () => request("GET", "/shells"),
  getShell: id => request("GET", `/shells/${id}`),
  createShell: payload => request("POST", "/shells", payload),
  updateShell: (id, payload) => request("PUT", `/shells/${id}`, payload),
  deleteShell: id => request("DELETE", `/shells/${id}`),
  duplicateShell: id => request("POST", `/shells/${id}/duplicate`),
  exportShell: id => request("GET", `/shells/${id}/export`),
  importShell: payload => request("POST", "/shells/import", payload),
  previewShellUrl: id => `${API_BASE}/shells/${id}/preview`,
  engineStats: () => request("GET", "/engine/stats"),
  getEngineSettings: () => request("GET", "/engine/settings"),
  updateEngineSettings: payload => request("PUT", "/engine/settings", payload),
  killswitch: () => request("POST", "/engine/killswitch"),
  restoreSites: () => request("POST", "/engine/restore-sites"),
  clearCache: () => request("POST", "/engine/clear-cache"),
  reloadSites: () => request("POST", "/engine/reload-sites"),
  firebaseCollections: () => request("GET", "/engine/firebase"),
  firebaseDocs: (coll, limit = 100) => request("GET", `/engine/firebase/${coll}?limit=${limit}`),
  firebaseDoc: (coll, docId) => request("GET", `/engine/firebase/${coll}/${docId}`),
  firebaseUpdateDoc: (coll, docId, data) => request("PUT", `/engine/firebase/${coll}/${docId}`, data),
  firebaseCreateDoc: (coll, data) => request("POST", `/engine/firebase/${coll}`, data),
  firebaseDeleteDoc: (coll, docId) => request("DELETE", `/engine/firebase/${coll}/${docId}`),
  firebaseDeleteCollection: coll => request("DELETE", `/engine/firebase/${coll}`),
  getContent: async () => {
    const res = await fetch(`${API_BASE}/content`, {
      credentials: "include"
    });
    if (!res.ok) return {
      content: {}
    };
    return res.json();
  },
  updateContent: async (page, sections) => {
    const res = await fetch(`${API_BASE}/content/${page}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        sections: sections
      }),
      credentials: "include"
    });
    if (!res.ok) throw new Error((await res.json()).error || "Failed to save content");
    return res.json();
  },
  resetContent: async (page, section) => {
    const res = await fetch(`${API_BASE}/content/${page}/${section}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json"
      },
      credentials: "include"
    });
    if (!res.ok) throw new Error((await res.json()).error || "Failed to reset content");
    return res.json();
  }
};

let contentCache = {};

const contentListeners = new Set;

export function getContent() {
  return contentCache;
}

export function getPageContent(page) {
  return contentCache[page]?.sections || {};
}

export function onContentChange(fn) {
  contentListeners.add(fn);
  return () => contentListeners.delete(fn);
}

function notifyContentListeners() {
  for (const fn of contentListeners) fn(contentCache);
}

export async function loadContent() {
  try {
    const data = await api.getContent();
    contentCache = data.content || {};
    notifyContentListeners();
  } catch {
    contentCache = {};
  }
}

export function setContentCache(newCache) {
  contentCache = newCache;
  notifyContentListeners();
}

export default api;
