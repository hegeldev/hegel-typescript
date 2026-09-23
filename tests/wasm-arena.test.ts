import { afterEach, describe, expect, it, vi } from "vitest";
import { WasmArena, WasmMemory } from "../src/browser/arena.js";
import { u32, u64 } from "../src/browser/abi.js";
import { createHostImports } from "../src/browser/host.js";
import { EngineError } from "../src/engine.js";
import { wasmFixture } from "./wasmFixture.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("WasmArena and WasmMemory", () => {
  it("marshals C strings and present empty/NUL-containing buffers separately", () => {
    const { abi } = wasmFixture();
    WasmArena.scoped(abi, (a) => {
      for (const value of [null, "", "hello", "héllo 🙂"])
        expect(a.cString(a.utf8CString(value))).toBe(value);
      expect(() => a.utf8CString("a\0b")).toThrow("NUL");
      expect(a.input(null)).toBe(0);
      expect(a.input(new Uint8Array())).not.toBe(0);
      const ptr = a.input(new Uint8Array([0, 1, 0]));
      expect(a.bytes(ptr, 3)).toEqual(new Uint8Array([0, 1, 0]));
      expect(a.stringList(null)).toBe(0);
      expect(a.stringList([])).not.toBe(0);
      const list = a.stringList(["", "Ll", "🙂"]);
      expect([0, 4, 8].map((offset) => a.cString(a.pointer(list + offset)))).toEqual([
        "",
        "Ll",
        "🙂",
      ]);
    });
  });
  it("checks memory bounds, boolean layout and C string termination/UTF-8", () => {
    const memory = new WebAssembly.Memory({ initial: 1 }),
      a = new WasmMemory(memory);
    for (const [ptr, length] of [
      [0, 1],
      [-1, 1],
      [1.5, 1],
      [1, -1],
      [65535, 2],
      [65537, 0],
    ]) {
      expect(() => a.bytes(ptr, length)).toThrow(EngineError);
    }
    expect(a.bytes(0, 0)).toHaveLength(0);
    expect(a.bytes(65536, 0)).toHaveLength(0);
    a.bytes(4, 1)[0] = 2;
    expect(() => a.boolean(4)).toThrow("boolean");
    a.bytes(4, 1)[0] = 0;
    expect(a.boolean(4)).toBe(false);
    a.bytes(4, 1)[0] = 1;
    expect(a.boolean(4)).toBe(true);
    a.bytes(4, 2).set([255, 0]);
    expect(() => a.cString(4)).toThrow("UTF-8");
    a.bytes(65535, 1)[0] = 1;
    expect(() => a.cString(65535)).toThrow("Unterminated");
    expect(() => a.cString(65536)).toThrow("range");
  });
  it("rejects invalid allocations and cleans every registered layout after a failure", () => {
    const { abi } = wasmFixture();
    for (const [size, align] of [
      [0, 1],
      [-1, 1],
      [4, 0],
      [4, 3],
      [4, 1.5],
    ]) {
      expect(() => WasmArena.scoped(abi, (a) => a.alloc(size, align))).toThrow(EngineError);
    }
    vi.spyOn(abi, "alloc").mockReturnValue(0);
    expect(() => WasmArena.scoped(abi, (a) => a.alloc(4, 4))).toThrow("allocation failed");
    vi.spyOn(abi, "dealloc").mockImplementation(() => {});
    vi.spyOn(abi, "alloc").mockReturnValue(5);
    expect(() => WasmArena.scoped(abi, (a) => a.alloc(4, 4))).toThrow("Misaligned");
    expect(abi.dealloc).toHaveBeenCalledWith(5, 4, 4);
    vi.spyOn(abi, "alloc").mockReturnValue(0xfffffffc);
    expect(() => WasmArena.scoped(abi, (a) => a.alloc(8, 4))).toThrow("range");
    expect(abi.dealloc).toHaveBeenCalledWith(0xfffffffc, 8, 4);
  });
  it.each([false, true])("attempts all cleanup and retains body failure=%s", (failBody) => {
    const { abi } = wasmFixture();
    const dealloc = abi.dealloc.bind(abi);
    const free = vi.spyOn(abi, "dealloc").mockImplementation((...args) => {
      dealloc(...args);
      throw new Error("cleanup");
    });
    expect(() =>
      WasmArena.scoped(abi, (a) => {
        a.alloc(4, 4);
        a.alloc(16, 8);
        if (failBody) throw new Error("body");
      }),
    ).toThrow(failBody ? "call and temporary cleanup" : "temporary cleanup");
    expect(free).toHaveBeenCalledTimes(2);
  });
  it("recreates views after repeated growth", () => {
    const { abi } = wasmFixture();
    WasmArena.scoped(abi, (a) => {
      const ptr = a.alloc(8, 8);
      for (let i = 0; i < 10; i++) {
        a.view(ptr, 8).setBigInt64(0, BigInt(i), true);
        abi.memory.grow(1);
        expect(a.view(ptr, 8).getBigInt64(0, true)).toBe(BigInt(i));
      }
    });
  });
  it("validates u32/u64 rather than truncating", () => {
    for (const value of [-1, 1.5, NaN, Infinity, 0x100000000])
      expect(() => u32(value)).toThrow(EngineError);
    for (const value of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, -1n, 1n << 64n])
      expect(() => u64(value)).toThrow(EngineError);
    expect(u32(0xffffffff)).toBe(0xffffffff);
    expect(u64(42)).toBe(42n);
    expect(u64(0xffffffffffffffffn)).toBe(0xffffffffffffffffn);
  });
});

