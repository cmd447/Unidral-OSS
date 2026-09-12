"use strict";

const https = require("https");

const dns = require("dns");

const {EventEmitter: EventEmitter} = require("events");

const crypto = require("crypto");

const {firestore: firestore} = require("./firebase");

const CF_API_TOKEN = (process.env.CF_API_TOKEN || "").trim();

const CF_ACCOUNT_ID = (process.env.CF_ACCOUNT_ID || "").trim();

const configRef = firestore ? firestore.collection("engine_config") : null;

let fbPublicCfToken = null;

let fbPublicCfAccountId = null;

let fbConfigLoaded = false;

async function loadPublicCfFromFirebase() {
  if (!configRef || fbConfigLoaded) return;
  fbConfigLoaded = true;
  try {
    if (!process.env.PUBLIC_CF_API_TOKEN) {
      const doc = await configRef.doc("PUBLIC_CF_API_TOKEN").get();
      if (doc.exists) {
        fbPublicCfToken = doc.data().value || null;
        if (fbPublicCfToken) {}
      }
    }
    if (!process.env.PUBLIC_CF_ACCOUNT_ID) {
      const doc = await configRef.doc("PUBLIC_CF_ACCOUNT_ID").get();
      if (doc.exists) {
        fbPublicCfAccountId = doc.data().value || null;
        if (fbPublicCfAccountId) {}
      }
    }
  } catch (err) {
    console.error("[domains] Failed to load public CF from Firebase:", err.message);
  }
}

function getPublicCfToken() {
  let v = (process.env.PUBLIC_CF_API_TOKEN || fbPublicCfToken || CF_API_TOKEN || "").trim();
  if (v.startsWith('"') && v.endsWith('"') || v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
  return v.trim();
}

function getPublicCfAccountId() {
  let v = (process.env.PUBLIC_CF_ACCOUNT_ID || fbPublicCfAccountId || CF_ACCOUNT_ID || "").trim();
  if (v.startsWith('"') && v.endsWith('"') || v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
  return v.trim();
}

function getCfTokenForDoc(doc) {
  return doc.owner ? getPublicCfToken() : CF_API_TOKEN;
}

let VPS_IP = process.env.VPS_IP || "";

let VPS_IPV6 = process.env.VPS_IPV6 || "";

function setVpsIp(newIp) {
  if (newIp && newIp !== VPS_IP) {
    VPS_IP = newIp;
    try { process.env.VPS_IP = newIp; } catch {}
  }
}

function setVpsIpv6(newIpv6) {
  if (newIpv6 && newIpv6 !== VPS_IPV6) {
    VPS_IPV6 = newIpv6;
    try { process.env.VPS_IPV6 = newIpv6; } catch {}
  }
}

const PROPAGATION_TIMEOUT_MS = Number(process.env.PROPAGATION_TIMEOUT_MS || 6e5);

const PROPAGATION_INTERVAL_MS = Number(process.env.PROPAGATION_INTERVAL_MS || 3e4);

const PROPAGATION_RESOLVERS = [ "8.8.8.8", "1.1.1.1", "208.67.222.222" ];

const DOMAINS_COLLECTION = process.env.FIRESTORE_DOMAINS_COLLECTION || "domains";

const DOMAIN_LOGS_COLLECTION = process.env.FIRESTORE_DOMAIN_LOGS_COLLECTION || "domain_logs";

const domainsRef = firestore ? firestore.collection(DOMAINS_COLLECTION) : null;

const logsRef = firestore ? firestore.collection(DOMAIN_LOGS_COLLECTION) : null;

const domainsById = new Map;

const domainsByName = new Map;

const LOG_RING_SIZE = 500;

const logRing = [];

const propagationTimers = new Map;

const events = new EventEmitter;

events.setMaxListeners(0);

let ready = false;

let resolveReady;

const readyPromise = new Promise(resolve => {
  resolveReady = resolve;
});

function addLog(domainId, domain, level, message, step) {
  const entry = {
    id: crypto.randomUUID(),
    domain_id: domainId,
    domain: domain,
    level: level,
    message: message,
    step: step,
    timestamp: (new Date).toISOString()
  };
  logRing.push(entry);
  if (logRing.length > LOG_RING_SIZE) logRing.shift();
  if (logsRef) {
    logsRef.doc(entry.id).set(entry).catch(err => {
      console.error("[domains] Failed to persist log:", err.message);
    });
  }
  events.emit("log", entry);
  return entry;
}

function cfRequest(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const useToken = token || CF_API_TOKEN;
    if (!useToken) {
      reject(new Error("Cloudflare API token is not configured"));
      return;
    }
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: "api.cloudflare.com",
      port: 443,
      path: `/client/v4${path}`,
      method: method,
      headers: {
        authorization: `Bearer ${useToken}`,
        "content-type": "application/json",
        ...payload ? {
          "content-length": Buffer.byteLength(payload)
        } : {}
      },
      timeout: 3e4
    };
    const req = https.request(options, res => {
      let data = "";
      res.on("data", chunk => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (!parsed.success) {
            const errors = (parsed.errors || []).map(e => {
              const code = e.code ? `[${e.code}] ` : "";
              return `${code}${e.message}`;
            }).join("; ");
            const isAuthError = res.statusCode === 401 || res.statusCode === 403 || /invalid.*token|authentication|unauthorized|access.*denied|permission/i.test(errors);
            if (isAuthError) {
              reject(new Error(`Cloudflare auth failed (${res.statusCode}): ${errors}`));
            } else {
              reject(new Error(errors || `Cloudflare API error: ${res.statusCode}`));
            }
          } else {
            resolve(parsed);
          }
        } catch {
          reject(new Error(`Cloudflare API returned status ${res.statusCode}`));
        }
      });
    });
    req.on("error", err => reject(err));
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Cloudflare API timeout"));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

async function findZone(domain, token) {
  const parts = domain.split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join(".");
    try {
      const data = await cfRequest("GET", `/zones?name=${encodeURIComponent(candidate)}&status=active`, null, token);
      if (data.result && data.result.length > 0) {
        return data.result[0];
      }
    } catch {}
  }
  return null;
}

async function createZone(domain, token, accountId) {
  const useAccountId = accountId || CF_ACCOUNT_ID;
  if (!useAccountId) throw new Error("Cloudflare account ID is required to create new zones");
  const data = await cfRequest("POST", "/zones", {
    name: domain,
    account: {
      id: useAccountId
    },
    type: "full"
  }, token);
  return data.result;
}

async function createDnsRecord(zoneId, domain, type, content, proxied = true, token) {
  const data = await cfRequest("POST", `/zones/${zoneId}/dns_records`, {
    type: type,
    name: domain,
    content: content,
    proxied: proxied,
    ttl: 1
  }, token);
  return data.result;
}

async function deleteDnsRecord(zoneId, recordId, token) {
  await cfRequest("DELETE", `/zones/${zoneId}/dns_records/${recordId}`, null, token);
}

