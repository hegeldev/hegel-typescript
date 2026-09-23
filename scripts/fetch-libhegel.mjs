// Downloads prebuilt libhegel artifacts into `native/`. Run directly it
// fetches the host platform's shared library and the Wasm module for local
// test runs (`just fetch-libhegel`); `scripts/make-platform-packages.mjs`
// imports the helpers here to fetch every platform's library when assembling
// the per-platform npm packages, and `npm run build` uses `--wasm` to place
// the Wasm module in `dist/browser/`.
//
// The release to download is pinned by LIBHEGEL_VERSION in
// src/libhegel-version.ts (run `just update-libhegel` to bump it); its assets
// hang off hegel-rust's `libhegel-v<version>` tag (the plain `v<version>` tags
// mark hegeltest releases and carry no binaries). Every asset is verified
// against the `<asset>.sha256` sidecar the release publishes next to it.
// Artifacts land in a per-version directory (native/<version>/), so a pin bump
// simply misses the cache and downloads fresh — no invalidation logic needed.
//
// Usage:
//   node scripts/fetch-libhegel.mjs              # host library + Wasm; print the library's path
//   node scripts/fetch-libhegel.mjs --wasm       # the Wasm module; print its path
//   node scripts/fetch-libhegel.mjs --wasm <dir> # ...and copy it into <dir>; print the copy's path
//
// The printed path goes to stdout (so `just fetch-libhegel` can capture it);
// progress is logged to stderr.

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import * as fs from "node:fs";
import { get as httpsGet } from "node:https";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION_TS = path.join(ROOT, "src", "libhegel-version.ts");
const NATIVE_DIR = path.join(ROOT, "native");
const BASE_URL = "https://github.com/hegeldev/hegel-rust/releases/download";

/** The hegel-rust tag that carries the libhegel release of a version. */
export function releaseTag(version) {
  return `libhegel-v${version}`;
}

export const PLATFORMS = [
  { platform: "darwin", arch: "arm64", asset: "libhegel-darwin-arm64.dylib" },
  { platform: "linux", arch: "x64", asset: "libhegel-linux-amd64.so" },
  { platform: "linux", arch: "arm64", asset: "libhegel-linux-arm64.so" },
  { platform: "win32", arch: "x64", asset: "libhegel-windows-amd64.dll" },
  { platform: "win32", arch: "arm64", asset: "libhegel-windows-arm64.dll" },
];

/** The Wasm module the browser entry loads (see src/browser/artifact.ts). */
export const WASM_ASSET = "libhegel-wasm32-unknown-unknown.wasm";

/** Parse the pinned libhegel version out of src/libhegel-version.ts. */
export function pinnedVersion() {
  const text = fs.readFileSync(VERSION_TS, "utf8");
  const match = /export const LIBHEGEL_VERSION = "([^"]+)";/.exec(text);
  if (!match) {
    throw new Error("could not find LIBHEGEL_VERSION in src/libhegel-version.ts");
  }
  return match[1];
}

/** The published asset filename for the host platform/arch. */
export function hostAsset() {
  const entry = PLATFORMS.find((p) => p.platform === process.platform && p.arch === process.arch);
  if (entry === undefined) {
    throw new Error(`unsupported host ${process.platform}/${process.arch} for libhegel`);
  }
  return entry.asset;
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The hex digest in a release's `<asset>.sha256` sidecar: `sha256sum` output
 * (`<hex>  <asset>`, or `<hex> *<asset>` in binary mode) or a bare digest.
 */
export function sidecarDigest(text, asset) {
  const match = /^([a-f0-9]{64})(?:\s+\*?(\S+))?$/.exec(text.trim());
  if (!match || (match[2] !== undefined && match[2] !== asset)) {
    throw new Error(`libhegel: malformed checksum sidecar for ${asset}`);
  }
  return match[1];
}

/** Stream a URL to a file, following redirects. */
function download(url, dest, redirects = 5) {
  return new Promise((resolve, reject) => {
    httpsGet(url, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirects <= 0) {
          reject(new Error("too many redirects"));
          return;
        }
        download(new URL(res.headers.location, url).toString(), dest, redirects - 1).then(
          resolve,
          reject,
        );
        return;
      }
      if (status !== 200) {
        res.resume();
        reject(new Error(`HTTP ${status} for ${url}`));
        return;
      }
      const out = createWriteStream(dest);
      out.on("error", reject);
      out.on("finish", () => resolve());
      res.pipe(out);
    }).on("error", reject);
  });
}

/**
 * Fetch a single asset of the given release into native/<version>/, verifying
 * it against the checksum sidecar published next to it.
 */
export async function fetchAsset(asset, version, { offline = false } = {}) {
  const dest = path.join(NATIVE_DIR, version, asset);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) {
    process.stderr.write(`libhegel: ${asset} already present\n`);
    return dest;
  }
  if (offline) {
    throw new Error(`libhegel: ${asset} is not fetched; run \`just fetch-libhegel\` first`);
  }
  const url = `${BASE_URL}/${releaseTag(version)}/${asset}`;
  const tmp = `${dest}.${process.pid}.partial`;
  const sidecar = `${tmp}.sha256`;
  process.stderr.write(`libhegel: downloading ${asset}\n`);
  try {
    await download(url, tmp);
    await download(`${url}.sha256`, sidecar);
    const expected = sidecarDigest(fs.readFileSync(sidecar, "utf8"), asset);
    if (sha256(fs.readFileSync(tmp)) !== expected) {
      throw new Error(`libhegel: ${asset} does not match its published checksum`);
    }
    fs.chmodSync(tmp, 0o755);
    fs.renameSync(tmp, dest);
  } finally {
    fs.rmSync(tmp, { force: true });
    fs.rmSync(sidecar, { force: true });
  }
  return dest;
}

/** Fetch the pinned release's Wasm module. */
export function fetchWasm(version = pinnedVersion()) {
  return fetchAsset(WASM_ASSET, version);
}

async function main(args) {
  const version = pinnedVersion();
  if (args[0] === "--wasm" && args.length <= 2) {
    let dest = await fetchWasm(version);
    if (args[1] !== undefined) {
      fs.mkdirSync(args[1], { recursive: true });
      const copy = path.join(args[1], WASM_ASSET);
      fs.copyFileSync(dest, copy);
      dest = copy;
    }
    process.stdout.write(`${dest}\n`);
    return;
  }
  if (args.length > 0) {
    throw new Error("usage: fetch-libhegel.mjs [--wasm [<dir>]]");
  }
  const host = await fetchAsset(hostAsset(), version);
  await fetchWasm(version);
  process.stdout.write(`${host}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`${err.message ?? err}\n`);
    process.exit(1);
  });
}
