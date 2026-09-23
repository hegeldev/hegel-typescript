import { existsSync, readFileSync } from "node:fs";
import { LIBHEGEL_VERSION } from "../src/libhegel-version.js";
import { WASM_ARTIFACT } from "../src/browser/artifact.js";
import { WasmAbi } from "../src/browser/abi.js";
import { WasmEngine } from "../src/browser/engine.js";
import { createHostImports } from "../src/browser/host.js";

// The pinned release's Wasm module, fetched next to the native library by
// `just fetch-libhegel` (or wherever HEGEL_WASM_PATH points, mirroring
// HEGEL_LIBHEGEL_PATH for the native side).
const path =
  process.env.HEGEL_WASM_PATH ??
  new URL(`../native/${LIBHEGEL_VERSION}/${WASM_ARTIFACT.asset}`, import.meta.url);
if (!existsSync(path)) {
  throw new Error(
    "Run `just fetch-libhegel` to download the pinned Wasm module (or set HEGEL_WASM_PATH)",
  );
}
export const wasmBytes = Uint8Array.from(readFileSync(path)).buffer;
export const wasmModule = new WebAssembly.Module(wasmBytes);

export function wasmFixture() {
  const host = createHostImports();
  const instance = new WebAssembly.Instance(wasmModule, host.imports);
  const abi = new WasmAbi(instance.exports);
  host.setMemory(abi.memory);
  return { abi, engine: new WasmEngine(abi), exports: instance.exports };
}
