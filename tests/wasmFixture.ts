import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { WASM_ARTIFACT } from "../src/browser/artifact.js";
import { WasmAbi } from "../src/browser/abi.js";
import { WasmEngine } from "../src/browser/engine.js";
import { createHostImports } from "../src/browser/host.js";

const path =
  process.env.HEGEL_WASM_PATH ??
  new URL(`../native/wasm/${WASM_ARTIFACT.sha256}/${WASM_ARTIFACT.asset}`, import.meta.url);
if (!existsSync(path)) {
  throw new Error(
    "Prepare the pinned published Wasm with npm run prepare:wasm -- release before testing",
  );
}
const bytes = readFileSync(path);
if (createHash("sha256").update(bytes).digest("hex") !== WASM_ARTIFACT.sha256) {
  throw new Error("HEGEL_WASM_PATH does not match the pinned artifact checksum");
}
export const wasmBytes = Uint8Array.from(bytes).buffer;
export const wasmModule = new WebAssembly.Module(wasmBytes);

export function wasmFixture() {
  const host = createHostImports();
  const instance = new WebAssembly.Instance(wasmModule, host.imports);
  const abi = new WasmAbi(instance.exports);
  host.setMemory(abi.memory);
  return { abi, engine: new WasmEngine(abi), exports: instance.exports };
}