async function findDnsRecord(zoneId, domain, type, token) {
  const data = await cfRequest("GET", `/zones/${zoneId}/dns_records?name=${encodeURIComponent(domain)}&type=${type}`, null, token);
  return data.result && data.result.length > 0 ? data.result[0] : null;
}

async function findTxtRecordContaining(zoneId, name, marker, token) {
  const data = await cfRequest("GET", `/zones/${zoneId}/dns_records?name=${encodeURIComponent(name)}&type=TXT`, null, token);
  const list = data.result || [];
  return list.find(r => (r.content || "").includes(marker)) || null;
}

const MAIL_POSTURE_DMARC = "v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s";

async function ensureMailPostureRecords(zoneId, domain, token) {
  const created = [];
  const existingMx = await findDnsRecord(zoneId, domain, "MX", token);
  const existingSpf = await findTxtRecordContaining(zoneId, domain, "v=spf1", token);
  if (existingMx || existingSpf) return created;
  await cfRequest("POST", `/zones/${zoneId}/dns_records`, {
    type: "MX",
    name: domain,
    content: ".",
    priority: 0,
    proxied: false,
    ttl: 1
  }, token);
  created.push("MX (null)");
  await cfRequest("POST", `/zones/${zoneId}/dns_records`, {
    type: "TXT",
    name: domain,
    content: "v=spf1 -all",
    proxied: false,
    ttl: 1
  }, token);
  created.push("SPF (-all)");
  const dmarcHost = `_dmarc.${domain}`;
  const existingDmarc = await findTxtRecordContaining(zoneId, dmarcHost, "v=DMARC1", token);
  if (!existingDmarc) {
    await cfRequest("POST", `/zones/${zoneId}/dns_records`, {
      type: "TXT",
      name: dmarcHost,
      content: MAIL_POSTURE_DMARC,
      proxied: false,
      ttl: 1
    }, token);
    created.push("DMARC (reject)");
  }
  return created;
}

async function createOriginCert(domain, token) {
  const hostnames = [ domain, `*.${domain}` ];
  const data = await cfRequest("POST", "/certificates", {
    hostnames: hostnames,
    requested_validity: 5475,
    request_type: "origin-rsa",
    csr: ""
  }, token);
  return data.result;
}

async function revokeOriginCert(certId, token) {
  try {
    await cfRequest("DELETE", `/certificates/${certId}`, null, token);
  } catch {}
}

function checkPropagation(domain, expectedIps) {
  return new Promise(resolve => {
    const results = [];
    let completed = 0;
    for (const resolver of PROPAGATION_RESOLVERS) {
      const r = new dns.Resolver;
      r.setServers([ resolver ]);
      r.resolve4(domain, (err, addresses) => {
        completed++;
        if (err) {
          results.push({
            resolver: resolver,
            resolved: false,
            error: err.code
          });
        } else {
          const match = addresses.some(a => expectedIps.includes(a));
          results.push({
            resolver: resolver,
            resolved: true,
            addresses: addresses,
            match: match
          });
        }
        if (completed === PROPAGATION_RESOLVERS.length) {
          const allResolved = results.every(r => r.resolved && r.match);
          resolve({
            propagated: allResolved,
            results: results
          });
        }
      });
    }
  });
}

function startPropagationMonitor(domainDoc) {
  if (propagationTimers.has(domainDoc.id)) return;
  const startTime = Date.now();
  const expectedIps = [ domainDoc.vps_ip ];
  const checkResolvesAtAll = domainDoc.cf_proxied !== false;
  addLog(domainDoc.id, domainDoc.domain, "info", "Propagation monitoring started", "propagation");
  const interval = setInterval(async () => {
    try {
      const elapsed = Date.now() - startTime;
      if (checkResolvesAtAll) {
        const result = await checkPropagationCfProxied(domainDoc.domain);
        if (result.propagated) {
          clearInterval(interval);
          propagationTimers.delete(domainDoc.id);
          await updateDomain(domainDoc.id, {
            propagation_status: "propagated",
            propagation_checked_at: (new Date).toISOString(),
            verified_at: (new Date).toISOString(),
            status: "active"
          });
          await setStep(domainDoc.id, "propagation", "done", `DNS propagated - resolved by all ${PROPAGATION_RESOLVERS.length} public resolvers`);
          addLog(domainDoc.id, domainDoc.domain, "info", `DNS propagated - resolved by all ${PROPAGATION_RESOLVERS.length} resolvers`, "propagation");
          events.emit("domain:active", domainDoc);
          return;
        }
      } else {
        const result = await checkPropagation(domainDoc.domain, expectedIps);
        if (result.propagated) {
          clearInterval(interval);
          propagationTimers.delete(domainDoc.id);
          await updateDomain(domainDoc.id, {
            propagation_status: "propagated",
            propagation_checked_at: (new Date).toISOString(),
            verified_at: (new Date).toISOString(),
            status: "active"
          });
          await setStep(domainDoc.id, "propagation", "done", `DNS propagated - all resolvers return ${domainDoc.vps_ip}`);
          addLog(domainDoc.id, domainDoc.domain, "info", `DNS propagated - all resolvers return ${domainDoc.vps_ip}`, "propagation");
          events.emit("domain:active", domainDoc);
          return;
        }
      }
      if (elapsed > PROPAGATION_TIMEOUT_MS) {
        clearInterval(interval);
        propagationTimers.delete(domainDoc.id);
        await updateDomain(domainDoc.id, {
          propagation_status: "timeout",
          propagation_checked_at: (new Date).toISOString(),
          status: "active",
          error: "Propagation check timed out - domain may still work via Cloudflare"
        });
        await setStep(domainDoc.id, "propagation", "done", `Propagation check timed out after ${Math.round(elapsed / 1e3)}s - domain is active (Cloudflare routing works regardless)`);
        addLog(domainDoc.id, domainDoc.domain, "warn", `Propagation timeout after ${Math.round(elapsed / 1e3)}s - marked active (CF routing works regardless)`, "propagation");
        events.emit("domain:active", domainDoc);
      } else {
        await updateDomain(domainDoc.id, {
          propagation_status: "checking",
          propagation_checked_at: (new Date).toISOString()
        });
        const resolverStatus = PROPAGATION_RESOLVERS.map(r => r).join(", ");
        await setStep(domainDoc.id, "propagation", "in_progress", `Checking DNS propagation...\nResolvers: ${resolverStatus}\nLast check: ${(new Date).toLocaleTimeString()}`);
      }
    } catch (err) {
      addLog(domainDoc.id, domainDoc.domain, "error", `Propagation check error: ${err.message}`, "propagation");
    }
  }, PROPAGATION_INTERVAL_MS);
  interval.unref();
  propagationTimers.set(domainDoc.id, interval);
}

function checkPropagationCfProxied(domain) {
  return new Promise(resolve => {
    const results = [];
    let completed = 0;
    for (const resolver of PROPAGATION_RESOLVERS) {
      const r = new dns.Resolver;
      r.setServers([ resolver ]);
      r.resolve4(domain, (err, addresses) => {
        completed++;
        if (err) {
          results.push({
            resolver: resolver,
            resolved: false,
            error: err.code
          });
        } else {
          results.push({
            resolver: resolver,
            resolved: true,
            addresses: addresses,
            match: addresses.length > 0
          });
        }
        if (completed === PROPAGATION_RESOLVERS.length) {
          const allResolved = results.every(r => r.resolved && r.match);
          resolve({
            propagated: allResolved,
            results: results
          });
        }
      });
    }
  });
}

