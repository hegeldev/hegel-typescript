/**
 * Thin, typed binding to the native `libhegel` C ABI (see
 * `hegel-rust/hegel-c/include/hegel.h`, version 0.36.1) via {@link koffi}.
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
 * libhegel frees nothing for you: every handle written back by the ABI is
 * caller-owned and must be released with its matching free. That covers the
 * constructors (`hegel_context_new`, `hegel_settings_new`, `hegel_run_start`,
 * `hegel_test_case_from_blob`) and — new in this ABI — every test case from
 * `hegel_next_test_case`, the run result from `hegel_run_result`, each failure
 * from `hegel_run_result_failure`, and each collection from
 * `hegel_new_collection` (the runner releases them all in `finally` blocks).
 * String generators (`hegel_string_generator_*`) are the one deliberate
 * exception: they are immutable, shareable and cached per schema for the life
 * of the process (see `generate.ts`), so their free is never called and is not
 * bound here.
 *
 * @packageDocumentation
 */

import { Buffer } from "node:buffer";
import koffi, { type TypeObject, type LibraryHandle } from "koffi";
import { StopTestError, AssumeError } from "./testCase.js";
import { wtf8ToString } from "./wtf8.js";

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

/** A `hegel_date_t`: a proleptic Gregorian calendar date. */
export interface NativeDate {
  year: number;
  month: number;
  day: number;
}

/** A `hegel_time_t`: a time of day with nanosecond precision. */
export interface NativeTime {
  hour: number;
  minute: number;
  second: number;
  nanosecond: number;
}

/** A `hegel_datetime_t`: a naive datetime (no timezone). */
export interface NativeDatetime {
  date: NativeDate;
  time: NativeTime;
}

/**
 * A `hegel_generate_bytes_result_t` / `hegel_generate_string_result_t` as
 * koffi decodes it: an engine-owned buffer pointer plus its byte length.
 */
export interface NativeBuffer {
  data: Ptr;
  len: number | bigint;
}

/** Options for `hegel_string_generator_text` (see {@link Bindings}). */
export interface TextGeneratorOptions {
  minSize: number;
  maxSize: bigint;
  codec: string | null;
  minCodepoint: number;
  maxCodepoint: number;
  categories: readonly string[] | null;
  excludeCategories: readonly string[] | null;
  includeCharacters: Buffer | null;
  excludeCharacters: Buffer | null;
}

/** Options for `hegel_generate_float` (see {@link Bindings}). */
export interface NativeFloatOptions {
  width: number;
  minValue: number;
  maxValue: number;
  allowNan: boolean;
  allowInfinity: boolean;
  excludeMin: boolean;
  excludeMax: boolean;
  smallestNonzeroMagnitude: number;
}

// koffi type objects for the ABI's by-value structs. Deliberately anonymous:
// koffi's named-type registry is global and persists across module reloads
// (e.g. between test files in one worker), so registering a name twice throws.
const dateType: TypeObject = koffi.struct({
  year: "int32_t",
  month: "uint8_t",
  day: "uint8_t",
});
const timeType: TypeObject = koffi.struct({
  hour: "uint8_t",
  minute: "uint8_t",
  second: "uint8_t",
  nanosecond: "uint32_t",
});
const datetimeType: TypeObject = koffi.struct({ date: dateType, time: timeType });
// Both *_result_t structs are {pointer, len}. `data` is bound as uint8_t*
// rather than char* so koffi hands back the raw pointer (the buffers are not
// NUL-terminated and may contain interior NULs).
const bufferResultType: TypeObject = koffi.struct({ data: "uint8_t*", len: "size_t" });

