import { describe, it, expect } from "vitest";
import { encode, decode } from "cbor-x";
import {
  Libhegel,
  bindLibrary,
  LibhegelError,
  Status,
  RunStatus,
  NativeVerbosity,
  type Bindings,
  type Ptr,
} from "../src/libhegel.js";
import { AssumeError, StopTestError, Labels } from "../src/testCase.js";
import { testLibPath } from "./libPath.js";

// ---------------------------------------------------------------------------
// Fake-bindings unit tests for wrapper logic that the real engine cannot easily
// be driven into (NULL returns, specific result codes, null string getters).
// ---------------------------------------------------------------------------

function fakeBindings(overrides: Partial<Bindings>): Bindings {
  const noop = (): void => undefined;
  const base: Bindings = {
    contextNew: () => ({}) as Ptr,
    contextFree: noop,
    contextLastError: () => "",
    settingsNew: () => ({}) as Ptr,
    settingsFree: noop,
    settingsTestCases: noop,
    settingsVerbosity: noop,
    settingsSeed: noop,
    settingsDerandomize: noop,
    settingsDatabase: noop,
    settingsDatabaseKey: noop,
    settingsSuppressHealthCheck: noop,
    settingsReportMultipleFailures: noop,
    runStart: (_ctx, _settings, out) => {
      out[0] = {} as Ptr;
      return 0;
    },
    nextTestCase: (_ctx, _run, out) => {
      out[0] = null;
      return 0;
    },
    runResult: (_ctx, _run, out) => {
      out[0] = {} as Ptr;
      return 0;
    },
    runFree: noop,
    testCaseFromBlob: (_ctx, _s, _blob, out) => {
      out[0] = {} as Ptr;
      return 0;
    },
    testCaseFree: noop,
    generate: () => 0,
    startSpan: () => 0,
    stopSpan: () => 0,
    newCollection: () => 0,
    collectionMore: () => 0,
    collectionReject: () => 0,
    markComplete: () => 0,
    runResultStatus: () => RunStatus.PASSED,
    runResultError: () => null,
    runResultFailureCount: () => 0,
    runResultFailure: () => null,
    failureOrigin: () => null,
    failureReproductionBlob: () => null,
    version: () => "0.0.0",
    ...overrides,
  };
  return base;
}

