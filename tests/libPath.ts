/**
 * Resolve the libhegel path for tests. Honors `HEGEL_LIBHEGEL_PATH`; otherwise
 * falls back to the per-platform artifact bundled in the repo's `native/`
 * directory (populated by `just fetch-libhegel` / `scripts/fetch-libhegel.mjs`
 * before the test run).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { hostAsset } from "../scripts/fetch-libhegel.mjs";
import { LIBHEGEL_VERSION } from "../src/libhegel-version.js";

export function testLibPath(): string {
  const override = process.env.HEGEL_LIBHEGEL_PATH;
  if (override) {
    return override;
  }
  const candidate = path.join(process.cwd(), "native", LIBHEGEL_VERSION, hostAsset());
  if (!fs.existsSync(candidate)) {
    throw new Error(
      `libhegel not found at ${candidate}. Set HEGEL_LIBHEGEL_PATH or run ` +
        `\`just fetch-libhegel\` to download the pinned libhegel into native/.`,
    );
  }
  return candidate;
}
