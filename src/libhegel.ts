/**
 * Thin, typed binding to the native `libhegel` C ABI (see
 * `hegel-rust/hegel-c/include/hegel.h`, version 0.23.0) via {@link koffi}.
 *
 * The {@link Libhegel} class owns the loaded library's function pointers and
 * exposes ergonomic wrappers. Every fallible call takes a `hegel_context_t*`
 * first argument and returns a `hegel_result_t` code (`HEGEL_OK` is zero;
 * negatives are errors), writing any value it produces — a handle, a string, a
 * count — through a trailing out-parameter. The wrappers map those codes to
 * thrown errors ({@link StopTestError} / {@link AssumeError} for the
 * choice-budget / rejected-draw cases, otherwise {@link LibhegelError} carrying
 * the diagnostic from `hegel_context_last_error`) and read the out-parameters
 * back into JS values.
 *
 * libhegel frees nothing for you: every handle from a constructor
 * (`hegel_context_new`, `hegel_settings_new`, `hegel_run_start`,
 * `hegel_test_case_from_blob`) must be released by the caller with its matching
 * free (the runner does so in `finally` blocks). Test cases from
 * `hegel_next_test_case` are borrowed and released by `hegel_run_free`.
 *
 * @packageDocumentation
 */

import { Buffer } from "node:buffer";
import koffi, { type LibraryHandle } from "koffi";
import { StopTestError, AssumeError } from "./testCase.js";

/** Opaque libhegel handle (koffi pointer). `null` signals a failed call. */
export type Ptr = unknown;

/** `hegel_status_t` — outcome of a single test case. */
export const Status = {
  VALID: 0,
  INVALID: 1,
  OVERRUN: 2,
  INTERESTING: 3,
} as const;

/** `hegel_run_status_t` — aggregate outcome of a finished run. */
export const RunStatus = {
  PASSED: 0,
  FAILED: 1,
  ERROR: 2,
} as const;

/** `hegel_verbosity_t`. */
export const NativeVerbosity = {
  QUIET: 0,
  NORMAL: 1,
  VERBOSE: 2,
  DEBUG: 3,
} as const;

/** Relevant `hegel_result_t` codes. */
const RESULT_OK = 0;
const RESULT_STOP_TEST = -1;
const RESULT_ASSUME = -2;

/** An error returned by a fallible libhegel call. */
export class LibhegelError extends Error {
  readonly code: number;
  constructor(message: string, code: number) {
    super(message);
    this.name = "LibhegelError";
    this.code = code;
  }
}

/**
 * The set of C functions bound from the shared library.
 *
 * Fallible calls return the `hegel_result_t` code and write their handle / value
 * through a trailing JS out-array (`[null]`, `[0]`); the infallible-for-our-use
 * accessors (constructors, frees, setters, result getters) are presented here as
 * value-returning wrappers, with the C ABI's `out_*` marshalling and the
 * always-`HEGEL_OK` return code absorbed by {@link bindLibrary}.
 */
export interface Bindings {
  contextNew: () => Ptr;
  contextFree: (ctx: Ptr) => void;
  contextLastError: (ctx: Ptr) => string | null;

  settingsNew: () => Ptr;
  settingsFree: (s: Ptr) => void;
  settingsTestCases: (s: Ptr, n: number) => void;
  settingsVerbosity: (s: Ptr, v: number) => void;
  settingsSeed: (s: Ptr, seed: bigint, hasSeed: boolean) => void;
  settingsDerandomize: (s: Ptr, on: boolean) => void;
  settingsDatabase: (ctx: Ptr, s: Ptr, db: string | null) => void;
  settingsDatabaseKey: (ctx: Ptr, s: Ptr, key: string | null) => void;
  settingsSuppressHealthCheck: (s: Ptr, checks: number) => void;
  settingsReportMultipleFailures: (s: Ptr, yes: boolean) => void;

  runStart: (ctx: Ptr, settings: Ptr, out: Ptr[]) => number;
  nextTestCase: (ctx: Ptr, run: Ptr, out: Ptr[]) => number;
  runResult: (ctx: Ptr, run: Ptr, out: Ptr[]) => number;
  runFree: (run: Ptr) => void;

