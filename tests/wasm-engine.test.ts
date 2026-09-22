import { describe, it, expect, vi } from "vitest";
import { wasmFixture } from "./wasmFixture.js";
import { createRunner, Database, HealthCheck } from "../src/runnerCore.js";
import { browserRuntime } from "../src/browser/runtime.js";
import { WasmArena } from "../src/browser/arena.js";
import {
  EngineError,
  NativeVerbosity,
  RunStatus,
  Status,
  type Engine,
  type TextGeneratorOptions,
} from "../src/engine.js";
import { AssumeError, StopTestError } from "../src/testCase.js";
import * as gs from "../src/generators/index.js";
import * as stateful from "../src/stateful.js";
import { Libhegel } from "../src/libhegel.js";
import { testLibPath } from "./libPath.js";

function active<T>(
  engine: Engine,
  body: (
    ctx: ReturnType<Engine["newContext"]>,
    tc: NonNullable<ReturnType<Engine["nextTestCase"]>>,
  ) => T,
): T {
  const ctx = engine.newContext();
  try {
    const settings = engine.newSettings(ctx);
    try {
      engine.setSeed(settings, 42n);
      engine.setDatabase(ctx, settings, "");
      const run = engine.runStart(ctx, settings);
      try {
        const tc = engine.nextTestCase(ctx, run)!;
        try {
          return body(ctx, tc);
        } finally {
          engine.freeTestCase(tc);
        }
      } finally {
        engine.freeRun(run);
      }
    } finally {
      engine.freeSettings(settings);
    }
  } finally {
    engine.freeContext(ctx);
  }
}

const text: TextGeneratorOptions = {
  minSize: 3,
  maxSize: 3n,
  codec: null,
  minCodepoint: 0,
  maxCodepoint: 0,
  categories: null,
  excludeCategories: null,
  includeCharacters: null,
  excludeCharacters: null,
};

