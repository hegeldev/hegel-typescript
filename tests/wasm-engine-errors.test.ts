import { describe, expect, it, vi } from "vitest";
import { WasmEngine } from "../src/browser/engine.js";
import { EngineError, Status, type UuidVersion } from "../src/engine.js";
import { browserRuntime } from "../src/browser/runtime.js";
import { createRunner } from "../src/runnerCore.js";
import { WasmMemory } from "../src/browser/arena.js";
import { wasmFixture } from "./wasmFixture.js";
import * as gs from "../src/generators/index.js";

describe("WasmEngine malformed outputs and cleanup", () => {
  it("rejects null context/settings/version outputs and accepts null context diagnostics", () => {
    const { abi } = wasmFixture(),
      engine = new WasmEngine(abi);
    const call = abi.call.bind(abi);
    const spy = vi
      .spyOn(abi, "call")
      .mockImplementation((op, ...args) => (op === "context_new" ? 0 : call(op, ...args)));
    expect(() => engine.newContext()).toThrow("null owned handle");
    spy.mockImplementation((op, ...args) =>
      op === "settings_new" || op === "version" ? 0 : call(op, ...args),
    );
    expect(() => engine.newSettings()).toThrow("null owned handle");
    expect(() => engine.version()).toThrow("version string is null");
    const ctx = engine.newContext();
    spy.mockImplementation((op, ...args) => (op === "context_last_error" ? 0 : call(op, ...args)));
    expect(engine.lastError(ctx)).toBe("");
    engine.freeContext(ctx);
  });

  it("rejects invalid integer/temporal bounds and big integer output length", () => {
    const { engine, abi } = wasmFixture();
    const ctx = engine.newContext(),
      settings = engine.newSettings(),
      run = engine.runStart(ctx, settings),
      tc = engine.nextTestCase(ctx, run)!;
    expect(() => engine.generateInteger(ctx, tc, 1n, 0n)).toThrow(EngineError);
    expect(() => engine.generateUuid(ctx, tc, 16 as UuidVersion)).toThrow("single hex nibble");
    const date = { year: 2024, month: 2, day: 29 };
    expect(() => engine.generateDate(ctx, tc, { ...date, month: 256 }, date)).toThrow(
      "temporal field",
    );
    expect(() => engine.generateInteger(ctx, tc, -(1n << 64n), 0n)).toThrow("signed i64");
    expect(() => engine.generateInteger(ctx, tc, 0n, 1n << 63n)).toThrow("signed i64");
    const call = abi.call.bind(abi);
    vi.spyOn(abi, "call").mockImplementation((op, ...args) =>
      op === "generate_integer_big" ? 0 : call(op, ...args),
    );
    expect(() => engine.generateIntegerBig(ctx, tc, 0n, 1n)).toThrow("result length");
    engine.freeTestCase(tc);
    engine.freeRun(run);
    engine.freeSettings(settings);
    engine.freeContext(ctx);
  });

  it.each([false, true])(
    "releases engine buffer and arena after a result-free failure, with copy failure=%s",
    (failCopy) => {
      const { engine, abi } = wasmFixture();
      const ctx = engine.newContext(),
        settings = engine.newSettings(),
        run = engine.runStart(ctx, settings),
        tc = engine.nextTestCase(ctx, run)!;
      const call = abi.call.bind(abi);
      let data = 0,
        result = 0;
      const free = vi.spyOn(abi, "dealloc");
      vi.spyOn(abi, "call").mockImplementation((op, ...args) => {
        if (op === "generate_bytes") {
          const code = call(op, ...args);
          result = Number(args.at(-1));
          data = new DataView(abi.memory.buffer).getUint32(result, true);
          if (failCopy) new DataView(abi.memory.buffer).setUint32(result, 0, true);
          return code;
        }
        if (op === "generate_bytes_result_free") {
          new DataView(abi.memory.buffer).setUint32(result, data, true);
          call(op, ...args);
          return -8;
        }
        return call(op, ...args);
      });
      expect(() => engine.generateBytes(ctx, tc, 3, 3)).toThrow(
        failCopy ? "copy and release failed" : "failed (-8)",
      );
      expect(free).toHaveBeenCalledWith(result, 8, 4);
      engine.freeTestCase(tc);
      engine.freeRun(run);
      engine.freeSettings(settings);
      engine.freeContext(ctx);
    },
  );

  it("decodes injected WTF-8 bytes through the exact string-result lifecycle", () => {
    const { engine, abi } = wasmFixture();
    const ctx = engine.newContext(),
      settings = engine.newSettings(),
      run = engine.runStart(ctx, settings),
      tc = engine.nextTestCase(ctx, run)!;
    const generator = engine.stringGeneratorText(ctx, {
      minSize: 3,
      maxSize: 3n,
      codec: null,
      minCodepoint: 0,
      maxCodepoint: 0,
      categories: null,
      excludeCategories: null,
      includeCharacters: null,
      excludeCharacters: null,
    });
    const call = abi.call.bind(abi);
    let result = 0;
    const spy = vi.spyOn(abi, "call").mockImplementation((op, ...args) => {
      const code = call(op, ...args);
      if (op === "generate_string") {
        result = Number(args.at(-1));
        const memory = new WasmMemory(abi.memory);
        memory.bytes(memory.pointer(result), 3).set([0xed, 0xa0, 0x80]);
      }
      return code;
    });
    expect(engine.generateString(ctx, tc, generator)).toBe("\ud800");
    expect(spy).toHaveBeenCalledWith("generate_string_result_free", 0, result);
    engine.freeStringGenerator(generator);
    engine.freeTestCase(tc);
    engine.freeRun(run);
    engine.freeSettings(settings);
    engine.freeContext(ctx);
  });

  it("supports unbounded bytes/collections and UTF-8 rejection diagnostics", () => {
    const { engine } = wasmFixture();
    const ctx = engine.newContext(),
      settings = engine.newSettings(),
      run = engine.runStart(ctx, settings),
      tc = engine.nextTestCase(ctx, run)!;
    expect(engine.generateBytes(ctx, tc, 0)).toBeInstanceOf(Uint8Array);
    const collection = engine.newCollection(ctx, tc, 1);
    expect(engine.collectionMore(ctx, tc, collection)).toBe(true);
    engine.collectionReject(ctx, tc, collection, "rejected 🙂");
    expect(engine.collectionMore(ctx, tc, collection)).toBe(true);
    engine.collectionReject(ctx, tc, collection, null);
    engine.freeCollection(collection);
    engine.markComplete(ctx, tc, Status.INVALID, null);
    engine.freeTestCase(tc);
    engine.freeRun(run);
    engine.freeSettings(settings);
    engine.freeContext(ctx);
  });

  it("rejects null failure origins without replay and exercises browser no-op host services", () => {
    const { engine, abi } = wasmFixture(),
      call = abi.call.bind(abi);
    const runtime = browserRuntime(engine);
    runtime.emitAntithesisAssertion(
      { class: "test", function: "test", file: "test.ts", beginLine: 1 },
      true,
    );
    vi.spyOn(abi, "call").mockImplementation((op, ...args) =>
      op === "failure_origin" ? 0 : call(op, ...args),
    );
    expect(() =>
      createRunner(runtime).test(
        (tc) => {
          tc.draw(gs.booleans());
          throw new Error("failure");
        },
        { seed: 42 },
      ),
    ).toThrow("failure origin is null");
  });
});