  testCaseFromBlob: (ctx: Ptr, s: Ptr, blob: string | null, out: Ptr[]) => number;
  testCaseFree: (tc: Ptr) => void;

  generate: (
    ctx: Ptr,
    tc: Ptr,
    schema: Buffer,
    schemaLen: number,
    out: Ptr[],
    outLen: (number | bigint)[],
  ) => number;
  startSpan: (ctx: Ptr, tc: Ptr, label: number) => number;
  stopSpan: (ctx: Ptr, tc: Ptr, discard: boolean) => number;
  newCollection: (ctx: Ptr, tc: Ptr, min: number, max: bigint, out: (number | bigint)[]) => number;
  collectionMore: (ctx: Ptr, tc: Ptr, id: bigint, out: boolean[]) => number;
  collectionReject: (ctx: Ptr, tc: Ptr, id: bigint, why: string | null) => number;
  markComplete: (ctx: Ptr, tc: Ptr, status: number, origin: string | null) => number;

  runResultStatus: (r: Ptr) => number;
  runResultError: (r: Ptr) => string | null;
  runResultFailureCount: (r: Ptr) => number;
  runResultFailure: (r: Ptr, index: number) => Ptr;
  failureOrigin: (f: Ptr) => string | null;
  failureReproductionBlob: (f: Ptr) => string | null;

  version: () => string;
}

/**
 * Bind every libhegel function used by the client against a loaded koffi
 * library handle.
 *
 * Calls that cannot fail for the inputs the client gives them (constructors,
 * frees, setters, result getters) pass a NULL context — which the ABI accepts,
 * simply opting out of error messages — and discard the result code here; the
 * genuinely fallible calls return the code for {@link Libhegel} to map to an
 * exception.
 */