describe("WasmEngine pinned raw ABI", () => {
  it("matches native fixed temporal and signed integer draws", () => {
    const wasm = wasmFixture().engine;
    const native = Libhegel.load(testLibPath());
    const draw = (engine: Engine) =>
      active(engine, (ctx, tc) => {
        const date = { year: -12345, month: 6, day: 17 };
        const values: unknown[] = [engine.generateDate(ctx, tc, date, date)];
        for (const nanosecond of [0, 1, 123456789, 999999999]) {
          const time = { hour: 12, minute: 34, second: 56, nanosecond };
          values.push(engine.generateTime(ctx, tc, time, time));
          values.push(engine.generateDatetime(ctx, tc, { date, time }, { date, time }));
          expect(values.at(-2)).toEqual(time);
          expect(values.at(-1)).toEqual({ date, time });
        }
        for (const value of [-1n << 127n, 1n << 127n, -129n, 0n, 128n]) {
          expect(engine.generateIntegerBig(ctx, tc, value, value)).toBe(value);
        }
        expect(engine.generateInteger(ctx, tc, -12n, -12n)).toBe(-12n);
        const uuid = engine.generateUuid(ctx, tc, 4);
        expect(uuid).toHaveLength(16);
        expect(uuid[6] >> 4).toBe(4);
        expect(uuid[8] >> 6).toBe(2);
        values.push(Array.from(uuid), Array.from(engine.generateUuid(ctx, tc)));
        return values;
      });
    expect(draw(wasm)).toEqual(draw(native));
  });

  it("copies empty buffers, NUL, WTF-8 surrogates and astral text, preserving null vs empty lists", () => {
    const { engine } = wasmFixture();
    active(engine, (ctx, tc) => {
      expect(engine.generateBytes(ctx, tc, 0, 0)).toEqual(new Uint8Array());
      expect(engine.generateBytes(ctx, tc, 7, 7)).toHaveLength(7);
      for (const codepoint of [0, 0x1f642]) {
        const generator = engine.stringGeneratorText(ctx, {
          ...text,
          minCodepoint: codepoint,
          maxCodepoint: codepoint,
        });
        try {
          expect(engine.generateString(ctx, tc, generator)).toBe(
            String.fromCodePoint(codepoint).repeat(3),
          );
        } finally {
          engine.freeStringGenerator(generator);
        }
      }
      expect(() =>
        engine.stringGeneratorText(ctx, { ...text, minCodepoint: 0xd800, maxCodepoint: 0xd800 }),
      ).toThrow(/No valid characters/);
      const generator = engine.stringGeneratorText(ctx, {
        ...text,
        categories: [],
        excludeCategories: [],
        includeCharacters: new Uint8Array([0]),
        excludeCharacters: new Uint8Array(),
      });
      try {
        expect(engine.generateString(ctx, tc, generator)).toBe("\0\0\0");
      } finally {
        engine.freeStringGenerator(generator);
      }
      expect(() => engine.stringGeneratorText(ctx, { ...text, categories: [] })).toThrow(
        EngineError,
      );
    });
  });

  it("survives growth between allocations and after every engine call", () => {
    const { engine, abi } = wasmFixture();
    const alloc = abi.alloc.bind(abi),
      call = abi.call.bind(abi);
    vi.spyOn(abi, "alloc").mockImplementation((size, align) => {
      const ptr = alloc(size, align);
      abi.memory.grow(1);
      return ptr;
    });
    vi.spyOn(abi, "call").mockImplementation((op, ...args) => {
      const result = call(op, ...args);
      abi.memory.grow(1);
      return result;
    });
    active(engine, (ctx, tc) => {
      const generator = engine.stringGeneratorText(ctx, {
        ...text,
        categories: ["Cc"],
        codec: "utf-8",
      });
      try {
        expect(engine.generateString(ctx, tc, generator)).toBe("\0\0\0");
      } finally {
        engine.freeStringGenerator(generator);
      }
      const bytes = engine.generateBytes(ctx, tc, 20, 20);
      const copy = bytes.slice();
      abi.memory.grow(2);
      expect(bytes).toEqual(copy);
      expect(
        engine.generateIntegerBig(ctx, tc, -100000000000000000000n, -100000000000000000000n),
      ).toBe(-100000000000000000000n);
    });
  });

  it("drives pools and state machines like the native adapter", () => {
    const wasm = wasmFixture().engine;
    const native = Libhegel.load(testLibPath());
    const options = {
      ruleNames: ["push", "pop"],
      ruleGroups: [0, 0],
      invariantNames: ["sorted", "small"],
      invariantAlwaysCheck: [true, false],
      minConcurrency: 1,
      maxConcurrency: 1,
      stepCount: 5,
    };
    const drive = (engine: Engine) =>
      active(engine, (ctx, tc) => {
        const trace: unknown[] = [];
        const pool = engine.newPool(ctx, tc);
        const machine = engine.newStateMachine(ctx, tc, options);
        try {
          expect(() => engine.poolGenerate(ctx, tc, pool, false)).toThrow(AssumeError);
          const first = engine.poolAdd(ctx, tc, pool);
          const second = engine.poolAdd(ctx, tc, pool);
          expect(first).not.toBe(second);
          expect([first, second]).toContain(engine.poolGenerate(ctx, tc, pool, false));
          expect([first, second]).toContain(engine.poolGenerate(ctx, tc, pool, true));
          trace.push(engine.poolGenerate(ctx, tc, pool, true));
          expect(() => engine.poolGenerate(ctx, tc, pool, true)).toThrow(AssumeError);
          let rounds = 0;
          while (engine.stateMachineNextGroup(ctx, tc, machine) !== null) {
            rounds++;
            for (;;) {
              const rule = engine.stateMachineNextRule(ctx, tc, machine, 0);
              if (rule === null) break;
              trace.push(rule);
              if (rule === 1) engine.stateMachineRuleRejected(ctx, tc, machine, 0);
            }
            expect(engine.stateMachineShouldCheckInvariant(ctx, tc, machine, 0)).toBe(true);
            trace.push(engine.stateMachineShouldCheckInvariant(ctx, tc, machine, 1));
          }
          expect(rounds).toBeGreaterThan(0);
          expect(rounds).toBeLessThanOrEqual(1000);
          return trace;
        } finally {
          engine.freeStateMachine(machine);
          engine.freePool(pool);
        }
      });
    expect(drive(wasm)).toEqual(drive(native));
  });

  it("runs a stateful test with a pool in the browser runner", () => {
    const runner = createRunner(browserRuntime(wasmFixture().engine));
    let steps = 0;
    expect(() =>
      runner.test(
        (tc) => {
          const handles = new stateful.Pool<number>(tc);
          stateful.run(
            tc,
            {
              rules: {
                alloc: (_tc, state: { live: Set<number>; next: number }) => {
                  const handle = state.next++;
                  handles.add(handle);
                  state.live.add(handle);
                  steps++;
                },
                free: (tc, state) => {
                  const handle = tc.draw(handles.valuesConsumed());
                  state.live.delete(handle);
                  steps++;
                  if (state.next > 3) throw new Error(`freed ${handle} late`);
                },
              },
              invariants: {
                liveMatchesPool: (_tc, state) => {
                  expect(state.live.size).toBe(handles.size);
                },
              },
            },
            { live: new Set<number>(), next: 0 },
          );
        },
        { seed: 42, testCases: 30 },
      ),
    ).toThrow(/freed \d+ late/);
    expect(steps).toBeGreaterThan(0);
  });

  it("draws NaN and infinities and composes the portable generator helpers", () => {
    const runner = createRunner(browserRuntime(wasmFixture().engine));
    let nan = false,
      infinite = false;
    runner.test(
      (tc) => {
        const value = tc.draw(gs.floats());
        nan ||= Number.isNaN(value);
        infinite ||= value === Infinity || value === -Infinity;
      },
      { testCases: 200, seed: 42 },
    );
    expect(nan).toBe(true);
    expect(infinite).toBe(true);
  });

  it("runs every schema category through the single interpreter", () => {
    const { engine } = wasmFixture();
    const runner = createRunner(browserRuntime(engine));
    runner.test(
      (tc) => {
        tc.draw(gs.booleans());
        tc.draw(gs.integers());
        tc.draw(gs.bigIntegers());
        tc.draw(gs.floats());
        tc.draw(gs.binary({ minSize: 1, maxSize: 10 }));
        tc.draw(gs.text({ maxSize: 10 }));
        tc.draw(gs.fromRegex("a[bc]+", { fullmatch: true }));
        tc.draw(gs.emails());
        tc.draw(gs.urls());
        tc.draw(gs.domains());
        tc.draw(gs.dates());
        tc.draw(gs.times());
        tc.draw(gs.datetimes());
        tc.draw(gs.uuids());
        tc.draw(gs.uuids({ version: 4 }));
        tc.draw(gs.ipAddresses({ version: 4 }));
        tc.draw(gs.ipAddresses({ version: 6 }));
        tc.draw(gs.arrays(gs.integers(), { maxSize: 5 }));
        tc.draw(gs.maps(gs.integers(), gs.booleans(), { maxSize: 5 }));
        tc.draw(gs.tuples(gs.integers(), gs.text({ maxSize: 2 })));
        tc.draw(gs.oneOf(gs.just(null), gs.integers()));
      },
      {
        testCases: 15,
        seed: 42,
        database: Database.unset,
        suppressHealthCheck: [HealthCheck.TooSlow],
      },
    );
    active(engine, (ctx, tc) => {
      expect(
        engine.generateFloat(ctx, tc, {
          width: 64,
          minValue: Infinity,
          maxValue: Infinity,
          allowNan: false,
          allowInfinity: true,
          excludeMin: false,
          excludeMax: false,
          smallestNonzeroMagnitude: 5e-324,
        }),
      ).toBe(Infinity);
    });
  });
});

