"use strict";

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    if (details) this.details = details;
  }
}

const badRequest = (message, details) => new HttpError(400, message, details);

const forbidden = (message, details) => new HttpError(403, message, details);

const notFound = message => new HttpError(404, message || "Not found");

function wantsJson(req) {
  if (req.originalUrl.startsWith("/api") || req.originalUrl.startsWith("/__unidral/api")) return true;
  const accept = String(req.headers.accept || "");
  return accept.includes("application/json") && !accept.includes("text/html");
}

function htmlErrorPage(status, message) {
  return `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1" />\n    <title>Unidral Engine - ${status}</title>\n    <style>\n      body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;\n             background: #1e1e1e; color: #ccc; font-family: ui-sans-serif, system-ui, "Segoe UI", sans-serif; }\n      .card { background: #252526; border: 1px solid #333; border-radius: 10px; padding: 32px 40px; max-width: 560px; }\n      h1 { margin: 0 0 8px; font-size: 20px; color: #fff; }\n      code { color: #007acc; }\n      p { margin: 8px 0 0; line-height: 1.5; font-size: 14px; }\n    </style>\n  </head>\n  <body>\n    <div class="card">\n      <h1>Unidral Engine - ${status}</h1>\n      <p>${String(message).replace(/</g, "&lt;")}</p>\n    </div>\n  </body>\n</html>`;
}

function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  const message = err.message || "Internal server error";
  if (status >= 500) {
    console.error("[unidral] error:", err);
  }
  if (res.headersSent) return;
  if (wantsJson(req)) {
    res.status(status).json({
      error: message,
      status: status,
      ...err.details ? {
        details: err.details
      } : {}
    });
    return;
  }
  res.status(status).type("html").send(htmlErrorPage(status, message));
}

module.exports = {
  HttpError: HttpError,
  badRequest: badRequest,
  forbidden: forbidden,
  notFound: notFound,
  errorHandler: errorHandler
};