export function bindLibrary(lib: LibraryHandle): Bindings {
  // The koffi FFI boundary is inherently dynamically typed; `Bindings` re-imposes
  // static types on the wrappers below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const f = (proto: string): ((...args: any[]) => any) => lib.func(proto);
  const contextNew = f("void* hegel_context_new()");
  const contextFree = f("void hegel_context_free(void* ctx)");
  const contextLastError = f("const char* hegel_context_last_error(void* ctx)");

  const settingsNew = f("int hegel_settings_new(void* ctx, _Out_ void** out)");
  const settingsFree = f("void hegel_settings_free(void* ctx, void* s)");
  const settingsTestCases = f("int hegel_settings_set_test_cases(void* ctx, void* s, uint64_t n)");
  const settingsVerbosity = f("int hegel_settings_set_verbosity(void* ctx, void* s, int v)");
  const settingsSeed = f(
    "int hegel_settings_set_seed(void* ctx, void* s, uint64_t seed, bool has_seed)",
  );
  const settingsDerandomize = f("int hegel_settings_set_derandomize(void* ctx, void* s, bool d)");
  const settingsDatabase = f("int hegel_settings_set_database(void* ctx, void* s, const char* db)");
  const settingsDatabaseKey = f(
    "int hegel_settings_set_database_key(void* ctx, void* s, const char* key)",
  );
  const settingsSuppressHealthCheck = f(
    "int hegel_settings_set_suppress_health_check(void* ctx, void* s, uint32_t checks)",
  );
  const settingsReportMultipleFailures = f(
    "int hegel_settings_set_report_multiple_failures(void* ctx, void* s, bool yes)",
  );

  const runStart = f("int hegel_run_start(void* ctx, void* settings, _Out_ void** out_run)");
  const nextTestCase = f("int hegel_next_test_case(void* ctx, void* run, _Out_ void** out_tc)");
  const runResult = f("int hegel_run_result(void* ctx, void* run, _Out_ void** out_result)");
  const runFree = f("void hegel_run_free(void* ctx, void* run)");

  const testCaseFromBlob = f(
    "int hegel_test_case_from_blob(void* ctx, void* s, const char* blob, _Out_ void** out_tc)",
  );
  const testCaseFree = f("void hegel_test_case_free(void* ctx, void* tc)");

  const generate = f(
    "int hegel_generate(void* ctx, void* tc, uint8_t* schema, size_t schema_len, _Out_ void** out, _Out_ size_t* out_len)",
  );
  const startSpan = f("int hegel_start_span(void* ctx, void* tc, uint64_t label)");
  const stopSpan = f("int hegel_stop_span(void* ctx, void* tc, bool discard)");
  const newCollection = f(
    "int hegel_new_collection(void* ctx, void* tc, uint64_t min, uint64_t max, _Out_ int64_t* out)",
  );
  const collectionMore = f(
    "int hegel_collection_more(void* ctx, void* tc, int64_t id, _Out_ bool* out)",
  );
  const collectionReject = f(
    "int hegel_collection_reject(void* ctx, void* tc, int64_t id, const char* why)",
  );
  const markComplete = f(
    "int hegel_mark_complete(void* ctx, void* tc, int status, const char* origin)",
  );

  const runResultStatus = f("int hegel_run_result_status(void* ctx, void* r, _Out_ int* out)");
  const runResultError = f("int hegel_run_result_error(void* ctx, void* r, _Out_ char** out)");
  const runResultFailureCount = f(
    "int hegel_run_result_failure_count(void* ctx, void* r, _Out_ size_t* out)",
  );
  const runResultFailure = f(
    "int hegel_run_result_failure(void* ctx, void* r, size_t index, _Out_ void** out)",
  );
  const failureOrigin = f("int hegel_failure_origin(void* ctx, void* f, _Out_ char** out)");
  const failureReproductionBlob = f(
    "int hegel_failure_reproduction_blob(void* ctx, void* f, _Out_ char** out)",
  );
  const version = f("int hegel_version(void* ctx, _Out_ char** out)");

  return {
    contextNew: () => contextNew(),
    contextFree: (ctx) => contextFree(ctx),
    contextLastError: (ctx) => contextLastError(ctx),
    settingsNew: () => {
      const out: Ptr[] = [null];
      settingsNew(null, out);
      return out[0];
    },
    settingsFree: (s) => settingsFree(null, s),
    settingsTestCases: (s, n) => void settingsTestCases(null, s, n),
    settingsVerbosity: (s, v) => void settingsVerbosity(null, s, v),
    settingsSeed: (s, seed, hasSeed) => void settingsSeed(null, s, seed, hasSeed),
    settingsDerandomize: (s, on) => void settingsDerandomize(null, s, on),
    settingsDatabase: (ctx, s, db) => void settingsDatabase(ctx, s, db),
    settingsDatabaseKey: (ctx, s, key) => void settingsDatabaseKey(ctx, s, key),
    settingsSuppressHealthCheck: (s, checks) => void settingsSuppressHealthCheck(null, s, checks),
    settingsReportMultipleFailures: (s, yes) => void settingsReportMultipleFailures(null, s, yes),
    runStart: (ctx, s, out) => runStart(ctx, s, out),
    nextTestCase: (ctx, run, out) => nextTestCase(ctx, run, out),
    runResult: (ctx, run, out) => runResult(ctx, run, out),
    runFree: (run) => runFree(null, run),
    testCaseFromBlob: (ctx, s, blob, out) => testCaseFromBlob(ctx, s, blob, out),
    testCaseFree: (tc) => testCaseFree(null, tc),
    generate: (ctx, tc, schema, schemaLen, out, outLen) =>
      generate(ctx, tc, schema, schemaLen, out, outLen),
    startSpan: (ctx, tc, label) => startSpan(ctx, tc, label),
    stopSpan: (ctx, tc, discard) => stopSpan(ctx, tc, discard),
    newCollection: (ctx, tc, min, max, out) => newCollection(ctx, tc, min, max, out),
    collectionMore: (ctx, tc, id, out) => collectionMore(ctx, tc, id, out),
    collectionReject: (ctx, tc, id, why) => collectionReject(ctx, tc, id, why),
    markComplete: (ctx, tc, status, origin) => markComplete(ctx, tc, status, origin),
    runResultStatus: (r) => {
      const out: number[] = [0];
      runResultStatus(null, r, out);
      return out[0];
    },
    runResultError: (r) => {
      const out: (string | null)[] = [null];
      runResultError(null, r, out);
      return out[0];
    },
    runResultFailureCount: (r) => {
      const out: (number | bigint)[] = [0];
      runResultFailureCount(null, r, out);
      return Number(out[0]);
    },
    runResultFailure: (r, index) => {
      const out: Ptr[] = [null];
      runResultFailure(null, r, index, out);
      return out[0];
    },
    failureOrigin: (fp) => {
      const out: (string | null)[] = [null];
      failureOrigin(null, fp, out);
      return out[0];
    },
    failureReproductionBlob: (fp) => {
      const out: (string | null)[] = [null];
      failureReproductionBlob(null, fp, out);
      return out[0];
    },
    version: () => {
      // `hegel_version` always writes a non-null static string (it only fails on
      // a NULL out-pointer, which we never pass), so the seeded "" is never read.
      const out: string[] = [""];
      version(null, out);
      return out[0];
    },
  };
}