describe("WasmEngine real run lifecycle", () => {
  it("passes sync and async bodies with assumptions and notes", async () => {
    const { engine } = wasmFixture();
    const runtime = browserRuntime(engine),
      runner = createRunner(runtime);
    const note = vi.spyOn(runtime, "note");
    runner.test(
      (tc) => {
        tc.assume(tc.draw(gs.integers({ minValue: 0, maxValue: 10 })) > 0);
        tc.note("passing");
      },
      { testCases: 10, seed: 42 },
    );
    await runner.testAsync(
      async (tc) => {
        await Promise.resolve();
        expect(tc.draw(gs.booleans())).toBeTypeOf("boolean");
      },
      { testCases: 5, seed: 42 },
    );
    expect(note).not.toHaveBeenCalled();
  });

  it("shrinks and reports a replayed failure with notes in both drivers", async () => {
    for (const async of [false, true]) {
      const { engine } = wasmFixture();
      const runtime = browserRuntime(engine);
      const values: unknown[] = [];
      runtime.reportFinalValue = (value) => values.push(value);
      runtime.reportFinalError = vi.fn();
      runtime.note = vi.fn();
      const runner = createRunner(runtime);
      const replay = vi.spyOn(engine, "testCaseFromBlob");
      const body = (tc: import("../src/testCase.js").TestCase) => {
        const n = tc.draw(gs.integers({ minValue: 0, maxValue: 1000 }));
        tc.note("replay note");
        if (n >= 50) throw new Error(`bad ${n}`);
      };
      if (async) await expect(runner.testAsync(body, { seed: 42 })).rejects.toThrow("bad 50");
      else expect(() => runner.test(body, { seed: 42 })).toThrow("bad 50");
      expect(values).toEqual([50]);
      expect(replay).toHaveBeenCalledTimes(1);
      expect(runtime.note).toHaveBeenCalledWith("replay note");
      const native = Libhegel.load(testLibPath());
      const ctx = native.newContext(),
        settings = native.newSettings(ctx);
      try {
        const tc = native.testCaseFromBlob(ctx, settings, replay.mock.calls[0][2]);
        try {
          expect(native.generateInteger(ctx, tc, 0n, 1000n)).toBe(50n);
        } finally {
          native.freeTestCase(tc);
        }
      } finally {
        native.freeSettings(settings);
        native.freeContext(ctx);
      }
    }
  });

  it.each([false, true])(
    "reports a real flaky run as ERROR without frontend replay, async=%s",
    async (async) => {
      const { engine } = wasmFixture();
      const status = vi.spyOn(engine, "runStatus");
      const failureCount = vi.spyOn(engine, "failureCount");
      const failure = vi.spyOn(engine, "failure");
      const replay = vi.spyOn(engine, "testCaseFromBlob");
      const free = vi.spyOn(engine, "freeContext");
      const runner = createRunner(browserRuntime(engine));
      let seen = false;
      const body = (tc: import("../src/testCase.js").TestCase) => {
        const n = tc.draw(gs.integers({ minValue: 0, maxValue: 100 }));
        if (n > 0 && !seen) {
          seen = true;
          throw new Error("flaky failure");
        }
      };
      // Status 3 is for declared concurrent state machines, not ordinary flakiness.
      if (async) await expect(runner.testAsync(body, { seed: 42 })).rejects.toThrow(/flaky/i);
      else expect(() => runner.test(body, { seed: 42 })).toThrow(/flaky/i);
      expect(seen).toBe(true);
      expect(status).toHaveReturnedWith(RunStatus.ERROR);
      expect(failureCount).not.toHaveBeenCalled();
      expect(failure).not.toHaveBeenCalled();
      expect(replay).not.toHaveBeenCalled();
      expect(free).toHaveBeenCalledTimes(1);
    },
  );

  it("reports multiple independent origins", () => {
    const { engine } = wasmFixture();
    const runtime = browserRuntime(engine);
    runtime.reportFinalError = vi.fn();
    runtime.reportFinalValue = vi.fn();
    const replay = vi.spyOn(engine, "testCaseFromBlob");
    expect(() =>
      createRunner(runtime).test(
        (tc) => {
          const n = tc.draw(gs.integers({ minValue: 0, maxValue: 10 }));
          if (n < 3) throw new Error("low");
          if (n > 7) throw new Error("high");
        },
        { seed: 42, reportMultipleFailures: true },
      ),
    ).toThrow(/low|high/);
    expect(replay).toHaveBeenCalledTimes(2);
  });

  it("reports real health errors without replay and rejects filesystem settings", () => {
    const { engine } = wasmFixture();
    const runner = createRunner(browserRuntime(engine));
    const replay = vi.spyOn(engine, "testCaseFromBlob");
    expect(() => runner.test((tc) => tc.assume(false), { seed: 42 })).toThrow(/Unsatisfiable/i);
    expect(replay).not.toHaveBeenCalled();
    expect(() => runner.test(() => {}, { database: Database.fromPath("") })).toThrow(/Filesystem/);
  });

  it("handles engine overrun and explicit completion, snapshots and blob replay", () => {
    const { engine } = wasmFixture();
    for (const adapter of [engine, Libhegel.load(testLibPath())])
      active(adapter, (ctx, tc) => {
        expect(() => {
          // The engine concludes a case as overrun once it has made 2^20 choices.
          for (let i = 0; i <= 1 << 20; i++) adapter.generateBoolean(ctx, tc, 0.5);
        }).toThrow(StopTestError);
        expect(() => adapter.newCollection(ctx, tc, 0, 5)).toThrow(StopTestError);
        adapter.markComplete(ctx, tc, Status.OVERRUN, null);
      });
    const ctx = engine.newContext(),
      settings = engine.newSettings(ctx);
    engine.setDatabase(ctx, settings, null);
    engine.setTestCases(settings, 1);
    // Every health check except TestCasesTooLarge (bit 2): suppressing that
    // one also lifts the choice limit the overrun above relies on.
    engine.setSuppressHealthCheck(settings, 1 | 2 | 8);
    engine.setDerandomize(settings, true);
    engine.setVerbosity(settings, NativeVerbosity.QUIET);
    engine.setDatabaseKey(ctx, settings, "Unicode 🙂");
    const run = engine.runStart(ctx, settings);
    let tc;
    while ((tc = engine.nextTestCase(ctx, run)) !== null) {
      try {
        engine.generateInteger(ctx, tc, 42n, 42n);
        engine.markComplete(ctx, tc, Status.INTERESTING, "origin");
      } catch (error) {
        if (!(error instanceof StopTestError)) throw error;
        engine.markComplete(ctx, tc, Status.OVERRUN, null);
      } finally {
        engine.freeTestCase(tc);
      }
    }
    const result = engine.runResult(ctx, run);
    expect(engine.runStatus(result)).toBe(RunStatus.FAILED);
    expect(engine.runError(result)).toBe(null);
    expect(engine.failureCount(result)).toBe(1);
    const failure = engine.failure(result, 0);
    const blob = engine.reproductionBlob(failure)!;
    expect(engine.failureOrigin(failure)).toBe("origin");
    engine.freeFailure(failure);
    const replay = engine.testCaseFromBlob(ctx, settings, blob);
    expect(engine.generateInteger(ctx, replay, 42n, 42n)).toBe(42n);
    engine.markComplete(ctx, replay, Status.INTERESTING, "origin");
    engine.freeTestCase(replay);
    engine.freeRunResult(result);
    engine.freeRun(run);
    engine.freeSettings(settings);
    engine.freeContext(ctx);
  });
});