function normalizeDomain(data) {
  return {
    id: data.id || "",
    domain: String(data.domain || "").toLowerCase().trim(),
    cf_zone_id: data.cf_zone_id || null,
    cf_zone_name: data.cf_zone_name || null,
    cf_record_id: data.cf_record_id || null,
    cf_record_id_v6: data.cf_record_id_v6 || null,
    cf_record_type: data.cf_record_type || "A",
    cf_proxied: data.cf_proxied !== false,
    cf_cert_id: data.cf_cert_id || null,
    vps_ip: data.vps_ip || VPS_IP,
    vps_ipv6: data.vps_ipv6 || VPS_IPV6 || null,
    ssl_status: data.ssl_status || "pending",
    propagation_status: data.propagation_status || "pending",
    propagation_checked_at: data.propagation_checked_at || null,
    status: data.status || "provisioning",
    error: data.error || null,
    added_at: data.added_at || (new Date).toISOString(),
    verified_at: data.verified_at || null,
    nameservers: data.nameservers || null,
    nameserver_status: data.nameserver_status || "pending",
    nameserver_checked_at: data.nameserver_checked_at || null,
    setup_instructions: data.setup_instructions || null,
    is_new_zone: data.is_new_zone || false,
    steps: data.steps || null,
    pre_check: data.pre_check || null,
    owner: data.owner || null
  };
}

async function updateDomain(id, patch) {
  const existing = domainsById.get(id);
  if (!existing) return null;
  const updated = {
    ...existing,
    ...patch
  };
  domainsById.set(id, updated);
  domainsByName.set(updated.domain, updated);
  if (domainsRef) {
    await domainsRef.doc(id).set(updated, {
      merge: true
    });
  }
  return updated;
}

function resolveNs(domain) {
  return new Promise(resolve => {
    const resolver = new dns.Resolver;
    resolver.setServers([ "8.8.8.8", "1.1.1.1" ]);
    resolver.resolveNs(domain, (err, addresses) => {
      if (err) {
        resolve({
          ns: [],
          error: err.code
        });
      } else {
        resolve({
          ns: (addresses || []).map(s => s.toLowerCase().replace(/\.$/, "")),
          error: null
        });
      }
    });
  });
}

function resolveA(domain) {
  return new Promise(resolve => {
    const resolver = new dns.Resolver;
    resolver.setServers([ "8.8.8.8", "1.1.1.1" ]);
    resolver.resolve4(domain, (err, addresses) => {
      if (err) {
        resolve({
          ips: [],
          error: err.code
        });
      } else {
        resolve({
          ips: addresses || [],
          error: null
        });
      }
    });
  });
}

const CLOUDFLARE_NS_PATTERN = /\.cloudflare\.com$/i;

async function preCheckDomain(domain, cfToken) {
  const [nsResult, aResult, zone] = await Promise.all([ resolveNs(domain), resolveA(domain), findZone(domain, cfToken).catch(() => null) ]);
  const hasCloudflareNs = nsResult.ns.some(ns => CLOUDFLARE_NS_PATTERN.test(ns));
  const hasZoneInAccount = !!zone;
  const resolvesToVps = aResult.ips.includes(VPS_IP);
  let scenario;
  if (hasZoneInAccount) {
    scenario = "zone_in_account";
  } else if (hasCloudflareNs) {
    scenario = "cf_ns_other_account";
  } else if (nsResult.ns.length > 0) {
    scenario = "needs_ns_change";
  } else {
    scenario = "new_domain";
  }
  return {
    domain: domain,
    nameservers: nsResult.ns,
    nameserver_error: nsResult.error,
    has_cloudflare_ns: hasCloudflareNs,
    a_records: aResult.ips,
    a_record_error: aResult.error,
    resolves_to_vps: resolvesToVps,
    has_zone_in_account: hasZoneInAccount,
    zone_id: zone ? zone.id : null,
    zone_name: zone ? zone.name : null,
    scenario: scenario,
    checked_at: (new Date).toISOString()
  };
}

function makeStep(key, title, status = "pending", detail = "") {
  return {
    key: key,
    title: title,
    status: status,
    detail: detail,
    updated_at: (new Date).toISOString()
  };
}

async function setStep(id, key, status, detail) {
  const doc = domainsById.get(id);
  if (!doc) return;
  const steps = [ ...doc.steps || [] ];
  const idx = steps.findIndex(s => s.key === key);
  const updated = makeStep(key, steps[idx]?.title || key, status, detail || steps[idx]?.detail || "");
  if (idx >= 0) steps[idx] = updated; else steps.push(updated);
  await updateDomain(id, {
    steps: steps
  });
}

function initSteps(isNewZone) {
  const steps = [ makeStep("zone", "Cloudflare Zone", "pending") ];
  if (isNewZone) {}
  return steps;
}

const nsCheckTimers = new Map;

function checkNameservers(domain, expectedNs) {
  return new Promise(resolve => {
    const resolver = new dns.Resolver;
    resolver.setServers([ "8.8.8.8", "1.1.1.1" ]);
    resolver.resolveNs(domain, (err, addresses) => {
      if (err) {
        resolve({
          matched: false,
          actual: [],
          expected: expectedNs,
          error: err.code
        });
        return;
      }
      const actual = (addresses || []).map(ns => ns.toLowerCase().replace(/\.$/, ""));
      const expected = (expectedNs || []).map(ns => ns.toLowerCase().replace(/\.$/, ""));
      const matched = expected.length > 0 && expected.every(ns => actual.some(a => a === ns || a.endsWith("." + ns) || ns.endsWith("." + a)));
      resolve({
        matched: matched,
        actual: actual,
        expected: expected,
        error: null
      });
    });
  });
}