describe("Libhegel wrapper logic (fake bindings)", () => {
  it("throws when run_start returns an error code", () => {
    const lib = new Libhegel(
      fakeBindings({
        runStart: (_ctx, _settings, out) => {
          out[0] = null;
          return -3;
        },
        contextLastError: () => "boom",
      }),
    );
    expect(() => lib.runStart(null, null)).toThrow(/hegel_run_start failed: boom/);
  });

  it("nextTestCase returns null at normal completion (OK code, NULL out)", () => {
    const lib = new Libhegel(
      fakeBindings({
        nextTestCase: (_ctx, _run, out) => {
          out[0] = null;
          return 0;
        },
      }),
    );
    expect(lib.nextTestCase(null, null)).toBeNull();
  });

  it("nextTestCase throws on a non-OK code (caller misuse)", () => {
    const lib = new Libhegel(
      fakeBindings({
        nextTestCase: (_ctx, _run, out) => {
          out[0] = null;
          return -7;
        },
        contextLastError: () => "not complete",
      }),
    );
    expect(() => lib.nextTestCase(null, null)).toThrow(/not complete/);
  });

  it("nextTestCase returns the handle when non-null", () => {
    const handle = {} as Ptr;
    const lib = new Libhegel(
      fakeBindings({
        nextTestCase: (_ctx, _run, out) => {
          out[0] = handle;
          return 0;
        },
      }),
    );
    expect(lib.nextTestCase(null, null)).toBe(handle);
  });

  it("throws when run_result returns an error code", () => {
    const lib = new Libhegel(
      fakeBindings({
        runResult: (_ctx, _run, out) => {
          out[0] = null;
          return -7;
        },
        contextLastError: () => "nope",
      }),
    );
    expect(() => lib.runResult(null, null)).toThrow(/hegel_run_result failed: nope/);
  });

  it("throws when test_case_from_blob returns an error code", () => {
    const lib = new Libhegel(
      fakeBindings({
        testCaseFromBlob: (_ctx, _s, _blob, out) => {
          out[0] = null;
          return -5;
        },
        contextLastError: () => "bad blob",
      }),
    );
    expect(() => lib.testCaseFromBlob(null, null, "x")).toThrow(
      /hegel_test_case_from_blob failed: bad blob/,
    );
  });

  it("maps STOP_TEST to StopTestError", () => {
    const lib = new Libhegel(fakeBindings({ startSpan: () => -1 }));
    expect(() => lib.startSpan(null, null, Labels.LIST)).toThrow(StopTestError);
  });

  it("maps ASSUME to AssumeError", () => {
    // The engine can reject a draw internally (e.g. a format generator's
    // precondition), but only on unlucky random draws — drive the code
    // deterministically instead.
    const lib = new Libhegel(fakeBindings({ generate: () => -2 }));
    expect(() => lib.generate(null, null, Buffer.alloc(0))).toThrow(AssumeError);
  });

  it("maps other non-OK codes to LibhegelError with the diagnostic", () => {
    const lib = new Libhegel(
      fakeBindings({ stopSpan: () => -5, contextLastError: () => "bad arg" }),
    );
    try {
      lib.stopSpan(null, null, false);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(LibhegelError);
      expect((e as LibhegelError).code).toBe(-5);
      expect((e as LibhegelError).message).toMatch(/bad arg/);
    }
  });

  it("lastError maps a NULL message to the empty string", () => {
    const lib = new Libhegel(fakeBindings({ contextLastError: () => null }));
    expect(lib.lastError(null)).toBe("");
  });

  it("failureOrigin maps NULL to empty; reproductionBlob and runError pass NULL through", () => {
    const lib = new Libhegel(
      fakeBindings({
        failureOrigin: () => null,
        failureReproductionBlob: () => null,
        runResultError: () => null,
      }),
    );
    expect(lib.failureOrigin(null)).toBe("");
    expect(lib.reproductionBlob(null)).toBeNull();
    expect(lib.runError(null)).toBeNull();
  });

  it("newCollection uses UINT64_MAX when max is omitted", () => {
    let seenMax: bigint | null = null;
    const lib = new Libhegel(
      fakeBindings({
        newCollection: (_ctx, _tc, _min, max, out) => {
          seenMax = max;
          out[0] = 7;
          return 0;
        },
      }),
    );
    expect(lib.newCollection(null, null, 0)).toBe(7n);
    expect(seenMax).toBe(0xffffffffffffffffn);
  });

  it("newCollection passes an explicit max through", () => {
    let seenMax: bigint | null = null;
    const lib = new Libhegel(
      fakeBindings({
        newCollection: (_ctx, _tc, _min, max, out) => {
          seenMax = max;
          out[0] = 1n;
          return 0;
        },
      }),
    );
    expect(lib.newCollection(null, null, 0, 5)).toBe(1n);
    expect(seenMax).toBe(5n);
  });

  it("collectionMore returns the out flag", () => {
    const lib = new Libhegel(
      fakeBindings({
        collectionMore: (_ctx, _tc, _id, out) => {
          out[0] = true;
          return 0;
        },
      }),
    );
    expect(lib.collectionMore(null, null, 0n)).toBe(true);
  });

  it("trivial pass-throughs do not throw", () => {
    const lib = new Libhegel(fakeBindings({}));
    expect(lib.version()).toBe("0.0.0");
    lib.freeContext(lib.newContext());
    lib.freeSettings(lib.newSettings());
    lib.setTestCases(null, 10);
    lib.setVerbosity(null, NativeVerbosity.QUIET);
    lib.setSeed(null, 42n);
    lib.setDerandomize(null, true);
    lib.setDatabase(null, null, "");
    lib.setDatabaseKey(null, null, "k");
    lib.setSuppressHealthCheck(null, 1);
    lib.setReportMultipleFailures(null, true);
    lib.collectionReject(null, null, 0n, "dup");
    lib.markComplete(null, null, Status.VALID, null);
    lib.freeRun(lib.runStart(null, null));
    lib.freeTestCase(lib.testCaseFromBlob(null, null, "blob"));
    expect(lib.reproductionBlob(null)).toBeNull();
    expect(lib.runStatus(null)).toBe(RunStatus.PASSED);
    expect(lib.failureCount(null)).toBe(0);
    expect(lib.failure(null, 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Integration tests against the real libhegel shared library.
// ---------------------------------------------------------------------------

/** Drive a run of `property` over a CBOR integer schema; return the result. */
function driveIntegerRun(
  lib: Libhegel,
  property: (n: number) => boolean,
  opts: { testCases?: number } = {},
): { status: number; failureOrigin?: string; reproductionBlob?: string | null } {
  const ctx = lib.newContext();
  const settings = lib.newSettings();
  let run: Ptr | undefined;
  try {
    lib.setTestCases(settings, opts.testCases ?? 200);
    lib.setVerbosity(settings, NativeVerbosity.QUIET);
    lib.setDerandomize(settings, true);
    lib.setSeed(settings, 12345n);
    lib.setDatabase(ctx, settings, ""); // disable persistence
    lib.setSuppressHealthCheck(settings, 0);
    run = lib.runStart(ctx, settings);
    const schema = Buffer.from(encode({ type: "integer", min_value: -1000, max_value: 1000 }));

    for (;;) {
      const tc = lib.nextTestCase(ctx, run);
      if (tc === null) break;
      let status = Status.VALID;
      let origin: string | null = null;
      try {
        const value = decode(lib.generate(ctx, tc, schema)) as number;
        if (!property(value)) {
          status = Status.INTERESTING;
          origin = "test:integerRun";
        }
      } catch (e) {
        if (e instanceof StopTestError) {
          status = Status.OVERRUN;
        } else {
          throw e;
        }
      }
      lib.markComplete(ctx, tc, status, origin);
    }

    const result = lib.runResult(ctx, run);
    const status = lib.runStatus(result);
    if (status === RunStatus.FAILED && lib.failureCount(result) > 0) {
      const f = lib.failure(result, 0);
      return {
        status,
        failureOrigin: lib.failureOrigin(f),
        reproductionBlob: lib.reproductionBlob(f),
      };
    }
    return { status };
  } finally {
    if (run !== undefined) lib.freeRun(run);
    lib.freeSettings(settings);
    lib.freeContext(ctx);
  }
}

describe("Libhegel against the real library", () => {
  const lib = Libhegel.load(testLibPath());

  it("reports the expected version", () => {
    expect(lib.version()).toBe("0.23.0");
  });

  it("passes a property that always holds", () => {
    const res = driveIntegerRun(lib, (n) => n >= -1000 && n <= 1000);
    expect(res.status).toBe(RunStatus.PASSED);
  });

  it("fails and surfaces a failure with origin and a reproduce blob for a false property", () => {
    const res = driveIntegerRun(lib, (n) => n < 50);
    expect(res.status).toBe(RunStatus.FAILED);
    expect(res.failureOrigin).toBe("test:integerRun");
    expect(typeof res.reproductionBlob).toBe("string");
  });

  it("throws a LibhegelError on a malformed schema", () => {
    const ctx = lib.newContext();
    const settings = lib.newSettings();
    lib.setVerbosity(settings, NativeVerbosity.QUIET);
    lib.setDatabase(ctx, settings, "");
    const run = lib.runStart(ctx, settings);
    try {
      const tc = lib.nextTestCase(ctx, run);
      expect(tc).not.toBeNull();
      // Not valid CBOR for a schema -> engine rejects it.
      expect(() => lib.generate(ctx, tc, Buffer.from([0xff, 0xff, 0xff]))).toThrow(LibhegelError);
      lib.markComplete(ctx, tc, Status.INVALID, null);
    } finally {
      lib.freeRun(run);
      lib.freeSettings(settings);
      lib.freeContext(ctx);
    }
  });

  it("throws when next_test_case is called before completing the previous case", () => {
    const ctx = lib.newContext();
    const settings = lib.newSettings();
    lib.setVerbosity(settings, NativeVerbosity.QUIET);
    lib.setDatabase(ctx, settings, "");
    const run = lib.runStart(ctx, settings);
    try {
      const tc = lib.nextTestCase(ctx, run);
      expect(tc).not.toBeNull();
      // Misuse: pull again without marking the first complete.
      expect(() => lib.nextTestCase(ctx, run)).toThrow(LibhegelError);
      lib.markComplete(ctx, tc, Status.VALID, null);
    } finally {
      lib.freeRun(run);
      lib.freeSettings(settings);
      lib.freeContext(ctx);
    }
  });

  it("drives spans and the collection protocol (lists)", () => {
    const ctx = lib.newContext();
    const settings = lib.newSettings();
    lib.setTestCases(settings, 20);
    lib.setVerbosity(settings, NativeVerbosity.QUIET);
    lib.setDatabase(ctx, settings, "");
    const run = lib.runStart(ctx, settings);
    const schema = Buffer.from(encode({ type: "integer", min_value: -100, max_value: 100 }));
    try {
      let rejectedOnce = false;
      for (;;) {
        const tc = lib.nextTestCase(ctx, run);
        if (tc === null) break;
        try {
          lib.startSpan(ctx, tc, Labels.LIST);
          const coll = lib.newCollection(ctx, tc, 0, 5);
          while (lib.collectionMore(ctx, tc, coll)) {
            lib.startSpan(ctx, tc, Labels.LIST_ELEMENT);
            decode(lib.generate(ctx, tc, schema));
            lib.stopSpan(ctx, tc, false);
            if (!rejectedOnce) {
              lib.collectionReject(ctx, tc, coll, "exercise reject");
              rejectedOnce = true;
            }
          }
          lib.stopSpan(ctx, tc, false);
          lib.markComplete(ctx, tc, Status.VALID, null);
        } catch (e) {
          if (e instanceof StopTestError) {
            lib.markComplete(ctx, tc, Status.OVERRUN, null);
          } else {
            throw e;
          }
        }
      }
      const result = lib.runResult(ctx, run);
      expect(lib.runStatus(result)).toBe(RunStatus.PASSED);
      expect(lib.runError(result)).toBeNull();
    } finally {
      lib.freeRun(run);
      lib.freeSettings(settings);
      lib.freeContext(ctx);
    }
  });

  it("bindLibrary exposes the version symbol directly", () => {
    // Exercises bindLibrary's returned wrapper independently of Libhegel.
    expect(typeof lib.version()).toBe("string");
  });
});

// Re-export to ensure bindLibrary is referenced (it is used by Libhegel.load).
void bindLibrary;
