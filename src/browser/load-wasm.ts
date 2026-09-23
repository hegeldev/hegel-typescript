import { EngineError } from "../engine.js";
import { WASM_ARTIFACT } from "./artifact.js";
import { WasmAbi } from "./abi.js";
import { WasmEngine } from "./engine.js";
import { createHostImports } from "./host.js";

/** Internal trusted inputs. Integrity is checked during artifact preparation, not loading. */
export type WasmSource = URL | ArrayBuffer | WebAssembly.Module | Response;

function validateImports(module: WebAssembly.Module): void {
  const imports = WebAssembly.Module.imports(module);
  const names = new Set(imports.map((entry) => `${entry.module}.${entry.name}:${entry.kind}`));
  if (
    imports.length !== 2 ||
    names.size !== 2 ||
    !names.has("hegel_host.entropy_fill:function") ||
    !names.has("hegel_host.monotonic_nanos:function")
  ) {
    throw new EngineError("Incompatible Wasm host imports");
  }
}

export async function loadWasm(source: WasmSource): Promise<WasmEngine> {
  try {
    const host = createHostImports();
    let instance: WebAssembly.Instance;
    let module: WebAssembly.Module;
    if (source instanceof WebAssembly.Module) {
      module = source;
      validateImports(module);
      instance = await WebAssembly.instantiate(module, host.imports);
    } else if (source instanceof ArrayBuffer) {
      module = await WebAssembly.compile(source);
      validateImports(module);
      instance = await WebAssembly.instantiate(module, host.imports);
    } else {
      const response = source instanceof URL ? await fetch(source) : source;
      if (!response.ok) throw new EngineError(`Wasm request failed: HTTP ${response.status}`);
      const fallback = response.clone();
      let result: WebAssembly.WebAssemblyInstantiatedSource;
      if (typeof WebAssembly.instantiateStreaming === "function") {
        try {
          result = await WebAssembly.instantiateStreaming(response, host.imports);
        } catch (error) {
          const mime = response.headers.get("Content-Type");
          // A trap, compile failure or wrong import is never a MIME fallback.
          if (!(error instanceof TypeError) || mime === "application/wasm") throw error;
          result = await WebAssembly.instantiate(await fallback.arrayBuffer(), host.imports);
        }
      } else {
        result = await WebAssembly.instantiate(await fallback.arrayBuffer(), host.imports);
      }
      ({ module, instance } = result);
      validateImports(module);
    }
    const abi = new WasmAbi(instance.exports);
    host.setMemory(abi.memory);
    const engine = new WasmEngine(abi);
    const version = engine.version();
    if (version !== WASM_ARTIFACT.version) {
      throw new EngineError(
        `Wasm engine version mismatch: expected ${WASM_ARTIFACT.version}, got ${version}`,
      );
    }
    return engine;
  } catch (cause) {
    if (cause instanceof EngineError) throw cause;
    throw new EngineError("Failed to load Hegel Wasm engine", { cause });
  }
}
