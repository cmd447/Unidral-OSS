"use strict";

const path = require("path");

const moduleLoader = require("./module-loader");

const MAX_ZIP_SIZE = 50 * 1024 * 1024;

const SUPPORTED_API_VERSIONS = moduleLoader.SUPPORTED_API_VERSIONS;

const REQUIRED_FIELDS = [ "id", "name", "target_url", "version", "api_version" ];

const VALID_ID_REGEX = /^[a-z0-9][a-z0-9-]*$/i;

function validateZip(zipBuffer, expectedFilename) {
  if (!zipBuffer || !Buffer.isBuffer(zipBuffer)) {
    return {
      ok: false,
      error: "Invalid ZIP data (not a buffer)"
    };
  }
  if (zipBuffer.length > MAX_ZIP_SIZE) {
    return {
      ok: false,
      error: `ZIP too large (${(zipBuffer.length / 1024 / 1024).toFixed(1)}MB, max ${MAX_ZIP_SIZE / 1024 / 1024}MB)`
    };
  }
  if (zipBuffer.length < 4 || zipBuffer[0] !== 80 || zipBuffer[1] !== 75 || zipBuffer[2] !== 3 || zipBuffer[3] !== 4) {
    return {
      ok: false,
      error: "Not a valid ZIP file (missing PK header)"
    };
  }
  const entries = listZipEntries(zipBuffer);
  if (!entries) {
    return {
      ok: false,
      error: "Could not read ZIP central directory"
    };
  }
  if (entries.length === 0) {
    return {
      ok: false,
      error: "ZIP is empty"
    };
  }
  for (const entry of entries) {
    if (entry.name.startsWith("/") || entry.name.startsWith("\\")) {
      return {
        ok: false,
        error: `Invalid path in ZIP: ${entry.name} (absolute paths not allowed)`
      };
    }
    if (entry.name.includes("../") || entry.name.includes("..\\")) {
      return {
        ok: false,
        error: `Invalid path in ZIP: ${entry.name} (path traversal not allowed)`
      };
    }
    if (entry.unixMode && (entry.unixMode & 61440) === 40960) {
      return {
        ok: false,
        error: `Symlink found in ZIP: ${entry.name} (symlinks not allowed)`
      };
    }
  }
  const moduleJsonEntry = findModuleJson(entries);
  if (!moduleJsonEntry) {
    return {
      ok: false,
      error: "No module.json found in ZIP"
    };
  }
  const manifestBuffer = extractEntry(zipBuffer, moduleJsonEntry);
  if (!manifestBuffer) {
    return {
      ok: false,
      error: "Could not extract module.json from ZIP"
    };
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestBuffer.toString("utf8"));
  } catch (err) {
    return {
      ok: false,
      error: `module.json is not valid JSON: ${err.message}`
    };
  }
  if (manifest.__unidral_module__ !== true) {
    return {
      ok: false,
      error: "Missing or false __unidral_module__ marker — not an Unidral module"
    };
  }
  for (const field of REQUIRED_FIELDS) {
    if (manifest[field] === undefined || manifest[field] === null || manifest[field] === "") {
      return {
        ok: false,
        error: `Missing required field in module.json: ${field}`
      };
    }
  }
  if (!VALID_ID_REGEX.test(manifest.id)) {
    return {
      ok: false,
      error: `Invalid module id: "${manifest.id}" (only alphanumeric and hyphens allowed)`
    };
  }
  if (expectedFilename) {
    const basename = path.basename(expectedFilename, ".zip").toLowerCase();
    if (manifest.id.toLowerCase() !== basename) {
      return {
        ok: false,
        error: `Module id "${manifest.id}" does not match filename "${basename}"`
      };
    }
  }
  if (!SUPPORTED_API_VERSIONS.includes(manifest.api_version)) {
    return {
      ok: false,
      error: `Unsupported api_version ${manifest.api_version} (engine supports: ${SUPPORTED_API_VERSIONS.join(", ")})`
    };
  }
  try {
    new URL(manifest.target_url);
  } catch {
    return {
      ok: false,
      error: `Invalid target_url: "${manifest.target_url}"`
    };
  }
  return {
    ok: true,
    manifest: manifest,
    entries: entries
  };
}

function findModuleJson(entries) {
  let entry = entries.find(e => e.name === "module.json");
  if (entry) return entry;
  const moduleJsons = entries.filter(e => e.name.endsWith("module.json") && e.name.split("/").length === 2);
  if (moduleJsons.length === 1) return moduleJsons[0];
  return null;
}

function listZipEntries(buffer) {
  try {
    const eocdOffset = findEocd(buffer);
    if (eocdOffset < 0) return null;
    const centralDirEntries = buffer.readUInt16LE(eocdOffset + 10);
    const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);
    const entries = [];
    let offset = centralDirOffset;
    for (let i = 0; i < centralDirEntries; i++) {
      if (buffer.readUInt32LE(offset) !== 33639248) break;
      const compressionMethod = buffer.readUInt16LE(offset + 10);
      const fileNameLength = buffer.readUInt16LE(offset + 28);
      const extraFieldLength = buffer.readUInt16LE(offset + 30);
      const fileCommentLength = buffer.readUInt16LE(offset + 32);
      const localHeaderOffset = buffer.readUInt32LE(offset + 42);
      const externalAttrs = buffer.readUInt32LE(offset + 38);
      const fileName = buffer.toString("utf8", offset + 46, offset + 46 + fileNameLength);
      const unixMode = externalAttrs >> 16 & 65535;
      entries.push({
        name: fileName,
        compressionMethod: compressionMethod,
        localHeaderOffset: localHeaderOffset,
        unixMode: unixMode,
        isDirectory: fileName.endsWith("/")
      });
      offset += 46 + fileNameLength + extraFieldLength + fileCommentLength;
    }
    return entries;
  } catch (err) {
    console.error("[module-validator] Failed to parse ZIP:", err.message);
    return null;
  }
}

function findEocd(buffer) {
  const minEocdSize = 22;
  const maxSearch = Math.min(buffer.length - minEocdSize, 65557);
  for (let i = buffer.length - minEocdSize; i >= buffer.length - maxSearch - minEocdSize; i--) {
    if (buffer.readUInt32LE(i) === 101010256) {
      return i;
    }
  }
  return -1;
}

function extractEntry(buffer, entry) {
  try {
    const localOffset = entry.localHeaderOffset;
    if (buffer.readUInt32LE(localOffset) !== 67324752) return null;
    const compressionMethod = buffer.readUInt16LE(localOffset + 8);
    const compressedSize = buffer.readUInt32LE(localOffset + 18);
    const fileNameLength = buffer.readUInt16LE(localOffset + 26);
    const extraFieldLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + fileNameLength + extraFieldLength;
    const compressedData = buffer.slice(dataOffset, dataOffset + compressedSize);
    if (compressionMethod === 0) {
      return compressedData;
    } else if (compressionMethod === 8) {
      const zlib = require("zlib");
      return zlib.inflateRawSync(compressedData);
    } else {
      console.error(`[module-validator] Unsupported compression method: ${compressionMethod}`);
      return null;
    }
  } catch (err) {
    console.error("[module-validator] Failed to extract entry:", err.message);
    return null;
  }
}

module.exports = {
  validateZip: validateZip,
  MAX_ZIP_SIZE: MAX_ZIP_SIZE,
  REQUIRED_FIELDS: REQUIRED_FIELDS,
  findModuleJson: findModuleJson,
  listZipEntries: listZipEntries,
  extractEntry: extractEntry
};
