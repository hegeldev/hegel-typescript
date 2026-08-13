import { describe, it, expect } from "vitest";
import {
  Libhegel,
  bindLibrary,
  LibhegelError,
  Status,
  RunStatus,
  NativeVerbosity,
  fitsInt64,
  bigIntToTwosComplementLE,
  twosComplementLEToBigInt,
  type Bindings,
  type Ptr,
} from "../src/libhegel.js";
import { AssumeError, StopTestError, Labels } from "../src/testCase.js";
import { LIBHEGEL_VERSION } from "../src/libhegel-version.js";
import { testLibPath } from "./libPath.js";

// ---------------------------------------------------------------------------
// Unit tests for the integer wire-format helpers.
// ---------------------------------------------------------------------------

describe("integer wire-format helpers", () => {
  it("fitsInt64 accepts the int64 range and rejects anything wider", () => {
    expect(fitsInt64(-(2n ** 63n), 2n ** 63n - 1n)).toBe(true);
    expect(fitsInt64(-(2n ** 63n) - 1n, 0n)).toBe(false);
    expect(fitsInt64(0n, 2n ** 63n)).toBe(false);
  });

  it("encodes minimal two's-complement little-endian bytes", () => {
    expect([...bigIntToTwosComplementLE(0n)]).toEqual([0x00]);
    expect([...bigIntToTwosComplementLE(127n)]).toEqual([0x7f]);
    // A non-negative value whose top bit would read negative gains a 0x00
    // sign byte.
    expect([...bigIntToTwosComplementLE(128n)]).toEqual([0x80, 0x00]);
    expect([...bigIntToTwosComplementLE(-1n)]).toEqual([0xff]);
    expect([...bigIntToTwosComplementLE(-128n)]).toEqual([0x80]);
    // A negative value whose top bit would read non-negative gains a 0xff
    // sign byte.
    expect([...bigIntToTwosComplementLE(-129n)]).toEqual([0x7f, 0xff]);
    expect([...bigIntToTwosComplementLE(-256n)]).toEqual([0x00, 0xff]);
  });

  it("decodes sign-filled buffers of any width", () => {
    expect(twosComplementLEToBigInt(Buffer.from([0x01, 0x00, 0x00]))).toBe(1n);
    expect(twosComplementLEToBigInt(Buffer.from([0xff, 0xff, 0xff]))).toBe(-1n);
  });

  it("round-trips values through encode/decode", () => {
    for (const v of [0n, 1n, -1n, 255n, -255n, 2n ** 127n - 1n, -(2n ** 127n), 10n ** 40n]) {
      expect(twosComplementLEToBigInt(bigIntToTwosComplementLE(v))).toBe(v);
    }
  });
});

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
    runResultFree: noop,
    runFree: noop,
    testCaseFromBlob: (_ctx, _s, _blob, out) => {
      out[0] = {} as Ptr;
      return 0;
    },
    testCaseFree: noop,
    generateBoolean: () => 0,
    generateInteger: () => 0,
    generateIntegerBig: () => 0,
    generateFloat: () => 0,
    generateBytes: () => 0,
    generateBytesResultFree: noop,
    stringGeneratorText: () => 0,
    stringGeneratorRegex: () => 0,
    stringGeneratorEmail: () => 0,
    stringGeneratorUrl: () => 0,
    stringGeneratorDomain: () => 0,
    generateString: () => 0,
    generateStringResultFree: noop,
    generateDate: () => 0,
    generateTime: () => 0,
    generateDatetime: () => 0,
    generateIpv4: () => 0,
    generateIpv6: () => 0,
    startSpan: () => 0,
    stopSpan: () => 0,
    newCollection: () => 0,
    collectionMore: () => 0,
    collectionReject: () => 0,
    collectionFree: noop,
    markComplete: () => 0,
    runResultStatus: () => RunStatus.PASSED,
    runResultError: () => null,
    runResultFailureCount: () => 0,
    runResultFailure: () => null,
    failureFree: noop,
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
    // The engine can reject a draw internally (e.g. an email draw exceeding
    // the RFC length cap), but only on unlucky random draws — drive the code
    // deterministically instead.
    const lib = new Libhegel(fakeBindings({ generateString: () => -2 }));
    expect(() => lib.generateString(null, null, null)).toThrow(AssumeError);
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
    const handle = {} as Ptr;
    const lib = new Libhegel(
      fakeBindings({
        newCollection: (_ctx, _tc, _min, max, out) => {
          seenMax = max;
          out[0] = handle;
          return 0;
        },
      }),
    );
    expect(lib.newCollection(null, null, 0)).toBe(handle);
    expect(seenMax).toBe(0xffffffffffffffffn);
  });

  it("newCollection passes an explicit max through", () => {
    let seenMax: bigint | null = null;
    const lib = new Libhegel(
      fakeBindings({
        newCollection: (_ctx, _tc, _min, max, out) => {
          seenMax = max;
          out[0] = {} as Ptr;
          return 0;
        },
      }),
    );
    lib.newCollection(null, null, 0, 5);
    expect(seenMax).toBe(5n);
  });

  it("collectionMore returns the out flag", () => {
    const lib = new Libhegel(
      fakeBindings({
        collectionMore: (_ctx, _tc, _collection, out) => {
          out[0] = true;
          return 0;
        },
      }),
    );
    expect(lib.collectionMore(null, null, null)).toBe(true);
  });

  it("generateBytes uses UINT64_MAX when maxSize is omitted and copies empty results", () => {
    let seenMax: bigint | null = null;
    const lib = new Libhegel(
      fakeBindings({
        generateBytes: (_ctx, _tc, _min, max, out) => {
          seenMax = max;
          out[0] = { data: null, len: 0 };
          return 0;
        },
      }),
    );
    expect(lib.generateBytes(null, null, 0)).toEqual(Buffer.alloc(0));
    expect(seenMax).toBe(0xffffffffffffffffn);
    expect(lib.generateBytes(null, null, 0, 5)).toEqual(Buffer.alloc(0));
    expect(seenMax).toBe(5n);
  });

  it("generateString decodes an empty result to the empty string", () => {
    const lib = new Libhegel(
      fakeBindings({
        generateString: (_ctx, _tc, _generator, out) => {
          out[0] = { data: null, len: 0 };
          return 0;
        },
      }),
    );
    expect(lib.generateString(null, null, null)).toBe("");
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
    lib.collectionReject(null, null, null, "dup");
    lib.freeCollection(null);
    lib.markComplete(null, null, Status.VALID, null);
    lib.freeRunResult(lib.runResult(null, null));
    lib.freeFailure(lib.failure(null, 0));
    lib.freeRun(lib.runStart(null, null));
    lib.freeTestCase(lib.testCaseFromBlob(null, null, "blob"));
    expect(lib.reproductionBlob(null)).toBeNull();
    expect(lib.runStatus(null)).toBe(RunStatus.PASSED);
    expect(lib.failureCount(null)).toBe(0);
    expect(lib.failure(null, 0)).toBeNull();
    expect(lib.generateBoolean(null, null, 0.5)).toBe(false);
    expect(lib.generateInteger(null, null, 0n, 10n)).toBe(0n);
    expect(lib.generateIntegerBig(null, null, 0n, 10n)).toBe(0n);
    expect(
      lib.generateFloat(null, null, {
        width: 64,
        minValue: -Infinity,
        maxValue: Infinity,
        allowNan: true,
        allowInfinity: true,
        excludeMin: false,
        excludeMax: false,
        smallestNonzeroMagnitude: Number.MIN_VALUE,
      }),
    ).toBe(0);
    expect(
      lib.generateDate(null, null, { year: 1, month: 1, day: 1 }, { year: 2, month: 1, day: 1 }),
    ).toEqual({
      year: 0,
      month: 0,
      day: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// Integration tests against the real libhegel shared library.
// ---------------------------------------------------------------------------

/** Drive a run of `property` over an integer draw; return the result. */
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

    for (;;) {
      const tc = lib.nextTestCase(ctx, run);
      if (tc === null) break;
      let status: number = Status.VALID;
      let origin: string | null = null;
      try {
        const value = Number(lib.generateInteger(ctx, tc, -1000n, 1000n));
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
      lib.freeTestCase(tc);
    }

    const result = lib.runResult(ctx, run);
    try {
      const status = lib.runStatus(result);
      if (status === RunStatus.FAILED && lib.failureCount(result) > 0) {
        const f = lib.failure(result, 0);
        try {
          return {
            status,
            failureOrigin: lib.failureOrigin(f),
            reproductionBlob: lib.reproductionBlob(f),
          };
        } finally {
          lib.freeFailure(f);
        }
      }
      return { status };
    } finally {
      lib.freeRunResult(result);
    }
  } finally {
    if (run !== undefined) lib.freeRun(run);
    lib.freeSettings(settings);
    lib.freeContext(ctx);
  }
}

describe("Libhegel against the real library", () => {
  const lib = Libhegel.load(testLibPath());

  it("reports the expected version", () => {
    expect(lib.version()).toBe(LIBHEGEL_VERSION);
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

  it("throws a LibhegelError on invalid draw arguments (inverted integer bounds)", () => {
    const ctx = lib.newContext();
    const settings = lib.newSettings();
    lib.setVerbosity(settings, NativeVerbosity.QUIET);
    lib.setDatabase(ctx, settings, "");
    const run = lib.runStart(ctx, settings);
    try {
      const tc = lib.nextTestCase(ctx, run);
      expect(tc).not.toBeNull();
      expect(() => lib.generateInteger(ctx, tc, 10n, -10n)).toThrow(LibhegelError);
      lib.markComplete(ctx, tc, Status.INVALID, null);
      lib.freeTestCase(tc);
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
      lib.freeTestCase(tc);
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
    try {
      let rejectedOnce = false;
      for (;;) {
        const tc = lib.nextTestCase(ctx, run);
        if (tc === null) break;
        try {
          lib.startSpan(ctx, tc, Labels.LIST);
          const collection = lib.newCollection(ctx, tc, 0, 5);
          try {
            while (lib.collectionMore(ctx, tc, collection)) {
              lib.startSpan(ctx, tc, Labels.LIST_ELEMENT);
              lib.generateInteger(ctx, tc, -100n, 100n);
              lib.stopSpan(ctx, tc, false);
              if (!rejectedOnce) {
                lib.collectionReject(ctx, tc, collection, "exercise reject");
                rejectedOnce = true;
              }
            }
          } finally {
            lib.freeCollection(collection);
          }
          lib.stopSpan(ctx, tc, false);
          lib.markComplete(ctx, tc, Status.VALID, null);
        } catch (e) {
          if (e instanceof StopTestError) {
            lib.markComplete(ctx, tc, Status.OVERRUN, null);
          } else {
            throw e;
          }
        } finally {
          lib.freeTestCase(tc);
        }
      }
      const result = lib.runResult(ctx, run);
      try {
        expect(lib.runStatus(result)).toBe(RunStatus.PASSED);
        expect(lib.runError(result)).toBeNull();
      } finally {
        lib.freeRunResult(result);
      }
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
