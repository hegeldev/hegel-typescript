import { WasmMemory } from "./arena.js";

export function createHostImports() {
  let memory: WasmMemory | undefined;
  return {
    setMemory(value: WebAssembly.Memory): void {
      memory = new WasmMemory(value);
    },
    imports: {
      hegel_host: {
        entropy_fill(ptr: number, length: number): number {
          try {
            if (!memory) return 0;
            crypto.getRandomValues(memory.bytes(ptr >>> 0, length >>> 0));
            return 1;
          } catch {
            return 0;
          }
        },
        monotonic_nanos(): bigint {
          try {
            const nanos = performance.now() * 1_000_000;
            if (!Number.isFinite(nanos) || nanos < 0) return -1n;
            const value = BigInt(Math.trunc(nanos));
            return value <= 0x7fffffffffffffffn ? value : -1n;
          } catch {
            return -1n;
          }
        },
      },
    },
  };
}
