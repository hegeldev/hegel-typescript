// Downloads prebuilt libhegel shared libraries into `native/`. Run directly it
// fetches the host platform's artifact for local test runs (`just
// fetch-libhegel`); `scripts/make-platform-packages.mjs` imports the helpers
// here to fetch every platform's artifact when assembling the per-platform npm
// packages.
//
// The release to download is pinned by LIBHEGEL_VERSION in
// src/libhegel-version.ts (run `just update-libhegel` to bump it). Artifacts
// land in a per-version directory (native/<version>/), so a pin bump simply
// misses the cache and downloads fresh — no invalidation logic needed.
//
// Usage:
//   node scripts/fetch-libhegel.mjs   # fetch the host artifact, print its path
//
// The absolute path of the host artifact goes to stdout (so `just
// fetch-libhegel` can capture it); progress is logged to stderr.

import { createWriteStream } from "node:fs";
import * as fs from "node:fs";
import { get as httpsGet } from "node:https";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION_TS = path.join(ROOT, "src", "libhegel-version.ts");
const NATIVE_DIR = path.join(ROOT, "native");
const BASE_URL = "https://github.com/hegeldev/hegel-rust/releases/download";

export const PLATFORMS = [
  { platform: "darwin", arch: "arm64", asset: "libhegel-darwin-arm64.dylib" },
  { platform: "linux", arch: "x64", asset: "libhegel-linux-amd64.so" },
  { platform: "linux", arch: "arm64", asset: "libhegel-linux-arm64.so" },
  { platform: "win32", arch: "x64", asset: "libhegel-windows-amd64.dll" },
  { platform: "win32", arch: "arm64", asset: "libhegel-windows-arm64.dll" },
];

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

/** Fetch a single asset of the given release into native/<version>/. */
export async function fetchAsset(asset, version) {
  const dest = path.join(NATIVE_DIR, version, asset);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) {
    process.stderr.write(`libhegel: ${asset} already present\n`);
    return dest;
  }
  const url = `${BASE_URL}/v${version}/${asset}`;
  const tmp = `${dest}.${process.pid}.partial`;
  process.stderr.write(`libhegel: downloading ${asset}\n`);
  await download(url, tmp);
  fs.chmodSync(tmp, 0o755);
  fs.renameSync(tmp, dest);
  return dest;
}

async function main() {
  const dest = await fetchAsset(hostAsset(), pinnedVersion());
  process.stdout.write(`${dest}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`${err.message ?? err}\n`);
    process.exit(1);
  });
}
