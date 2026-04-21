/**
 * Locates or installs a `uv` binary for spawning the hegel-core server.
 *
 * Lookup order:
 * 1. `uv` found on `PATH`
 * 2. Cached binary at `~/.cache/hegel/uv` (or `$XDG_CACHE_HOME/hegel/uv`)
 * 3. Installs uv to that cache directory using the embedded installer script.
 *
 * @packageDocumentation
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/* v8 ignore next */
const UV_BINARY_NAME = process.platform === "win32" ? "uv.exe" : "uv";

function installScriptPath(): string {
  return fileURLToPath(new URL("./uv-install.sh", import.meta.url));
}

export function cacheDirFrom(xdgCacheHome: string | null, homeDir: string | null): string {
  if (xdgCacheHome !== null) {
    return path.join(xdgCacheHome, "hegel");
  }
  if (homeDir === null) {
    throw new Error("Could not determine home directory");
  }
  return path.join(homeDir, ".cache", "hegel");
}

export function findInPath(name: string): string | null {
  const pathVar = process.env.PATH;
  if (pathVar === undefined) return null;
  for (const dir of pathVar.split(path.delimiter)) {
    if (dir === "") continue;
    const candidate = path.join(dir, name);
    try {
      if (fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // not found or not accessible
    }
  }
  return null;
}

export function installUvWithSh(cache: string, sh: string): void {
  fs.mkdirSync(cache, { recursive: true });
  const script = fs.readFileSync(installScriptPath(), "utf-8");
  const result = spawnSync(sh, [], {
    input: script,
    env: { ...process.env, UV_UNMANAGED_INSTALL: cache },
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (result.error !== undefined) {
    throw new Error(
      `Failed to run uv installer: ${result.error.message}. ` +
        `Install uv manually: https://docs.astral.sh/uv/getting-started/installation/`,
    );
  }
  /* v8 ignore start */
  if (result.status !== 0) {
    throw new Error(
      "uv installer failed. " +
        "Install uv manually: https://docs.astral.sh/uv/getting-started/installation/",
    );
  }
  /* v8 ignore stop */
}

function installUvTo(cache: string): void {
  /* v8 ignore start */
  if (process.platform === "win32") {
    throw new Error(
      "uv is required but was not found on PATH. " +
        "Install uv: https://docs.astral.sh/uv/getting-started/installation/",
    );
  }
  /* v8 ignore stop */
  installUvWithSh(cache, "sh");
}

export function findUvImpl(uvInPath: string | null, cache: string): string {
  if (uvInPath !== null) {
    return uvInPath;
  }
  const cached = path.join(cache, UV_BINARY_NAME);
  try {
    if (fs.statSync(cached).isFile()) {
      return cached;
    }
  } catch {
    // not cached yet
  }
  installUvTo(cache);
  return cached;
}

/**
 * Returns the path to a `uv` binary, installing it to the user cache
 * directory if it is not already available.
 */
export function findUv(): string {
  const uvInPath = findInPath(UV_BINARY_NAME);
  const home = os.homedir();
  const cache = cacheDirFrom(process.env.XDG_CACHE_HOME ?? null, home === "" ? null : home);
  return findUvImpl(uvInPath, cache);
}
