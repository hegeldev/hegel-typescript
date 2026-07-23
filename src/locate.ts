/**
 * Locates the native `libhegel` shared library for the host platform.
 *
 * Each supported platform's shared library is published as its own npm package
 * (e.g. `@hegeldev/hegel-darwin-arm64`), listed in this package's
 * `optionalDependencies`. Package managers skip the entries whose `os`/`cpu`
 * don't match the host, so exactly one is installed. Resolution is:
 *
 * 1. `$HEGEL_LIBHEGEL_PATH`, if set — used directly (a local build / override).
 *    This is also how the repo's own test runs point at the pinned engine
 *    downloaded by `just fetch-libhegel`.
 * 2. The installed platform package's `./binary` export.
 *
 * Resolution is synchronous: the library must be available before the
 * (synchronous) `hegel.test` run loop starts.
 *
 * @packageDocumentation
 */

import { createRequire } from "node:module";

/** Env var pinning libhegel to an explicit path (overrides resolution). */
export const LIBRARY_PATH_ENV = "HEGEL_LIBHEGEL_PATH";

/**
 * Returns the platform package name for the given platform and architecture,
 * e.g. `@hegeldev/hegel-linux-x64`. Throws for an unsupported OS
 * or CPU architecture.
 */
export function libhegelPackageName(platform: NodeJS.Platform, arch: string): string {
  if (platform !== "linux" && platform !== "darwin" && platform !== "win32") {
    throw new Error(`Unsupported platform '${platform}' for libhegel`);
  }
  if (arch !== "x64" && arch !== "arm64") {
    throw new Error(`Unsupported architecture '${arch}' for libhegel`);
  }
  return `@hegeldev/hegel-${platform}-${arch}`;
}

/**
 * Resolves `specifier` (e.g. `@hegeldev/hegel-linux-arm64/binary`) to a file
 * path via the module system, or returns null if it cannot be resolved —
 * typically because the platform package is not installed.
 */
export function resolvePackagedBinary(specifier: string): string | null {
  const require = createRequire(import.meta.url);
  try {
    return require.resolve(specifier);
  } catch {
    return null;
  }
}

/**
 * Resolves a filesystem path to the native libhegel library. The environment,
 * platform, architecture, and package resolver are passed in so the resolution
 * logic is fully unit-testable.
 */
export function resolveLibrary(opts: {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  arch: string;
  resolvePackaged?: (specifier: string) => string | null;
}): string {
  const override = opts.env[LIBRARY_PATH_ENV];
  if (override !== undefined && override !== "") {
    return override;
  }

  const pkg = libhegelPackageName(opts.platform, opts.arch);
  const resolvePackaged = opts.resolvePackaged ?? resolvePackagedBinary;
  const packaged = resolvePackaged(`${pkg}/binary`);
  if (packaged !== null) {
    return packaged;
  }

  throw new Error(
    `libhegel not found: the platform package ${pkg} is not installed. ` +
      `You may want to set ${LIBRARY_PATH_ENV} to a local libhegel.`,
  );
}

/**
 * Resolves the libhegel path for the current process environment.
 */
export function locateLibhegel(): string {
  return resolveLibrary({
    env: process.env,
    platform: process.platform,
    arch: process.arch,
  });
}
