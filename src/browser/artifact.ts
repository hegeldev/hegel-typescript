import { LIBHEGEL_VERSION } from "../libhegel-version.js";

/** Exact raw Wasm build identity; development pins cannot authorize publication. */
export const WASM_ARTIFACT = {
  version: LIBHEGEL_VERSION,
  asset: "libhegel-wasm32-unknown-unknown.wasm",
  sha256: "874ef207c481d70ab46908a89878f53068d364b9157e67a3ae9e4dd5d76c74bf",
} as const;