/**
 * The set of C functions bound from the shared library.
 *
 * Fallible calls return the `hegel_result_t` code and write their handle / value
 * through a trailing JS out-array (`[null]`, `[0]`); the infallible-for-our-use
 * accessors (constructors, frees, setters, result getters) are presented here as
 * value-returning wrappers, with the C ABI's `out_*` marshalling and the
 * always-`HEGEL_OK` return code absorbed by {@link bindLibrary}. The output
 * callback taken by `hegel_run_start` / `hegel_test_case_from_blob` is likewise
 * absorbed as NULL (engine output stays on stderr).
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
  runResultFree: (r: Ptr) => void;
  runFree: (run: Ptr) => void;

  testCaseFromBlob: (ctx: Ptr, s: Ptr, blob: string | null, out: Ptr[]) => number;
  testCaseFree: (tc: Ptr) => void;

  generateBoolean: (ctx: Ptr, tc: Ptr, p: number, out: boolean[]) => number;
  generateInteger: (
    ctx: Ptr,
    tc: Ptr,
    min: bigint,
    max: bigint,
    out: (number | bigint)[],
  ) => number;
  generateIntegerBig: (
    ctx: Ptr,
    tc: Ptr,
    min: Buffer,
    max: Buffer,
    outValue: Buffer,
    outLen: (number | bigint)[],
  ) => number;
  generateFloat: (ctx: Ptr, tc: Ptr, opts: NativeFloatOptions, out: number[]) => number;
  generateBytes: (ctx: Ptr, tc: Ptr, min: bigint, max: bigint, out: NativeBuffer[]) => number;
  generateBytesResultFree: (result: NativeBuffer) => void;

  stringGeneratorText: (ctx: Ptr, opts: TextGeneratorOptions, out: Ptr[]) => number;
  stringGeneratorRegex: (ctx: Ptr, pattern: string, fullmatch: boolean, out: Ptr[]) => number;
  stringGeneratorEmail: (ctx: Ptr, out: Ptr[]) => number;
  stringGeneratorUrl: (ctx: Ptr, out: Ptr[]) => number;
  stringGeneratorDomain: (ctx: Ptr, maxLength: number, out: Ptr[]) => number;
  generateString: (ctx: Ptr, tc: Ptr, generator: Ptr, out: NativeBuffer[]) => number;
  generateStringResultFree: (result: NativeBuffer) => void;

  generateDate: (ctx: Ptr, tc: Ptr, min: NativeDate, max: NativeDate, out: NativeDate[]) => number;
  generateTime: (ctx: Ptr, tc: Ptr, min: NativeTime, max: NativeTime, out: NativeTime[]) => number;
  generateDatetime: (
    ctx: Ptr,
    tc: Ptr,
    min: NativeDatetime,
    max: NativeDatetime,
    out: NativeDatetime[],
  ) => number;
  generateIpv4: (ctx: Ptr, tc: Ptr, outBytes: Buffer) => number;
  generateIpv6: (ctx: Ptr, tc: Ptr, outBytes: Buffer) => number;

  startSpan: (ctx: Ptr, tc: Ptr, label: number) => number;
  stopSpan: (ctx: Ptr, tc: Ptr, discard: boolean) => number;
  newCollection: (ctx: Ptr, tc: Ptr, min: number, max: bigint, out: Ptr[]) => number;
  collectionMore: (ctx: Ptr, tc: Ptr, collection: Ptr, out: boolean[]) => number;
  collectionReject: (ctx: Ptr, tc: Ptr, collection: Ptr, why: string | null) => number;
  collectionFree: (collection: Ptr) => void;
  markComplete: (ctx: Ptr, tc: Ptr, status: number, origin: string | null) => number;

  runResultStatus: (r: Ptr) => number;
  runResultError: (r: Ptr) => string | null;
  runResultFailureCount: (r: Ptr) => number;
  runResultFailure: (r: Ptr, index: number) => Ptr;
  failureFree: (f: Ptr) => void;
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
  // Same, for the ABI's struct-by-value functions, which koffi cannot express
  // in prototype-string form with anonymous struct types.
  type KoffiTypeSpec = string | TypeObject | ReturnType<typeof koffi.out>;
  const fs = (
    name: string,
    args: KoffiTypeSpec[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): ((...args: any[]) => any) => lib.func(name, "int", args);

  const contextNew = f("void* hegel_context_new()");
  const contextFree = f("void hegel_context_free(void* ctx)");
  const contextLastError = f("const char* hegel_context_last_error(void* ctx)");

  const settingsNew = f("int hegel_settings_new(void* ctx, _Out_ void** out)");
  const settingsFree = f("void hegel_settings_free(void* ctx, void* s)");
  const settingsTestCases = f("int hegel_settings_set_test_cases(void* ctx, void* s, uint64_t n)");
  const settingsVerbosity = f("int hegel_settings_set_verbosity(void* ctx, void* s, uint32_t v)");
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

  const runStart = f(
    "int hegel_run_start(void* ctx, void* settings, void* callback, void* user_data, _Out_ void** out_run)",
  );
  const nextTestCase = f("int hegel_next_test_case(void* ctx, void* run, _Out_ void** out_tc)");
  const runResult = f("int hegel_run_result(void* ctx, void* run, _Out_ void** out_result)");
  const runResultFree = f("int hegel_run_result_free(void* ctx, void* r)");
  const runFree = f("int hegel_run_free(void* ctx, void* run)");

  const testCaseFromBlob = f(
    "int hegel_test_case_from_blob(void* ctx, void* s, const char* blob, void* callback, void* user_data, _Out_ void** out_tc)",
  );
  const testCaseFree = f("int hegel_test_case_free(void* ctx, void* tc)");

  const generateBoolean = f(
    "int hegel_generate_boolean(void* ctx, void* tc, double p, bool forced, bool has_forced, _Out_ bool* out)",
  );
  const generateInteger = f(
    "int hegel_generate_integer(void* ctx, void* tc, int64_t min, int64_t max, _Out_ int64_t* out)",
  );
  const generateIntegerBig = f(
    "int hegel_generate_integer_big(void* ctx, void* tc, const uint8_t* min, size_t min_len, const uint8_t* max, size_t max_len, _Out_ uint8_t* out_value, size_t out_value_cap, _Out_ size_t* out_len)",
  );
  const generateFloat = f(
    "int hegel_generate_float(void* ctx, void* tc, uint32_t width, double min, double max, bool allow_nan, bool allow_infinity, bool exclude_min, bool exclude_max, double smallest_nonzero_magnitude, _Out_ double* out)",
  );
  const generateBytes = fs("hegel_generate_bytes", [
    "void*",
    "void*",
    "uint64_t",
    "uint64_t",
    koffi.out(koffi.pointer(bufferResultType)),
  ]);
  const generateBytesResultFree = lib.func("hegel_generate_bytes_result_free", "int", [
    "void*",
    koffi.pointer(bufferResultType),
  ]);

  const stringGeneratorText = f(
    "int hegel_string_generator_text(void* ctx, uint64_t min_size, uint64_t max_size, const char* codec, uint32_t min_codepoint, uint32_t max_codepoint, const char** categories, size_t categories_len, const char** exclude_categories, size_t exclude_categories_len, const uint8_t* include_characters, size_t include_characters_len, const uint8_t* exclude_characters, size_t exclude_characters_len, _Out_ void** out)",
  );
  const stringGeneratorRegex = f(
    "int hegel_string_generator_regex(void* ctx, const char* pattern, bool fullmatch, void* alphabet, _Out_ void** out)",
  );
  const stringGeneratorEmail = f("int hegel_string_generator_email(void* ctx, _Out_ void** out)");
  const stringGeneratorUrl = f("int hegel_string_generator_url(void* ctx, _Out_ void** out)");
  const stringGeneratorDomain = f(
    "int hegel_string_generator_domain(void* ctx, uint64_t max_length, _Out_ void** out)",
  );
  const generateString = fs("hegel_generate_string", [
    "void*",
    "void*",
    "void*",
    koffi.out(koffi.pointer(bufferResultType)),
  ]);
  const generateStringResultFree = lib.func("hegel_generate_string_result_free", "int", [
    "void*",
    koffi.pointer(bufferResultType),
  ]);

  const generateDate = fs("hegel_generate_date", [
    "void*",
    "void*",
    dateType,
    dateType,
    koffi.out(koffi.pointer(dateType)),
  ]);
  const generateTime = fs("hegel_generate_time", [
    "void*",
    "void*",
    timeType,
    timeType,
    koffi.out(koffi.pointer(timeType)),
  ]);
  const generateDatetime = fs("hegel_generate_datetime", [
    "void*",
    "void*",
    datetimeType,
    datetimeType,
    koffi.out(koffi.pointer(datetimeType)),
  ]);
  const generateIpv4 = f("int hegel_generate_ipv4(void* ctx, void* tc, _Out_ uint8_t* out_bytes)");
  const generateIpv6 = f("int hegel_generate_ipv6(void* ctx, void* tc, _Out_ uint8_t* out_bytes)");

  const startSpan = f("int hegel_start_span(void* ctx, void* tc, uint64_t label)");
  const stopSpan = f("int hegel_stop_span(void* ctx, void* tc, bool discard)");
  const newCollection = f(
    "int hegel_new_collection(void* ctx, void* tc, uint64_t min_size, uint64_t max_size, _Out_ void** out_collection)",
  );
  const collectionMore = f(
    "int hegel_collection_more(void* ctx, void* tc, void* collection, _Out_ bool* out)",
  );
  const collectionReject = f(
    "int hegel_collection_reject(void* ctx, void* tc, void* collection, const char* why)",
  );
  const collectionFree = f("int hegel_collection_free(void* ctx, void* collection)");
  const markComplete = f(
    "int hegel_mark_complete(void* ctx, void* tc, uint32_t status, const char* origin)",
  );

  const runResultStatus = f("int hegel_run_result_status(void* ctx, void* r, _Out_ int* out)");
  const runResultError = f("int hegel_run_result_error(void* ctx, void* r, _Out_ char** out)");
  const runResultFailureCount = f(
    "int hegel_run_result_failure_count(void* ctx, void* r, _Out_ size_t* out)",
  );
  const runResultFailure = f(
    "int hegel_run_result_failure(void* ctx, void* r, size_t index, _Out_ void** out)",
  );
  const failureFree = f("int hegel_failure_free(void* ctx, void* f)");
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
    runStart: (ctx, s, out) => runStart(ctx, s, null, null, out),
    nextTestCase: (ctx, run, out) => nextTestCase(ctx, run, out),
    runResult: (ctx, run, out) => runResult(ctx, run, out),
    runResultFree: (r) => void runResultFree(null, r),
    runFree: (run) => void runFree(null, run),
    testCaseFromBlob: (ctx, s, blob, out) => testCaseFromBlob(ctx, s, blob, null, null, out),
    testCaseFree: (tc) => void testCaseFree(null, tc),
    generateBoolean: (ctx, tc, p, out) => generateBoolean(ctx, tc, p, false, false, out),
    generateInteger: (ctx, tc, min, max, out) => generateInteger(ctx, tc, min, max, out),
    generateIntegerBig: (ctx, tc, min, max, outValue, outLen) =>
      generateIntegerBig(
        ctx,
        tc,
        min,
        min.length,
        max,
        max.length,
        outValue,
        outValue.length,
        outLen,
      ),
    generateFloat: (ctx, tc, opts, out) =>
      generateFloat(
        ctx,
        tc,
        opts.width,
        opts.minValue,
        opts.maxValue,
        opts.allowNan,
        opts.allowInfinity,
        opts.excludeMin,
        opts.excludeMax,
        opts.smallestNonzeroMagnitude,
        out,
      ),
    generateBytes: (ctx, tc, min, max, out) => generateBytes(ctx, tc, min, max, out),
    generateBytesResultFree: (result) => void generateBytesResultFree(null, result),
    stringGeneratorText: (ctx, opts, out) =>
      stringGeneratorText(
        ctx,
        opts.minSize,
        opts.maxSize,
        opts.codec,
        opts.minCodepoint,
        opts.maxCodepoint,
        opts.categories,
        opts.categories === null ? 0 : opts.categories.length,
        opts.excludeCategories,
        opts.excludeCategories === null ? 0 : opts.excludeCategories.length,
        opts.includeCharacters,
        opts.includeCharacters === null ? 0 : opts.includeCharacters.length,
        opts.excludeCharacters,
        opts.excludeCharacters === null ? 0 : opts.excludeCharacters.length,
        out,
      ),
    stringGeneratorRegex: (ctx, pattern, fullmatch, out) =>
      stringGeneratorRegex(ctx, pattern, fullmatch, null, out),
    stringGeneratorEmail: (ctx, out) => stringGeneratorEmail(ctx, out),
    stringGeneratorUrl: (ctx, out) => stringGeneratorUrl(ctx, out),
    stringGeneratorDomain: (ctx, maxLength, out) => stringGeneratorDomain(ctx, maxLength, out),
    generateString: (ctx, tc, generator, out) => generateString(ctx, tc, generator, out),
    generateStringResultFree: (result) => void generateStringResultFree(null, result),
    generateDate: (ctx, tc, min, max, out) => generateDate(ctx, tc, min, max, out),
    generateTime: (ctx, tc, min, max, out) => generateTime(ctx, tc, min, max, out),
    generateDatetime: (ctx, tc, min, max, out) => generateDatetime(ctx, tc, min, max, out),
    generateIpv4: (ctx, tc, outBytes) => generateIpv4(ctx, tc, outBytes),
    generateIpv6: (ctx, tc, outBytes) => generateIpv6(ctx, tc, outBytes),
    startSpan: (ctx, tc, label) => startSpan(ctx, tc, label),
    stopSpan: (ctx, tc, discard) => stopSpan(ctx, tc, discard),
    newCollection: (ctx, tc, min, max, out) => newCollection(ctx, tc, min, max, out),
    collectionMore: (ctx, tc, collection, out) => collectionMore(ctx, tc, collection, out),
    collectionReject: (ctx, tc, collection, why) => collectionReject(ctx, tc, collection, why),
    collectionFree: (collection) => void collectionFree(null, collection),
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
    failureFree: (fp) => void failureFree(null, fp),
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
const INT64_MIN = -0x8000000000000000n;
const INT64_MAX = 0x7fffffffffffffffn;

/** Whether both bounds fit `hegel_generate_integer`'s `int64_t` arguments. */
export function fitsInt64(min: bigint, max: bigint): boolean {
  return min >= INT64_MIN && max <= INT64_MAX;
}

