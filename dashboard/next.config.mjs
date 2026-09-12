import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const origReadlinkSync = fs.readlinkSync;
fs.readlinkSync = function (path, options) {
  try {
    return origReadlinkSync.call(fs, path, options);
  } catch (err) {
    if (err && err.code === 'EISDIR') {
      const einvalErr = new Error(`EINVAL: invalid argument, readlink '${path}'`);
      einvalErr.code = 'EINVAL';
      einvalErr.errno = -4071;
      einvalErr.syscall = 'readlink';
      einvalErr.path = path;
      throw einvalErr;
    }
    throw err;
  }
};

const origReadlink = fs.readlink;
fs.readlink = function (path, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = undefined;
  }
  origReadlink.call(fs, path, options, (err, linkString) => {
    if (err && err.code === 'EISDIR') {
      const einvalErr = new Error(`EINVAL: invalid argument, readlink '${path}'`);
      einvalErr.code = 'EINVAL';
      einvalErr.errno = -4071;
      einvalErr.syscall = 'readlink';
      einvalErr.path = path;
      return callback(einvalErr);
    }
    return callback(err, linkString);
  });
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: __dirname,
  webpack: (config) => {
    config.cache = false;
    config.resolve.symlinks = false;
    return config;
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://unidral-server:4000/__unidral/api/:path*",
      },
    ];
  },
};

export default nextConfig;
