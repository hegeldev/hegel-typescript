/**
 * Global lazy libhegel handle.
 *
 * The native library is located (and, on first use, downloaded) and loaded the
 * first time a test runs, then reused for the lifetime of the process. Unlike
 * the previous subprocess-based client there is no server to manage: the engine
 * runs on a worker thread inside libhegel, owned by each run handle.
 *
 * @packageDocumentation
 */

import { Libhegel } from "./libhegel.js";
import { locateLibhegel } from "./locate.js";
import { LIBHEGEL_VERSION } from "./libhegel-version.js";

let cached: Libhegel | null = null;

/** Returns the `major.minor` portion of a `major.minor.patch` version. */
function majorMinor(version: string): string {
  return version.split(".").slice(0, 2).join(".");
}

/**
 * Verify the loaded library's version is ABI-compatible with the one this
 * client was built against. libhegel is pre-1.0, so its C ABI can change
 * between minor versions; we require the `major.minor` to match.
 */
export function checkVersion(actual: string, expected: string = LIBHEGEL_VERSION): void {
  if (majorMinor(actual) !== majorMinor(expected)) {
    throw new Error(
      `Incompatible libhegel version: the loaded library is ${actual}, but ` +
        `@hegeldev/hegel expects ${expected}. Update the package or the library so their ` +
        `major.minor versions match.`,
    );
  }
}

/** Locate, load and version-check the native library. */
export function loadLibhegel(): Libhegel {
  const lib = Libhegel.load(locateLibhegel());
  checkVersion(lib.version());
  return lib;
}

/** Returns the process-global libhegel handle, loading it on first use. */
export function getLibhegel(): Libhegel {
  if (cached === null) {
    cached = loadLibhegel();
  }
  return cached;
}