/**
 * Encode a bigint as the minimal two's-complement little-endian byte buffer —
 * the wire format `hegel_generate_integer_big` consumes for its bounds.
 */
export function bigIntToTwosComplementLE(v: bigint): Buffer {
  const bytes: number[] = [];
  if (v >= 0n) {
    let x = v;
    for (;;) {
      const b = Number(x & 0xffn);
      x >>= 8n;
      bytes.push(b);
      // Done once nothing remains and the top bit reads as non-negative
      // (otherwise a trailing 0x00 sign byte is emitted next iteration).
      if (x === 0n && (b & 0x80) === 0) break;
    }
  } else {
    let x = v;
    for (;;) {
      const b = Number(x & 0xffn);
      // BigInt >> is arithmetic, so the sign extension never terminates on 0.
      x >>= 8n;
      bytes.push(b);
      // Done once only sign extension remains and the top bit reads negative.
      if (x === -1n && (b & 0x80) !== 0) break;
    }
  }
  return Buffer.from(bytes);
}

/** Decode a two's-complement little-endian byte buffer into a bigint. */
export function twosComplementLEToBigInt(buf: Buffer): bigint {
  let v = 0n;
  for (let i = buf.length - 1; i >= 0; i--) {
    v = (v << 8n) | BigInt(buf[i]);
  }
  if ((buf[buf.length - 1] & 0x80) !== 0) {
    v -= 1n << BigInt(buf.length * 8);
  }
  return v;
}

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
   * The returned handle is owned by the caller — release it with
   * {@link freeTestCase} once the case is complete.
   */
  nextTestCase(ctx: Ptr, run: Ptr): Ptr | null {
    const out: Ptr[] = [null];
    this.check(ctx, this.fns.nextTestCase(ctx, run, out), "hegel_next_test_case");
    return out[0] ?? null;
  }

  /**
   * Read the aggregated run result: a caller-owned copy, released with
   * {@link freeRunResult}. Throws on failure.
   */
  runResult(ctx: Ptr, run: Ptr): Ptr {
    const out: Ptr[] = [null];
    this.check(ctx, this.fns.runResult(ctx, run, out), "hegel_run_result");
    return out[0];
  }

  freeRunResult(r: Ptr): void {
    this.fns.runResultFree(r);
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

  /** Draw a boolean that is `true` with probability `p`. */
  generateBoolean(ctx: Ptr, tc: Ptr, p: number): boolean {
    const out: boolean[] = [false];
    this.check(ctx, this.fns.generateBoolean(ctx, tc, p, out), "hegel_generate_boolean");
    return out[0];
  }

  /**
   * Draw an integer in `[min, max]`. Both bounds must satisfy
   * {@link fitsInt64}; use {@link generateIntegerBig} otherwise.
   */
  generateInteger(ctx: Ptr, tc: Ptr, min: bigint, max: bigint): bigint {
    const out: (number | bigint)[] = [0];
    this.check(ctx, this.fns.generateInteger(ctx, tc, min, max, out), "hegel_generate_integer");
    return BigInt(out[0]);
  }

  /** Draw an arbitrary-precision integer in `[min, max]`. */
  generateIntegerBig(ctx: Ptr, tc: Ptr, min: bigint, max: bigint): bigint {
    const minBytes = bigIntToTwosComplementLE(min);
    const maxBytes = bigIntToTwosComplementLE(max);
    // The draw is within the bounds, so max(min_len, max_len) always suffices;
    // the engine sign-fills the buffer, so decoding all of it needs no length.
    const outValue = Buffer.alloc(Math.max(minBytes.length, maxBytes.length));
    const outLen: (number | bigint)[] = [0];
    this.check(
      ctx,
      this.fns.generateIntegerBig(ctx, tc, minBytes, maxBytes, outValue, outLen),
      "hegel_generate_integer_big",
    );
    return twosComplementLEToBigInt(outValue);
  }

  /** Draw a float per the given `hegel_generate_float` options. */
  generateFloat(ctx: Ptr, tc: Ptr, opts: NativeFloatOptions): number {
    const out: number[] = [0];
    this.check(ctx, this.fns.generateFloat(ctx, tc, opts, out), "hegel_generate_float");
    return out[0];
  }

  /** Draw a byte string with length in `[minSize, maxSize]` (no bound if omitted). */
  generateBytes(ctx: Ptr, tc: Ptr, minSize: number, maxSize?: number): Buffer {
    const out: NativeBuffer[] = [{ data: null, len: 0 }];
    const maxArg = maxSize === undefined ? UINT64_MAX : BigInt(maxSize);
    this.check(
      ctx,
      this.fns.generateBytes(ctx, tc, BigInt(minSize), maxArg, out),
      "hegel_generate_bytes",
    );
    const bytes = this.copyNativeBuffer(out[0]);
    this.fns.generateBytesResultFree(out[0]);
    return bytes;
  }

  /** Build a text string generator. Throws {@link LibhegelError} on invalid options. */
  stringGeneratorText(ctx: Ptr, opts: TextGeneratorOptions): Ptr {
    const out: Ptr[] = [null];
    this.check(ctx, this.fns.stringGeneratorText(ctx, opts, out), "hegel_string_generator_text");
    return out[0];
  }

  /** Build a regex string generator. Throws {@link LibhegelError} on a bad pattern. */
  stringGeneratorRegex(ctx: Ptr, pattern: string, fullmatch: boolean): Ptr {
    const out: Ptr[] = [null];
    this.check(
      ctx,
      this.fns.stringGeneratorRegex(ctx, pattern, fullmatch, out),
      "hegel_string_generator_regex",
    );
    return out[0];
  }

  /** Build an email-address string generator. */
  stringGeneratorEmail(ctx: Ptr): Ptr {
    const out: Ptr[] = [null];
    this.check(ctx, this.fns.stringGeneratorEmail(ctx, out), "hegel_string_generator_email");
    return out[0];
  }

  /** Build a URL string generator. */
  stringGeneratorUrl(ctx: Ptr): Ptr {
    const out: Ptr[] = [null];
    this.check(ctx, this.fns.stringGeneratorUrl(ctx, out), "hegel_string_generator_url");
    return out[0];
  }

  /** Build a domain-name string generator. Throws on an out-of-range length. */
  stringGeneratorDomain(ctx: Ptr, maxLength: number): Ptr {
    const out: Ptr[] = [null];
    this.check(
      ctx,
      this.fns.stringGeneratorDomain(ctx, maxLength, out),
      "hegel_string_generator_domain",
    );
    return out[0];
  }

  /** Draw a string from a `hegel_string_generator_t`. */
  generateString(ctx: Ptr, tc: Ptr, generator: Ptr): string {
    const out: NativeBuffer[] = [{ data: null, len: 0 }];
    this.check(ctx, this.fns.generateString(ctx, tc, generator, out), "hegel_generate_string");
    const bytes = this.copyNativeBuffer(out[0]);
    this.fns.generateStringResultFree(out[0]);
    return wtf8ToString(bytes);
  }

  /** Copy an engine-owned `{data, len}` buffer into a JS-owned Buffer. */
  private copyNativeBuffer(result: NativeBuffer): Buffer {
    const len = Number(result.len);
    if (len === 0) {
      return Buffer.alloc(0);
    }
    return Buffer.from(koffi.decode(result.data, "uint8_t", len) as unknown as number[]);
  }

  /** Draw a date in `[min, max]`. */
  generateDate(ctx: Ptr, tc: Ptr, min: NativeDate, max: NativeDate): NativeDate {
    const out: NativeDate[] = [{ year: 0, month: 0, day: 0 }];
    this.check(ctx, this.fns.generateDate(ctx, tc, min, max, out), "hegel_generate_date");
    return out[0];
  }

  /** Draw a time of day in `[min, max]`. */
  generateTime(ctx: Ptr, tc: Ptr, min: NativeTime, max: NativeTime): NativeTime {
    const out: NativeTime[] = [{ hour: 0, minute: 0, second: 0, nanosecond: 0 }];
    this.check(ctx, this.fns.generateTime(ctx, tc, min, max, out), "hegel_generate_time");
    return out[0];
  }

  /** Draw a naive datetime in `[min, max]`. */
  generateDatetime(ctx: Ptr, tc: Ptr, min: NativeDatetime, max: NativeDatetime): NativeDatetime {
    const out: NativeDatetime[] = [
      {
        date: { year: 0, month: 0, day: 0 },
        time: { hour: 0, minute: 0, second: 0, nanosecond: 0 },
      },
    ];
    this.check(ctx, this.fns.generateDatetime(ctx, tc, min, max, out), "hegel_generate_datetime");
    return out[0];
  }

  /** Draw an IPv4 address as its 4 network-order bytes. */
  generateIpv4(ctx: Ptr, tc: Ptr): Buffer {
    const out = Buffer.alloc(4);
    this.check(ctx, this.fns.generateIpv4(ctx, tc, out), "hegel_generate_ipv4");
    return out;
  }

  /** Draw an IPv6 address as its 16 network-order bytes. */
  generateIpv6(ctx: Ptr, tc: Ptr): Buffer {
    const out = Buffer.alloc(16);
    this.check(ctx, this.fns.generateIpv6(ctx, tc, out), "hegel_generate_ipv6");
    return out;
  }

  startSpan(ctx: Ptr, tc: Ptr, label: number): void {
    this.check(ctx, this.fns.startSpan(ctx, tc, label), "hegel_start_span");
  }

  stopSpan(ctx: Ptr, tc: Ptr, discard: boolean): void {
    this.check(ctx, this.fns.stopSpan(ctx, tc, discard), "hegel_stop_span");
  }

  /**
   * Open a collection with the given size bounds. The returned handle is owned
   * by the caller — release it with {@link freeCollection}.
   */
  newCollection(ctx: Ptr, tc: Ptr, min: number, max?: number): Ptr {
    const out: Ptr[] = [null];
    const maxArg = max === undefined ? UINT64_MAX : BigInt(max);
    this.check(ctx, this.fns.newCollection(ctx, tc, min, maxArg, out), "hegel_new_collection");
    return out[0];
  }

  collectionMore(ctx: Ptr, tc: Ptr, collection: Ptr): boolean {
    const out: boolean[] = [false];
    this.check(ctx, this.fns.collectionMore(ctx, tc, collection, out), "hegel_collection_more");
    return out[0];
  }

  collectionReject(ctx: Ptr, tc: Ptr, collection: Ptr, why: string | null): void {
    this.check(ctx, this.fns.collectionReject(ctx, tc, collection, why), "hegel_collection_reject");
  }

  freeCollection(collection: Ptr): void {
    this.fns.collectionFree(collection);
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

  /**
   * Read the `index`th failure: a caller-owned copy, released with
   * {@link freeFailure}.
   */
  failure(r: Ptr, index: number): Ptr {
    return this.fns.runResultFailure(r, index);
  }

  freeFailure(f: Ptr): void {
    this.fns.failureFree(f);
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