describe("hegel_host imports", () => {
  it("fails safely before memory assignment and uses fresh views after growth", () => {
    const host = createHostImports(),
      imports = host.imports.hegel_host;
    expect(Object.keys(imports).sort()).toEqual(["entropy_fill", "monotonic_nanos"]);
    expect(imports.entropy_fill(4, 4)).toBe(0);
    const memory = new WebAssembly.Memory({ initial: 2 });
    host.setMemory(memory);
    vi.stubGlobal("crypto", { getRandomValues: (bytes: Uint8Array) => bytes.fill(42) });
    expect(imports.entropy_fill(4, 4)).toBe(1);
    expect(new Uint8Array(memory.buffer, 4, 4)).toEqual(new Uint8Array([42, 42, 42, 42]));
    memory.grow(1);
    expect(imports.entropy_fill(131072, 4)).toBe(1);
    expect(new Uint8Array(memory.buffer, 131072, 4)).toEqual(new Uint8Array([42, 42, 42, 42]));
    expect(imports.entropy_fill(-1, 4)).toBe(0);
    expect(imports.entropy_fill(0, 4)).toBe(0);
  });
  it("returns failure on Web Crypto errors including its chunk limit", () => {
    const host = createHostImports();
    host.setMemory(new WebAssembly.Memory({ initial: 2 }));
    expect(host.imports.hegel_host.entropy_fill(1, 65537)).toBe(0);
    expect(host.imports.hegel_host.entropy_fill(1, 65536)).toBe(1);
    vi.stubGlobal("crypto", {
      getRandomValues: () => {
        throw new Error("denied");
      },
    });
    expect(host.imports.hegel_host.entropy_fill(1, 4)).toBe(0);
  });
  it("returns bigint monotonic nanoseconds and a negative unavailable sentinel", () => {
    const now = createHostImports().imports.hegel_host.monotonic_nanos;
    const first = now();
    expect(typeof first).toBe("bigint");
    expect(now()).toBeGreaterThanOrEqual(first);
    vi.stubGlobal("performance", { now: () => 12.345678 });
    expect(now()).toBe(12345678n);
    for (const value of [-1, NaN, Infinity, 1e20]) {
      vi.stubGlobal("performance", { now: () => value });
      expect(now()).toBe(-1n);
    }
    vi.stubGlobal("performance", {
      now: () => {
        throw new Error("unavailable");
      },
    });
    expect(now()).toBe(-1n);
  });
});
