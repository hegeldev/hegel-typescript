import { LIBHEGEL_VERSION } from "../libhegel-version.js";

/** Exact raw Wasm build identity; development pins cannot authorize publication. */
export const WASM_ARTIFACT = {
  version: LIBHEGEL_VERSION,
  asset: "libhegel-wasm32-unknown-unknown.wasm",
  sha256: "1af8eb2a353b864fde9097fde8e22bf598e330aaf868573fe0c9a754076c9755",
} as const;
