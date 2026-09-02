"use strict";

const https = require("https");

const store = require("./db");

const CRT_SH_TIMEOUT = 15e3;

function fetchJson(url) {
  return new Promise(resolve => {
    const req = https.get(url, {
      headers: { "User-Agent": "unidral-discovery/1.0" },
      timeout: CRT_SH_TIMEOUT
    }, res => {
      if (res.statusCode !== 200) {
        res.resume();
        resolve(null);
        return;
      }
      let data = "";
      res.on("data", chunk => {
        data += chunk;
        if (data.length > 5e6) {
          req.destroy();
          resolve(null);
        }
      });
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.on("error", () => resolve(null));
  });
}

const TWO_LEVEL_TLDS = new Set([
  "ac", "co", "com", "edu", "gov", "net", "org", "mil", "nom", "sch"
]);
const TWO_LEVEL_COUNTRIES = new Set([
  "uk", "au", "br", "in", "jp", "nz", "za", "cn", "mx", "ar", "ng", "ke", "il", "pk", "sg", "my", "th", "id", "ph", "vn", "kr", "tw", "hk", "eg", "tr", "ua", "pl", "ru", "es", "it", "nl", "se", "no", "fi", "dk", "be", "at", "ch", "de", "fr", "gr", "pt", "ie", "cz", "ro", "hu", "sk", "bg", "hr", "rs", "si", "ee", "lv", "lt"
]);

function rootDomainOf(hostname) {
  const labels = String(hostname || "").toLowerCase().split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const tld = labels[labels.length - 1];
  const sld = labels[labels.length - 2];
  if (tld.length === 2 && TWO_LEVEL_TLDS.has(sld) && TWO_LEVEL_COUNTRIES.has(tld)) {
    return labels.slice(-3).join(".");
  }
  return labels.slice(-2).join(".");
}

async function discoverAndStore(site) {
  if (!site || !site.target_url) return null;
  let host;
  try {
    host = new URL(site.target_url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const root = rootDomainOf(host);
  if (!root) return null;
  const rows = await fetchJson(`https://crt.sh/?q=%25.${encodeURIComponent(root)}&output=json`);
  if (!Array.isArray(rows)) return null;
  const found = new Set;
  for (const row of rows) {
    const names = String(row && row.name_value || "");
    for (const raw of names.split("\n")) {
      const name = raw.trim().toLowerCase();
      if (!name || name.includes("*")) continue;
      if (name === root) continue;
      if (!name.endsWith(`.${root}`)) continue;
      const prefix = name.slice(0, -(root.length + 1));
      if (prefix) found.add(prefix);
    }
  }
  const subdomains = Array.from(found).sort().slice(0, 200);
  try {
    await store.updateSite(site.id, {
      subdomains: subdomains
    });
  } catch (err) {
    console.error(`[discovery] Failed to store subdomains for ${site.id}:`, err.message);
  }
  return subdomains;
}

module.exports = {
  discoverAndStore: discoverAndStore
};
