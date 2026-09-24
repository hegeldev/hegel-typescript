import { afterEach, describe, expect, it, vi } from "vitest";
import { loadWasm } from "../src/browser/load-wasm.js";
import { WasmEngine } from "../src/browser/engine.js";
import { WasmAbi, signatures } from "../src/browser/abi.js";
import { EngineError } from "../src/engine.js";
import { wasmBytes, wasmFixture, wasmModule } from "./wasmFixture.js";

const response = (mime = "application/wasm") =>
  new Response(wasmBytes, { headers: { "Content-Type": mime } });
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("loadWasm", () => {
  it("loads ArrayBuffer and precompiled Module inputs", async () => {
    expect((await loadWasm(wasmBytes)).version()).toBe("0.43.2");
    expect((await loadWasm(wasmModule)).version()).toBe("0.43.2");
  });
  it("fetches the supplied URL and prefers streaming", async () => {
    const fetch = vi.fn().mockResolvedValue(response());
    vi.stubGlobal("fetch", fetch);
    const streaming = vi.spyOn(WebAssembly, "instantiateStreaming");
    const url = new URL("https://example.test/sub/hegel.wasm");
    expect((await loadWasm(url)).version()).toBe("0.43.2");
    expect(fetch).toHaveBeenCalledExactlyOnceWith(url);
    expect(streaming).toHaveBeenCalledTimes(1);
  });
  it("clones a consumed response for MIME fallback", async () => {
    const supplied = response("application/octet-stream");
    vi.spyOn(WebAssembly, "instantiateStreaming").mockImplementation(async (value) => {
      await (await value).arrayBuffer();
      throw new TypeError("unsupported MIME");
    });
    expect((await loadWasm(supplied)).version()).toBe("0.43.2");
    expect(supplied.bodyUsed).toBe(true);
  });
  it("falls back for actual missing/wrong MIME headers", async () => {
    expect((await loadWasm(response("text/plain"))).version()).toBe("0.43.2");
    expect((await loadWasm(new Response(wasmBytes))).version()).toBe("0.43.2");
  });
  it("falls back for an actual parameterized Wasm MIME header", async () => {
    const streaming = vi.spyOn(WebAssembly, "instantiateStreaming");
    const fallback = vi.spyOn(WebAssembly, "instantiate");
    expect((await loadWasm(response("application/wasm; charset=utf-8"))).version()).toBe("0.43.2");
    expect(streaming).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledTimes(1);
  });
  it("uses bytes if streaming is unavailable", async () => {
    vi.stubGlobal(
      "WebAssembly",
      Object.assign(Object.create(WebAssembly), { instantiateStreaming: undefined }),
    );
    expect((await loadWasm(response())).version()).toBe("0.43.2");
  });
  it("checks HTTP errors before reading the body", async () => {
    const supplied = new Response("not found", { status: 404 });
    await expect(loadWasm(supplied)).rejects.toThrow("HTTP 404");
    expect(supplied.bodyUsed).toBe(false);
  });
  it.each([
    new WebAssembly.RuntimeError("trap"),
    new WebAssembly.LinkError("wrong imports"),
    new WebAssembly.CompileError("bad module"),
  ])("does not retry %s as a MIME failure", async (error) => {
    vi.spyOn(WebAssembly, "instantiateStreaming").mockRejectedValue(error);
    const fallback = vi.spyOn(WebAssembly, "instantiate");
    await expect(loadWasm(response("text/plain"))).rejects.toMatchObject({ cause: error });
    expect(fallback).not.toHaveBeenCalled();
  });
  it("does not retry a TypeError with the correct MIME", async () => {
    vi.spyOn(WebAssembly, "instantiateStreaming").mockRejectedValue(
      new TypeError("wrong imported value"),
    );
    const fallback = vi.spyOn(WebAssembly, "instantiate");
    await expect(loadWasm(response())).rejects.toThrow("Failed to load");
    expect(fallback).not.toHaveBeenCalled();
  });
  it("rejects wrong versions and import shapes", async () => {
    vi.spyOn(WasmEngine.prototype, "version").mockReturnValueOnce("0.42.3");
    await expect(loadWasm(wasmModule)).rejects.toThrow("expected 0.43.2, got 0.42.3");
    const empty = new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
    await expect(loadWasm(empty)).rejects.toThrow("host imports");
    vi.spyOn(WebAssembly.Module, "imports").mockReturnValue([
      { module: "hegel_host", name: "entropy_fill", kind: "function" },
      { module: "hegel_host", name: "entropy_fill", kind: "function" },
    ]);
    await expect(loadWasm(wasmModule)).rejects.toThrow("host imports");
  });
  it("reports fetch and compilation failures as engine errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(loadWasm(new URL("https://example.test/engine.wasm"))).rejects.toBeInstanceOf(
      EngineError,
    );
    await expect(loadWasm(new ArrayBuffer(0))).rejects.toBeInstanceOf(EngineError);
  });
});

describe("WasmAbi", () => {
  it("checks every required function and allocator arity", () => {
    const { exports } = wasmFixture();
    for (const name of [
      ...Object.keys(signatures).map((name) => `hegel_${name}`),
      "hegel_alloc",
      "hegel_dealloc",
    ]) {
      const missing = { ...exports };
      delete missing[name];
      expect(() => new WasmAbi(missing)).toThrow(name);
      const incompatible = Object.defineProperty(() => 0, "length", {
        value: (exports[name] as (...args: unknown[]) => unknown).length + 1,
      });
      expect(() => new WasmAbi({ ...exports, [name]: incompatible })).toThrow(name);
    }
  });
  it("requires exported memory", () => {
    const { exports } = wasmFixture();
    const missing = { ...exports };
    delete missing.memory;
    expect(() => new WasmAbi(missing)).toThrow("memory");
  });
  it("validates argument widths/arity and i32 return values", () => {
    const { abi, exports } = wasmFixture();
    expect(() => abi.call("context_new", 0)).toThrow("arity");
    expect(() => abi.call("context_free", 1.5)).toThrow("Invalid I");
    expect(() => abi.call("settings_set_test_cases", 0, 1, 42)).toThrow("Invalid L");
    expect(() => abi.call("settings_set_test_cases", 0, 1, -0x8000000000000001n)).toThrow(
      "Invalid L",
    );
    expect(() => abi.call("generate_boolean", 0, 1, 1n, 0, 0, 1)).toThrow("Invalid D");
    expect(() =>
      new WasmAbi({ ...exports, hegel_context_new: () => NaN }).call("context_new"),
    ).toThrow("i32 result");
    const badAlloc = (_size: number, _align: number) => NaN;
    expect(() => new WasmAbi({ ...exports, hegel_alloc: badAlloc }).alloc(4, 4)).toThrow(
      "allocation pointer",
    );
  });
  it("wraps actual export traps", () => {
    const { exports } = wasmFixture();
    const abi = new WasmAbi({
      ...exports,
      hegel_context_new: () => {
        throw new WebAssembly.RuntimeError("unreachable");
      },
    });
    expect(() => abi.call("context_new")).toThrow(EngineError);
  });
});