describe("WasmEngine error and ownership boundaries", () => {
  it("copies diagnostics before cleanup, checks settings and rejects stale/foreign handles", () => {
    const { engine } = wasmFixture();
    const ctx = engine.newContext(),
      s = engine.newSettings(ctx);
    expect(engine.lastError(ctx)).toBe("");
    expect(() => engine.setDatabaseKey(ctx, s, "bad\0key")).toThrow(/NUL/);
    expect(() => engine.setDatabase(ctx, s, "path")).toThrow(/Filesystem/);
    expect(() => engine.testCaseFromBlob(ctx, s, "bad blob")).toThrow(/failed/);
    expect(() => engine.testCaseFromBlob(ctx, s, null)).toThrow(/blob pointer is null/);
    expect(() => engine.setVerbosity(s, 99)).toThrow(/failed/);
    expect(() => wasmFixture().engine.freeSettings(s)).toThrow(/Foreign/);
    engine.freeSettings(s);
    expect(() => engine.freeSettings(s)).toThrow(/freed/);
    engine.freeContext(ctx);
  });

  it.each([-1, -2, -3, -4, -5, -6, -7, -8, -9, -10])(
    "maps draw code %s without interesting counterexamples",
    (code) => {
      const { engine, abi } = wasmFixture();
      active(engine, (ctx, tc) => {
        const call = abi.call.bind(abi);
        vi.spyOn(abi, "call").mockImplementation((op, ...args) =>
          op === "generate_boolean" ? code : call(op, ...args),
        );
        expect(() => engine.generateBoolean(ctx, tc, 0.5)).toThrow(
          code === -1 ? StopTestError : code === -2 ? AssumeError : EngineError,
        );
        vi.spyOn(abi, "call").mockImplementation((op, ...args) =>
          op === "new_collection" ? code : call(op, ...args),
        );
        expect(() => engine.newCollection(ctx, tc, 0, 5)).toThrow(
          code === -1 ? StopTestError : code === -2 ? AssumeError : EngineError,
        );
      });
    },
  );

  it("runs exact result destructor after corrupted buffer output and releases the slot", () => {
    const { engine, abi } = wasmFixture();
    active(engine, (ctx, tc) => {
      const call = abi.call.bind(abi);
      let data = 0,
        result = 0;
      const frees = vi.spyOn(abi, "dealloc");
      const spy = vi.spyOn(abi, "call").mockImplementation((op, ...args) => {
        if (op === "generate_bytes") {
          const code = call(op, ...args);
          result = Number(args.at(-1));
          const view = new DataView(abi.memory.buffer);
          data = view.getUint32(result, true);
          view.setUint32(result, 0xffffffff, true);
          return code;
        }
        if (op === "generate_bytes_result_free")
          new DataView(abi.memory.buffer).setUint32(result, data, true);
        return call(op, ...args);
      });
      expect(() => engine.generateBytes(ctx, tc, 2, 2)).toThrow(/range/);
      expect(spy).toHaveBeenCalledWith("generate_bytes_result_free", 0, result);
      expect(frees).toHaveBeenCalledWith(result, 8, 4);
    });
  });

  it("does not swallow a trapped draw and attempts INVALID completion and handle cleanup", () => {
    const { engine, abi } = wasmFixture();
    const original = abi.call.bind(abi);
    vi.spyOn(abi, "call").mockImplementation((op, ...args) => {
      if (op === "generate_boolean") throw new WebAssembly.RuntimeError("unreachable");
      return original(op, ...args);
    });
    const complete = vi.spyOn(engine, "markComplete"),
      free = vi.spyOn(engine, "freeContext");
    expect(() =>
      createRunner(browserRuntime(engine)).test((tc) => {
        try {
          tc.draw(gs.booleans());
        } catch {
          /* The runner remembers adapter faults. */
        }
      }),
    ).toThrow(/unreachable/);
    expect(complete).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      Status.INVALID,
      null,
    );
    expect(free).toHaveBeenCalledTimes(1);
  });

  it("preserves allocation size/alignment for direct scoped use", () => {
    const { abi } = wasmFixture();
    const free = vi.spyOn(abi, "dealloc");
    let pointer = 0;
    expect(() =>
      WasmArena.scoped(abi, (a) => {
        pointer = a.alloc(16, 8);
        throw new Error("body");
      }),
    ).toThrow("body");
    expect(free).toHaveBeenCalledExactlyOnceWith(pointer, 16, 8);
  });
});