function startNameserverMonitor(domainDoc) {
  if (nsCheckTimers.has(domainDoc.id)) return;
  const {id: id, domain: domain, nameservers: nameservers} = domainDoc;
  if (!nameservers || nameservers.length === 0) return;
  addLog(id, domain, "info", "Waiting for nameserver update at registrar...", "nameserver");
  setStep(id, "nameserver", "waiting_user", `Update your domain's nameservers at your registrar to:\n${nameservers.map(ns => `  • ${ns}`).join("\n")}\n\nThe engine will detect the change automatically.`);
  const startTime = Date.now();
  const interval = setInterval(async () => {
    try {
      const result = await checkNameservers(domain, nameservers);
      const elapsed = Date.now() - startTime;
      await updateDomain(id, {
        nameserver_status: result.matched ? "verified" : "pending",
        nameserver_checked_at: (new Date).toISOString()
      });
      if (result.matched) {
        clearInterval(interval);
        nsCheckTimers.delete(id);
        addLog(id, domain, "info", `Nameservers verified! Detected: ${result.actual.join(", ")}`, "nameserver");
        await setStep(id, "nameserver", "done", `Nameservers verified - detected: ${result.actual.join(", ")}`);
        await updateDomain(id, {
          nameserver_status: "active"
        });
        addLog(id, domain, "info", "Nameservers verified - continuing domain setup...", "nameserver");
        try {
          const doc = domainsById.get(id);
          if (doc && doc.cf_zone_id) {
            const cfToken = getCfTokenForDoc(doc);
            const zone = await findZone(domain, cfToken);
            if (zone) {
              await createDnsAndSsl(id, domain, zone, cfToken);
              await continueProvisioningAfterNs(id);
            }
          }
        } catch (err) {
          addLog(id, domain, "error", `Failed to continue setup after NS verification: ${err.message}`, "nameserver");
          await setStep(id, "dns", "error", `Failed: ${err.message}`);
          await setStep(id, "ssl", "error", `Failed: ${err.message}`);
        }
      } else if (elapsed > PROPAGATION_TIMEOUT_MS) {
        clearInterval(interval);
        nsCheckTimers.delete(id);
        addLog(id, domain, "warn", `Nameserver check timeout - please update your nameservers to continue`, "nameserver");
        await setStep(id, "nameserver", "waiting_user", `Timeout waiting for nameserver verification. Please update your nameservers at your registrar to:\n${nameservers.map(ns => `  • ${ns}`).join("\n")}\n\nOnce updated, click "Verify" to retry.`);
        await updateDomain(id, {
          nameserver_status: "pending"
        });
      } else {
        const actualStr = result.actual.length > 0 ? result.actual.join(", ") : "not set yet";
        await setStep(id, "nameserver", "waiting_user", `Waiting for nameserver update...\n\nRequired: ${nameservers.map(ns => `  • ${ns}`).join("\n")}\n\nDetected at registrar: ${actualStr}\n\nLast checked: ${(new Date).toLocaleTimeString()}`);
      }
    } catch (err) {
      addLog(id, domain, "error", `NS check error: ${err.message}`, "nameserver");
    }
  }, 1e4);
  interval.unref();
  nsCheckTimers.set(id, interval);
}

async function addDomain(domain, options = {}) {
  domain = String(domain || "").toLowerCase().trim();
  if (!domain) throw new Error("Domain is required");
  if (!/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(domain)) {
    throw new Error("Invalid domain format");
  }
  if (domainsByName.has(domain)) {
    throw new Error(`Domain "${domain}" already exists`);
  }
  if (!VPS_IP) throw new Error("VPS_IP environment variable is not configured");
  if (options.owner && !getPublicCfToken()) {
    throw new Error("Public Cloudflare is not configured. Ask the admin to set it up in the Unidral page.");
  }
  if (!options.owner && !CF_API_TOKEN) {
    throw new Error("Cloudflare API token is not configured.");
  }
  const proxied = options.proxied !== false;
  const id = crypto.randomUUID();
  const doc = normalizeDomain({
    id: id,
    domain: domain,
    vps_ip: VPS_IP,
    vps_ipv6: VPS_IPV6,
    cf_proxied: proxied,
    owner: options.owner || null
  });
  domainsById.set(id, doc);
  domainsByName.set(domain, doc);
  if (domainsRef) {
    await domainsRef.doc(id).set(doc);
  }
  addLog(id, domain, "info", "Domain provisioning started", "init");
  preCheckAndProvision(doc).catch(err => {
    addLog(id, domain, "error", `Provisioning failed: ${err.message}`, "init");
    updateDomain(id, {
      status: "error",
      error: err.message
    });
    setStep(id, "zone", "error", `Failed: ${err.message}`);
  });
  return doc;
}

async function preCheckAndProvision(doc) {
  const {id: id, domain: domain} = doc;
  const cfToken = getCfTokenForDoc(doc);
  const steps = [ makeStep("precheck", "Domain DNS Check", "in_progress", "Checking current DNS state...") ];
  await updateDomain(id, {
    steps: steps
  });
  addLog(id, domain, "info", "Running pre-provisioning DNS check...", "precheck");
  const preCheck = await preCheckDomain(domain, cfToken);
  await updateDomain(id, {
    pre_check: preCheck
  });
  const scenarioLabels = {
    zone_in_account: "Domain is already configured in Unidral",
    cf_ns_other_account: "Nameservers already point to Unidral - configuring domain",
    needs_ns_change: `Domain has nameservers (${preCheck.nameservers.join(", ")}) - needs to switch to Unidral nameservers`,
    new_domain: "Domain does not resolve yet - new domain"
  };
  addLog(id, domain, "info", `Pre-check: ${scenarioLabels[preCheck.scenario]}`, "precheck");
  const preCheckDetail = [ `Current nameservers: ${preCheck.nameservers.length > 0 ? preCheck.nameservers.join(", ") : "none (domain not registered or no NS set)"}`, `Unidral NS detected: ${preCheck.has_cloudflare_ns ? "yes" : "no"}`, `A records: ${preCheck.a_records.length > 0 ? preCheck.a_records.join(", ") : "none"}`, `Resolves to VPS (${VPS_IP}): ${preCheck.resolves_to_vps ? "yes" : "no"}`, `Domain already in Unidral: ${preCheck.has_zone_in_account ? "yes" : "no"}`, "", `Assessment: ${scenarioLabels[preCheck.scenario]}` ].join("\n");
  await setStep(id, "precheck", "done", preCheckDetail);
  await provisionDomain(domainsById.get(id));
}

