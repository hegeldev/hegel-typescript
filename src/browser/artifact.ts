import { LIBHEGEL_VERSION } from "../libhegel-version.js";

/**
 * The Wasm module the browser entry loads: the `wasm32-unknown-unknown` build
 * hegel-rust publishes with the pinned libhegel release, packaged into
 * `dist/browser/` by `npm run build` (see scripts/fetch-libhegel.mjs). The
 * loader checks the module's version string against the pin.
 */
export const WASM_ARTIFACT = {
  version: LIBHEGEL_VERSION,
  asset: "libhegel-wasm32-unknown-unknown.wasm",
} as const;