const UINT64_MAX = 0xffffffffffffffffn;

/**
 * High-level wrapper over the libhegel C ABI.
 */
export class Libhegel {
  private readonly fns: Bindings;

  constructor(fns: Bindings) {
    this.fns = fns;
  }

  /** Load libhegel from a shared-library path. */
  static load(path: string): Libhegel {
    return new Libhegel(bindLibrary(koffi.load(path)));
  }

  version(): string {
    return this.fns.version();
  }

  newContext(): Ptr {
    return this.fns.contextNew();
  }

  freeContext(ctx: Ptr): void {
    this.fns.contextFree(ctx);
  }

  lastError(ctx: Ptr): string {
    return this.fns.contextLastError(ctx) ?? "";
  }

  newSettings(): Ptr {
    return this.fns.settingsNew();
  }

  freeSettings(s: Ptr): void {
    this.fns.settingsFree(s);
  }

  setTestCases(s: Ptr, n: number): void {
    this.fns.settingsTestCases(s, n);
  }

  setVerbosity(s: Ptr, v: number): void {
    this.fns.settingsVerbosity(s, v);
  }

  setSeed(s: Ptr, seed: bigint): void {
    this.fns.settingsSeed(s, seed, true);
  }

  setDerandomize(s: Ptr, on: boolean): void {
    this.fns.settingsDerandomize(s, on);
  }

  setDatabase(ctx: Ptr, s: Ptr, db: string | null): void {
    this.fns.settingsDatabase(ctx, s, db);
  }

  setDatabaseKey(ctx: Ptr, s: Ptr, key: string): void {
    this.fns.settingsDatabaseKey(ctx, s, key);
  }

  setSuppressHealthCheck(s: Ptr, checks: number): void {
    this.fns.settingsSuppressHealthCheck(s, checks);
  }

  setReportMultipleFailures(s: Ptr, yes: boolean): void {
    this.fns.settingsReportMultipleFailures(s, yes);
  }

  /** Start a run. Throws {@link LibhegelError} on failure. */
  runStart(ctx: Ptr, settings: Ptr): Ptr {
    const out: Ptr[] = [null];
    this.check(ctx, this.fns.runStart(ctx, settings, out), "hegel_run_start");
    return out[0];
  }

  /**
   * Pull the next test case, or `null` when the run is finished. Throws if the
   * engine reported a mid-run error (e.g. the previous case was not completed).
   */
  nextTestCase(ctx: Ptr, run: Ptr): Ptr | null {
    const out: Ptr[] = [null];
    this.check(ctx, this.fns.nextTestCase(ctx, run, out), "hegel_next_test_case");
    return out[0] ?? null;
  }

  /** Read the aggregated run result. Throws on failure. */
  runResult(ctx: Ptr, run: Ptr): Ptr {
    const out: Ptr[] = [null];
    this.check(ctx, this.fns.runResult(ctx, run, out), "hegel_run_result");
    return out[0];
  }

  freeRun(run: Ptr): void {
    this.fns.runFree(run);
  }