async function provisionDomain(doc) {
  const {id: id, domain: domain} = doc;
  const preCheck = doc.pre_check;
  const cfToken = getCfTokenForDoc(doc);
  const cfAccountId = doc.owner ? getPublicCfAccountId() : CF_ACCOUNT_ID;
  await setStep(id, "zone", "in_progress", "Adding domain to Unidral...");
  let zone = null;
  let isNewZone = false;
  if (preCheck && preCheck.has_zone_in_account && preCheck.zone_id) {
    addLog(id, domain, "info", `Pre-check found zone in account: ${preCheck.zone_name}`, "cloudflare_zone");
    zone = await findZone(domain, cfToken);
  }
  if (!zone) {
    if (preCheck && preCheck.scenario === "cf_ns_other_account") {
      addLog(id, domain, "warn", "Nameservers point to Cloudflare but zone is in another account. Creating a new zone.", "cloudflare_zone");
    }
    addLog(id, domain, "info", "Zone not found - creating new zone", "cloudflare_zone");
    zone = await createZone(domain, cfToken, cfAccountId);
    isNewZone = true;
    addLog(id, domain, "info", `Zone created: ${zone.name} (ID: ${zone.id})`, "cloudflare_zone");
    if (zone.name_servers) {
      await updateDomain(id, {
        nameservers: zone.name_servers,
        is_new_zone: true
      });
      addLog(id, domain, "warn", `Zone created - nameservers must be updated at registrar: ${zone.name_servers.join(", ")}`, "cloudflare_zone");
      await setStep(id, "zone", "done", `Domain added to Unidral.\nAssigned nameservers:\n${zone.name_servers.map(ns => `  • ${ns}`).join("\n")}`);
    }
  } else {
    addLog(id, domain, "info", `Found existing zone: ${zone.name} (ID: ${zone.id})`, "cloudflare_zone");
    await setStep(id, "zone", "done", `Domain already configured in Unidral: ${zone.name}`);
  }
  await updateDomain(id, {
    cf_zone_id: zone.id,
    cf_zone_name: zone.name
  });
  if (isNewZone && zone.name_servers && zone.name_servers.length > 0) {
    const nsCheck = await checkNameservers(domain, zone.name_servers);
    if (nsCheck.matched) {
      addLog(id, domain, "info", `Nameservers already correct! Detected: ${nsCheck.actual.join(", ")}`, "nameserver");
      await updateDomain(id, {
        nameserver_status: "active"
      });
      await setStep(id, "nameserver", "done", `Nameservers already pointing to Unidral - detected: ${nsCheck.actual.join(", ")}`);
      await createDnsAndSsl(id, domain, zone, cfToken);
      await continueProvisioningAfterNs(id);
    } else {
      await setStep(id, "nameserver", "waiting_user", `Update your domain's nameservers at your registrar to:\n${zone.name_servers.map(ns => `  • ${ns}`).join("\n")}\n\nThe engine will automatically continue setup once your nameservers are updated.`);
      await setStep(id, "dns", "pending", "Waiting for nameservers to be updated...");
      await setStep(id, "ssl", "pending", "Waiting for nameservers to be updated...");
      await setStep(id, "engine", "pending", "Waiting for nameservers to be updated...");
      await setStep(id, "propagation", "pending", "Waiting for nameservers to be updated...");
      startNameserverMonitor(domainsById.get(id));
    }
  } else {
    await updateDomain(id, {
      nameserver_status: "active"
    });
    await setStep(id, "nameserver", "done", "Nameservers already configured - no action needed");
    await createDnsAndSsl(id, domain, zone, cfToken);
    await continueProvisioningAfterNs(id);
  }
}

async function createDnsAndSsl(id, domain, zone, cfToken) {
  const doc = domainsById.get(id);
  const proxied = doc ? doc.cf_proxied !== false : true;
  const proxiedLabel = proxied ? "proxied" : "DNS-only";
  await setStep(id, "dns", "in_progress", "Creating DNS records...");
  addLog(id, domain, "info", `Creating DNS A record → ${VPS_IP} (${proxiedLabel})`, "cloudflare_dns");
  let existingRecord = await findDnsRecord(zone.id, domain, "A", cfToken);
  let recordId;
  if (existingRecord) {
    addLog(id, domain, "info", `A record already exists (${existingRecord.content}) - updating`, "cloudflare_dns");
    await cfRequest("PATCH", `/zones/${zone.id}/dns_records/${existingRecord.id}`, {
      content: VPS_IP,
      proxied: proxied,
      ttl: 1
    }, cfToken);
    recordId = existingRecord.id;
  } else {
    const record = await createDnsRecord(zone.id, domain, "A", VPS_IP, proxied, cfToken);
    recordId = record.id;
  }
  await updateDomain(id, {
    cf_record_id: recordId,
    cf_record_type: "A"
  });
  const wildcardDomain = `*.${domain}`;
  let existingWildcard = await findDnsRecord(zone.id, wildcardDomain, "A", cfToken);
  if (existingWildcard) {
    await cfRequest("PATCH", `/zones/${zone.id}/dns_records/${existingWildcard.id}`, {
      content: VPS_IP,
      proxied: proxied,
      ttl: 1
    }, cfToken);
  } else {
    await createDnsRecord(zone.id, wildcardDomain, "A", VPS_IP, proxied, cfToken);
    addLog(id, domain, "info", `Wildcard DNS record created: *.${domain} → ${VPS_IP} (${proxiedLabel})`, "cloudflare_dns");
  }
  if (VPS_IPV6) {
    let existing6 = await findDnsRecord(zone.id, domain, "AAAA", cfToken);
    if (existing6) {
      await cfRequest("PATCH", `/zones/${zone.id}/dns_records/${existing6.id}`, {
        content: VPS_IPV6,
        proxied: proxied,
        ttl: 1
      }, cfToken);
    } else {
      const rec6 = await createDnsRecord(zone.id, domain, "AAAA", VPS_IPV6, proxied, cfToken);
      await updateDomain(id, {
        cf_record_id_v6: rec6.id
      });
      addLog(id, domain, "info", `DNS AAAA record created → ${VPS_IPV6} (${proxiedLabel})`, "cloudflare_dns");
    }
  }
  let mailPosture = [ "MX (null)", "SPF (-all)", "DMARC (reject)" ];
  try {
    const mailCreated = await ensureMailPostureRecords(zone.id, domain, cfToken);
    mailPosture = mailCreated;
    if (mailCreated.length > 0) {
      addLog(id, domain, "info", `Mail posture records created: ${mailCreated.join(", ")}`, "cloudflare_dns");
    } else {
      addLog(id, domain, "info", "Mail posture records already present - skipped", "cloudflare_dns");
    }
  } catch (err) {
    mailPosture = [];
    addLog(id, domain, "warn", `Mail posture records failed: ${err.message}`, "cloudflare_dns");
  }
  const dnsDetail = `DNS records created:\n  • A    ${domain}        → ${VPS_IP}  (${proxiedLabel})\n  • A    *.${domain}    → ${VPS_IP}  (${proxiedLabel})` + (VPS_IPV6 ? `\n  • AAAA ${domain}        → ${VPS_IPV6}  (${proxiedLabel})` : "") + (mailPosture.length > 0 ? `\n  • Mail posture: ${mailPosture.join(", ")}` : "");
  await setStep(id, "dns", "done", dnsDetail);
  addLog(id, domain, "info", `DNS A record active → ${VPS_IP} (${proxiedLabel})`, "cloudflare_dns");
  await setStep(id, "ssl", "in_progress", "Provisioning SSL certificate...");
  addLog(id, domain, "info", "Provisioning SSL certificate...", "ssl_cert");
  try {
    const cert = await createOriginCert(domain, cfToken);
    await updateDomain(id, {
      cf_cert_id: cert.id,
      ssl_status: "active"
    });
    await setStep(id, "ssl", "done", `Origin certificate provisioned (covers ${domain} + *.${domain}, valid 15 years)`);
    addLog(id, domain, "info", `Origin certificate provisioned (covers ${domain} + *.${domain})`, "ssl_cert");
  } catch (err) {
    await updateDomain(id, {
      ssl_status: "cf_universal"
    });
    await setStep(id, "ssl", "done", `SSL certificate active (fully encrypted)`);
    addLog(id, domain, "warn", `Origin cert failed (${err.message}) - Cloudflare Universal SSL will be used`, "ssl_cert");
  }
}

