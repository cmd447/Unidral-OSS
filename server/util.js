"use strict";

const asyncHandler = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

const TRUE_WORDS = new Set([ "1", "true", "yes", "on" ]);

const FALSE_WORDS = new Set([ "0", "false", "no", "off" ]);

function toFlag(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Boolean(value);
  const normalized = String(value).trim().toLowerCase();
  if (TRUE_WORDS.has(normalized)) return true;
  if (FALSE_WORDS.has(normalized)) return false;
  return fallback;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  asyncHandler: asyncHandler,
  toFlag: toFlag,
  escapeRegExp: escapeRegExp
};
