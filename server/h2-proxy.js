"use strict";

function shouldUseH2(req, targetUrl) {
  return false;
}

async function proxyH2(req, res, targetUrl, modifyResponseCallback) {
  if (!res.headersSent) {
    res.writeHead(501);
    res.end("Not Implemented");
  }
  return true;
}

module.exports = {
  shouldUseH2: shouldUseH2,
  proxyH2: proxyH2
};