async function continueProvisioningAfterNs(id) {
  const doc = domainsById.get(id);
  if (!doc) return;
  const {domain: domain} = doc;
  await setStep(id, "engine", "in_progress", "Registering domain in engine...");
  events.emit("domain:added", doc);
  addLog(id, domain, "info", "Domain registered in engine (live, no restart required)", "engine_sync");
  await setStep(id, "engine", "done", "Domain is live in the engine - no restart needed");
  await updateDomain(id, {
    status: "active"
  });
  await setStep(id, "propagation", "in_progress", "Checking DNS propagation across public resolvers...");
  await updateDomain(id, {
    propagation_status: "checking"
  });
  startPropagationMonitor(domainsById.get(id));
}

function buildSetupInstructions(domain, doc) {
  const steps = [];
  if (doc.is_new_zone && doc.nameservers && doc.nameservers.length > 0) {
    steps.push({
      step: 1,
      title: "Update Nameservers at Your Registrar",
      status: "required",
      detail: `Your domain "${domain}" was added as a new Cloudflare zone. ` + `Log in to your domain registrar (GoDaddy, Namecheap, etc.) and change the ` + `nameservers to:\n\n${doc.nameservers.map(ns => `  • ${ns}`).join("\n")}\n\n` + `DNS propagation for nameserver changes can take 1-24 hours. ` + `The domain will become active automatically once propagation completes.`
    });
  } else if (doc.cf_zone_id) {
    steps.push({
      step: 1,
      title: "Cloudflare Zone Active",
      status: "done",
      detail: `Your domain "${domain}" is already in a Cloudflare zone. ` + `No nameserver changes needed.`
    });
  }
  steps.push({
    step: doc.is_new_zone ? 2 : 1,
    title: "DNS Records (Auto-Created)",
    status: "done",
    detail: `The following DNS records were created in Cloudflare:\n\n` + `  • A    ${domain}        → ${doc.vps_ip}  (${doc.cf_proxied !== false ? "proxied" : "DNS-only"})\n` + `  • A    *.${domain}    → ${doc.vps_ip}  (${doc.cf_proxied !== false ? "proxied" : "DNS-only"})\n` + (doc.vps_ipv6 ? `  • AAAA ${domain}        → ${doc.vps_ipv6}  (${doc.cf_proxied !== false ? "proxied" : "DNS-only"})\n` : "")
  });
  steps.push({
    step: doc.is_new_zone ? 3 : 2,
    title: "SSL Certificate",
    status: doc.ssl_status === "active" ? "done" : doc.ssl_status === "cf_universal" ? "done" : "pending",
    detail: doc.ssl_status === "active" ? `Cloudflare Origin Certificate provisioned (covers ${domain} and *.${domain}).` : doc.ssl_status === "cf_universal" ? `Using Cloudflare Universal SSL. The connection is encrypted end-to-end.` : `SSL certificate is being provisioned. Cloudflare Universal SSL will be available shortly.`
  });
  steps.push({
    step: doc.is_new_zone ? 4 : 3,
    title: "Propagation Check",
    status: doc.propagation_status === "propagated" ? "done" : "pending",
    detail: doc.propagation_status === "propagated" ? `DNS has propagated - domain is live and ready for use.` : `Monitoring DNS propagation across multiple resolvers. ` + `The domain is usable immediately via Cloudflare's network even before public DNS caches update.`
  });
  if (!doc.is_new_zone) {
    steps.push({
      step: 4,
      title: "Ready to Use",
      status: doc.status === "active" ? "done" : "pending",
      detail: `You can now create sites using "${domain}" as the base domain. ` + `Go to the Sites page and select "${domain}" from the base domain dropdown when adding a new site.`
    });
  }
  return {
    domain: domain,
    is_new_zone: !!doc.is_new_zone,
    nameservers: doc.nameservers || null,
    steps: steps
  };
}

async function removeDomain(id) {
  const doc = domainsById.get(id);
  if (!doc) throw new Error("Domain not found");
  addLog(id, doc.domain, "info", "Domain removal started", "removal");
  await updateDomain(id, {
    status: "removing"
  });
  if (propagationTimers.has(id)) {
    clearInterval(propagationTimers.get(id));
    propagationTimers.delete(id);
  }
  if (nsCheckTimers.has(id)) {
    clearInterval(nsCheckTimers.get(id));
    nsCheckTimers.delete(id);
  }
  let cfToken = getCfTokenForDoc(doc);
  const altToken = cfToken === getPublicCfToken() ? CF_API_TOKEN : getPublicCfToken();
  async function tryCfOp(label, fn) {
    try {
      await fn(cfToken);
      addLog(id, doc.domain, "info", `${label} (primary token)`, "removal");
      return true;
    } catch (err) {
      if (altToken && /403|401|auth/i.test(err.message)) {
        addLog(id, doc.domain, "warn", `Primary token failed for ${label}, trying alt...`, "removal");
        try {
          await fn(altToken);
          addLog(id, doc.domain, "info", `${label} (alt token)`, "removal");
          cfToken = altToken;
          return true;
        } catch (err2) {
          addLog(id, doc.domain, "warn", `Failed ${label}: ${err2.message}`, "removal");
        }
      } else {
        addLog(id, doc.domain, "warn", `Failed ${label}: ${err.message}`, "removal");
      }
      return false;
    }
  }
  if (doc.cf_zone_id && doc.cf_record_id) {
    await tryCfOp("DNS A record deleted", t => deleteDnsRecord(doc.cf_zone_id, doc.cf_record_id, t));
  }
  if (doc.cf_zone_id && doc.cf_record_id_v6) {
    await tryCfOp("DNS AAAA record deleted", t => deleteDnsRecord(doc.cf_zone_id, doc.cf_record_id_v6, t));
  }
  if (doc.cf_cert_id) {
    await tryCfOp("Origin certificate revoked", t => revokeOriginCert(doc.cf_cert_id, t));
  }
  if (doc.cf_zone_id) {
    await tryCfOp("Zone deleted from Cloudflare", t => cfRequest("DELETE", `/zones/${doc.cf_zone_id}`, null, t));
  }
  domainsById.delete(id);
  domainsByName.delete(doc.domain);
  if (domainsRef) {
    await domainsRef.doc(id).delete();
  }
  addLog(id, doc.domain, "info", "Domain fully removed", "removal");
  events.emit("domain:removed", doc);
  return doc;
}

