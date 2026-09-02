"use strict";

const https = require("https");
const { SocksProxyAgent } = require("socks-proxy-agent");
const { HttpsProxyAgent } = require("https-proxy-agent");

function applyEgress(options) {
  const defaultProxy = process.env.UPSTREAM_PROXY;
  if (defaultProxy && !options.agent) {
    try {
      if (defaultProxy.startsWith("socks")) options.agent = new SocksProxyAgent(defaultProxy);
      else if (defaultProxy.startsWith("http")) options.agent = new HttpsProxyAgent(defaultProxy);
    } catch {}
  }
  return options;
}

function egressRequest(options, site, callback) {
  applyEgress(options);
  return https.request(options, callback);
}

function egressFetch(options, body, site, timeoutMs = 2e4) {
  return new Promise((resolve, reject) => {
    applyEgress(options);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    let settled = false;
    const req = https.request({
      ...options,
      signal: ac.signal
    }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("error", err => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
      res.on("end", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks)
        });
      });
    });
    req.on("error", err => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    if (body) req.write(body);
    req.end();
  });
}

module.exports = {
  applyEgress: applyEgress,
  egressRequest: egressRequest,
  egressFetch: egressFetch
};