  /**
   * Build a standalone test case that replays a base64 failure blob (from
   * {@link reproductionBlob}). Owned by the caller — release with
   * {@link freeTestCase}. Throws {@link LibhegelError} on a malformed blob.
   */
  testCaseFromBlob(ctx: Ptr, settings: Ptr, blob: string | null): Ptr {
    const out: Ptr[] = [null];
    this.check(
      ctx,
      this.fns.testCaseFromBlob(ctx, settings, blob, out),
      "hegel_test_case_from_blob",
    );
    return out[0];
  }

  freeTestCase(tc: Ptr): void {
    this.fns.testCaseFree(tc);
  }

  /**
   * Map a fallible `int`-returning result code to an exception.
   * `HEGEL_E_STOP_TEST` becomes {@link StopTestError}, `HEGEL_E_ASSUME` becomes
   * {@link AssumeError}; any other non-OK code becomes a {@link LibhegelError}
   * carrying the context diagnostic.
   */
  private check(ctx: Ptr, code: number, op: string): void {
    if (code === RESULT_OK) {
      return;
    }
    if (code === RESULT_STOP_TEST) {
      throw new StopTestError();
    }
    if (code === RESULT_ASSUME) {
      // The engine rejected this draw (e.g. a format generator's internal
      // precondition failed); discard the test case like a failed assume().
      throw new AssumeError();
    }
    throw new LibhegelError(`${op} failed: ${this.lastError(ctx)}`, code);
  }

  /** Draw a CBOR value for the given CBOR-encoded schema. */
  generate(ctx: Ptr, tc: Ptr, schema: Buffer): Buffer {
    const out: Ptr[] = [null];
    const outLen: (number | bigint)[] = [0];
    const code = this.fns.generate(ctx, tc, schema, schema.length, out, outLen);
    this.check(ctx, code, "hegel_generate");
    const len = Number(outLen[0]);
    return Buffer.from(koffi.decode(out[0], "uint8_t", len) as number[]);
  }

  startSpan(ctx: Ptr, tc: Ptr, label: number): void {
    this.check(ctx, this.fns.startSpan(ctx, tc, label), "hegel_start_span");
  }

  stopSpan(ctx: Ptr, tc: Ptr, discard: boolean): void {
    this.check(ctx, this.fns.stopSpan(ctx, tc, discard), "hegel_stop_span");
  }

  newCollection(ctx: Ptr, tc: Ptr, min: number, max?: number): bigint {
    const out: (number | bigint)[] = [0];
    const maxArg = max === undefined ? UINT64_MAX : BigInt(max);
    this.check(ctx, this.fns.newCollection(ctx, tc, min, maxArg, out), "hegel_new_collection");
    return BigInt(out[0]);
  }

  collectionMore(ctx: Ptr, tc: Ptr, id: bigint): boolean {
    const out: boolean[] = [false];
    this.check(ctx, this.fns.collectionMore(ctx, tc, id, out), "hegel_collection_more");
    return out[0];
  }

  collectionReject(ctx: Ptr, tc: Ptr, id: bigint, why: string | null): void {
    this.check(ctx, this.fns.collectionReject(ctx, tc, id, why), "hegel_collection_reject");
  }

  markComplete(ctx: Ptr, tc: Ptr, status: number, origin: string | null): void {
    this.check(ctx, this.fns.markComplete(ctx, tc, status, origin), "hegel_mark_complete");
  }

  runStatus(r: Ptr): number {
    return this.fns.runResultStatus(r);
  }

  runError(r: Ptr): string | null {
    return this.fns.runResultError(r);
  }

  failureCount(r: Ptr): number {
    return this.fns.runResultFailureCount(r);
  }

  failure(r: Ptr, index: number): Ptr {
    return this.fns.runResultFailure(r, index);
  }

  failureOrigin(fp: Ptr): string {
    return this.fns.failureOrigin(fp) ?? "";
  }

  /**
   * The failure's base64 reproduce blob, or `null` if the engine produced none.
   * Replay it via {@link testCaseFromBlob} to surface the test's own error.
   */
  reproductionBlob(fp: Ptr): string | null {
    return this.fns.failureReproductionBlob(fp);
  }
}