async function updateProxied(id, proxied) {
  const doc = domainsById.get(id);
  if (!doc) throw new Error("Domain not found");
  if (typeof proxied !== "boolean") throw new Error("proxied must be a boolean");
  const proxiedLabel = proxied ? "proxied (orange cloud)" : "DNS-only (grey cloud)";
  addLog(id, doc.domain, "info", `Toggling proxy → ${proxiedLabel}`, "proxy_toggle");
  if (!doc.cf_zone_id) {
    throw new Error("Domain has no Cloudflare zone - cannot toggle proxy");
  }
  const cfToken = getCfTokenForDoc(doc);
  addLog(id, doc.domain, "info", `Using ${doc.owner ? "public" : "private"} CF token (len=${cfToken.length}, zone=${doc.cf_zone_id})`, "proxy_toggle");
  const recordIds = [ {
    id: doc.cf_record_id,
    type: "A"
  }, {
    id: doc.cf_record_id_v6,
    type: "AAAA"
  } ].filter(r => r.id);
  if (recordIds.length === 0) {
    throw new Error("No DNS record IDs found for this domain. The domain may not have been fully provisioned.");
  }
  const errors = [];
  for (const rec of recordIds) {
    try {
      await cfRequest("PATCH", `/zones/${doc.cf_zone_id}/dns_records/${rec.id}`, {
        proxied: proxied
      }, cfToken);
      addLog(id, doc.domain, "info", `${rec.type} record updated → ${proxiedLabel}`, "proxy_toggle");
    } catch (err) {
      addLog(id, doc.domain, "error", `Failed to update ${rec.type} record: ${err.message}`, "proxy_toggle");
      errors.push(`${rec.type}: ${err.message}`);
    }
  }
  try {
    const wildcard = await findDnsRecord(doc.cf_zone_id, `*.${doc.domain}`, "A", cfToken);
    if (wildcard) {
      await cfRequest("PATCH", `/zones/${doc.cf_zone_id}/dns_records/${wildcard.id}`, {
        proxied: proxied
      }, cfToken);
      addLog(id, doc.domain, "info", `Wildcard A record updated → ${proxiedLabel}`, "proxy_toggle");
    }
  } catch (err) {
    addLog(id, doc.domain, "error", `Failed to update wildcard record: ${err.message}`, "proxy_toggle");
    errors.push(`wildcard: ${err.message}`);
  }
  const totalAttempts = recordIds.length + 1;
  if (errors.length >= totalAttempts) {
    const tokenLen = cfToken.length;
    throw new Error(`Failed to update proxy: ${errors.join("; ")}. Token: ${doc.owner ? "public" : "private"} (len=${tokenLen}). If len is not 40, the token may be corrupted - re-enter it in Settings > Unidral.`);
  }
  const updated = await updateDomain(id, {
    cf_proxied: proxied
  });
  addLog(id, doc.domain, "info", `Proxy is now ${proxiedLabel}`, "proxy_toggle");
  return updated;
}

async function verifyDomain(id) {
  const doc = domainsById.get(id);
  if (!doc) throw new Error("Domain not found");
  addLog(id, doc.domain, "info", "Manual verification check triggered", "propagation");
  if (doc.is_new_zone && doc.nameservers && doc.nameserver_status !== "active" && doc.nameserver_status !== "verified") {
    addLog(id, doc.domain, "info", "Checking nameserver status...", "nameserver");
    const nsCheck = await checkNameservers(doc.domain, doc.nameservers);
    await updateDomain(id, {
      nameserver_status: nsCheck.matched ? "verified" : "pending",
      nameserver_checked_at: (new Date).toISOString()
    });
    if (nsCheck.matched) {
      addLog(id, doc.domain, "info", `Nameservers verified! Detected: ${nsCheck.actual.join(", ")}`, "nameserver");
      await setStep(id, "nameserver", "done", `Nameservers verified - detected: ${nsCheck.actual.join(", ")}`);
      await updateDomain(id, {
        nameserver_status: "active"
      });
      addLog(id, doc.domain, "info", "Nameservers verified - continuing domain setup...", "nameserver");
      try {
        if (doc.cf_zone_id) {
          const cfToken = getCfTokenForDoc(doc);
          const zone = await findZone(doc.domain, cfToken);
          if (zone) {
            await createDnsAndSsl(id, doc.domain, zone, cfToken);
            await continueProvisioningAfterNs(id);
          }
        }
      } catch (err) {
        addLog(id, doc.domain, "error", `Failed to continue setup after NS verification: ${err.message}`, "nameserver");
        await setStep(id, "dns", "error", `Failed: ${err.message}`);
        await setStep(id, "ssl", "error", `Failed: ${err.message}`);
      }
      return domainsById.get(id);
    } else {
      addLog(id, doc.domain, "warn", `Nameservers not yet updated. Required: ${doc.nameservers.join(", ")}. Detected: ${nsCheck.actual.join(", ") || "none"}`, "nameserver");
      await setStep(id, "nameserver", "waiting_user", `Nameservers not yet updated.\n\nRequired: ${doc.nameservers.map(ns => `  • ${ns}`).join("\n")}\n\nDetected: ${nsCheck.actual.join(", ") || "none"}`);
      return domainsById.get(id);
    }
  }
  addLog(id, doc.domain, "info", "Checking DNS propagation...", "propagation");
  const result = doc.cf_proxied !== false ? await checkPropagationCfProxied(doc.domain) : await checkPropagation(doc.domain, [ doc.vps_ip ]);
  if (result.propagated) {
    await updateDomain(id, {
      propagation_status: "propagated",
      propagation_checked_at: (new Date).toISOString(),
      verified_at: (new Date).toISOString(),
      status: "active",
      error: null
    });
    addLog(id, doc.domain, "info", "Propagation verified - domain is active", "propagation");
  } else {
    const details = result.results.map(r => `${r.resolver}: ${r.resolved ? r.match ? "OK" : `wrong IP (${r.addresses})` : r.error}`).join(", ");
    await updateDomain(id, {
      propagation_status: "pending",
      propagation_checked_at: (new Date).toISOString()
    });
    addLog(id, doc.domain, "warn", `Not yet propagated: ${details}`, "propagation");
  }
  return domainsById.get(id);
}

function getDomains() {
  return [ ...domainsById.values() ];
}

function getDomain(id) {
  return domainsById.get(id) || null;
}

function getDomainByName(name) {
  return domainsByName.get(String(name).toLowerCase().trim()) || null;
}

function getLogs(options = {}) {
  let logs = [ ...logRing ];
  if (options.domain_id) {
    logs = logs.filter(l => l.domain_id === options.domain_id);
  }
  if (options.level) {
    logs = logs.filter(l => l.level === options.level);
  }
  logs.reverse();
  if (options.limit) {
    logs = logs.slice(0, options.limit);
  }
  return logs;
}

function getActiveDomainNames() {
  const names = [];
  for (const doc of domainsById.values()) {
    if (doc.status === "active" || doc.status === "provisioning") {
      names.push(doc.domain);
    }
  }
  return names;
}

function getAvailableBaseDomains() {
  const envDomains = [ String(process.env.BASE_DOMAIN || "example.com").toLowerCase(), ...String(process.env.EXTRA_BASE_DOMAINS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean) ];
  const result = [];
  const seen = new Set;
  for (const d of envDomains) {
    if (!seen.has(d)) {
      seen.add(d);
      result.push({
        domain: d,
        source: "env",
        is_primary: d === envDomains[0]
      });
    }
  }
  for (const doc of domainsById.values()) {
    if ((doc.status === "active" || doc.status === "provisioning") && !seen.has(doc.domain)) {
      seen.add(doc.domain);
      result.push({
        domain: doc.domain,
        source: "managed",
        is_primary: false
      });
    }
  }
  return result;
}

function getCurrentBaseDomain() {
  return String(process.env.BASE_DOMAIN || "example.com").toLowerCase();
}

async function initialize() {
  await loadPublicCfFromFirebase();
  if (!domainsRef) {
    ready = true;
    resolveReady();
    return;
  }
  try {
    const snapshot = await domainsRef.get();
    for (const doc of snapshot.docs) {
      const data = normalizeDomain({
        id: doc.id,
        ...doc.data()
      });
      domainsById.set(data.id, data);
      domainsByName.set(data.domain, data);
    }
    for (const doc of domainsById.values()) {
      if (doc.status === "provisioning" || doc.propagation_status === "checking") {
        if (doc.is_new_zone && doc.nameservers && doc.nameserver_status !== "active" && doc.nameserver_status !== "verified") {
          startNameserverMonitor(doc);
        } else if (doc.is_new_zone && doc.nameservers && (doc.nameserver_status === "active" || doc.nameserver_status === "verified")) {
          if (!doc.cf_record_id && doc.cf_zone_id) {
            try {
              const cfToken = getCfTokenForDoc(doc);
              const zone = await findZone(doc.domain, cfToken);
              if (zone) {
                await createDnsAndSsl(doc.id, doc.domain, zone, cfToken);
                await continueProvisioningAfterNs(doc.id);
              }
            } catch (err) {
              console.error(`[domains] Failed to resume setup for ${doc.domain}: ${err.message}`);
              addLog(doc.id, doc.domain, "error", `Resume failed: ${err.message}`, "init");
            }
          } else if (doc.propagation_status === "checking") {
            startPropagationMonitor(doc);
          }
        } else if (doc.propagation_status === "checking") {
          startPropagationMonitor(doc);
        }
      }
    }
  } catch (err) {
    console.error("[domains] Failed to load from Firestore:", err.message);
  }
  ready = true;
  resolveReady();
}

async function syncAllDnsToVps(newIp) {
  const ip = newIp || VPS_IP;
  if (!ip) throw new Error("No VPS IP available — set VPS_IP env var or pass an IP");
  setVpsIp(ip);
  try {
    const fs = require("fs");
    const path = require("path");
    const envPath = path.resolve(__dirname, "..", ".env");
    let envContent = "";
    try { envContent = fs.readFileSync(envPath, "utf8"); } catch {}
    const ipPattern = /^VPS_IP=.*$/m;
    if (ipPattern.test(envContent)) {
      envContent = envContent.replace(ipPattern, `VPS_IP=${ip}`);
    } else if (envContent && !envContent.endsWith("\n")) {
      envContent += `\nVPS_IP=${ip}\n`;
    } else {
      envContent += `VPS_IP=${ip}\n`;
    }
    fs.writeFileSync(envPath, envContent, "utf8");
  } catch (err) {
    console.warn("[domains] Failed to persist VPS_IP to .env:", err.message);
  }
  const allDomains = getDomains();
  const results = [];
  for (const doc of allDomains) {
    try {
      if (doc.status === "removed") continue;
      const cfToken = getCfTokenForDoc(doc);
      if (!cfToken) {
        results.push({ domain: doc.domain, ok: false, error: "No CF token" });
        continue;
      }
      const zone = await findZone(doc.domain, cfToken);
      if (!zone) {
        results.push({ domain: doc.domain, ok: false, error: "Zone not found" });
        continue;
      }
      const proxied = doc.cf_proxied !== false;
      let updated = 0;
      const aRecord = await findDnsRecord(zone.id, doc.domain, "A", cfToken);
      if (aRecord) {
        if (aRecord.content !== ip) {
          await cfRequest("PATCH", `/zones/${zone.id}/dns_records/${aRecord.id}`, {
            content: ip, proxied: proxied, ttl: 1
          }, cfToken);
          updated++;
        }
      } else {
        await createDnsRecord(zone.id, doc.domain, "A", ip, proxied, cfToken);
        updated++;
      }
      const wildcard = `*.${doc.domain}`;
      const wRecord = await findDnsRecord(zone.id, wildcard, "A", cfToken);
      if (wRecord) {
        if (wRecord.content !== ip) {
          await cfRequest("PATCH", `/zones/${zone.id}/dns_records/${wRecord.id}`, {
            content: ip, proxied: proxied, ttl: 1
          }, cfToken);
          updated++;
        }
      } else {
        await createDnsRecord(zone.id, wildcard, "A", ip, proxied, cfToken);
        updated++;
      }
      await updateDomain(doc.id, { vps_ip: ip });
      addLog(doc.id, doc.domain, "info", `DNS records synced to VPS IP ${ip} (${updated} records updated)`, "cloudflare_dns");
      results.push({ domain: doc.domain, ok: true, updated: updated });
    } catch (err) {
      results.push({ domain: doc.domain, ok: false, error: err.message });
    }
  }
  return { ip: ip, results: results, total: allDomains.length, success: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length };
}

async function backfillMailPostureAll() {
  const allDomains = getDomains();
  const results = [];
  for (const doc of allDomains) {
    try {
      if (doc.status === "removed") continue;
      const cfToken = getCfTokenForDoc(doc);
      if (!cfToken) {
        results.push({ domain: doc.domain, ok: false, error: "No CF token" });
        continue;
      }
      const zone = await findZone(doc.domain, cfToken);
      if (!zone) {
        results.push({ domain: doc.domain, ok: false, error: "Zone not found" });
        continue;
      }
      const created = await ensureMailPostureRecords(zone.id, doc.domain, cfToken);
      if (created.length > 0) {
        addLog(doc.id, doc.domain, "info", `Mail posture backfilled: ${created.join(", ")}`, "cloudflare_dns");
      }
      results.push({ domain: doc.domain, ok: true, created: created });
    } catch (err) {
      results.push({ domain: doc.domain, ok: false, error: err.message });
    }
  }
  return { results: results, total: allDomains.length, updated: results.filter(r => r.ok && r.created && r.created.length > 0).length, skipped: results.filter(r => r.ok && (!r.created || r.created.length === 0)).length, failed: results.filter(r => !r.ok).length };
}

module.exports = {
  events: events,
  initialize: initialize,
  ready: () => readyPromise,
  addDomain: addDomain,
  removeDomain: removeDomain,
  verifyDomain: verifyDomain,
  updateProxied: updateProxied,
  updateDomain: updateDomain,
  getDomains: getDomains,
  getDomain: getDomain,
  getDomainByName: getDomainByName,
  getActiveDomainNames: getActiveDomainNames,
  getAvailableBaseDomains: getAvailableBaseDomains,
  getCurrentBaseDomain: getCurrentBaseDomain,
  getLogs: getLogs,
  addLog: addLog,
  getPublicCfToken: getPublicCfToken,
  getPublicCfAccountId: getPublicCfAccountId,
  findZone: findZone,
  createDnsRecord: createDnsRecord,
  deleteDnsRecord: deleteDnsRecord,
  findDnsRecord: findDnsRecord,
  getVpsIp: () => VPS_IP,
  getVpsIpv6: () => VPS_IPV6,
  setVpsIp: setVpsIp,
  setVpsIpv6: setVpsIpv6,
  syncAllDnsToVps: syncAllDnsToVps,
  backfillMailPostureAll: backfillMailPostureAll,
  ensureMailPostureRecords: ensureMailPostureRecords
};
