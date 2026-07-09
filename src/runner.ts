/**
 * Test runner: the `hegel.test` / `hegel.testAsync` entry points, Settings, and
 * the test lifecycle driving the native libhegel run loop.
 *
 * @packageDocumentation
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { encode, decode } from "./cbor.js";
import { TestCase, StopTestError, AssumeError, type DataSource } from "./testCase.js";
import { getLibhegel } from "./session.js";
import { Libhegel, Status, RunStatus, NativeVerbosity, type Ptr } from "./libhegel.js";

export enum Verbosity {
  Quiet = "quiet",
  Normal = "normal",
  Verbose = "verbose",
  Debug = "debug",
}

export enum HealthCheck {
  FilterTooMuch = "filter_too_much",
  TooSlow = "too_slow",
  TestCasesTooLarge = "test_cases_too_large",
  LargeInitialTestCase = "large_initial_test_case",
}

const VERBOSITY_TO_NATIVE: Record<Verbosity, number> = {
  [Verbosity.Quiet]: NativeVerbosity.QUIET,
  [Verbosity.Normal]: NativeVerbosity.NORMAL,
  [Verbosity.Verbose]: NativeVerbosity.VERBOSE,
  [Verbosity.Debug]: NativeVerbosity.DEBUG,
};

// `hegel_health_check_t` bit flags.
const HEALTH_CHECK_TO_BIT: Record<HealthCheck, number> = {
  [HealthCheck.FilterTooMuch]: 1 << 0,
  [HealthCheck.TooSlow]: 1 << 1,
  [HealthCheck.TestCasesTooLarge]: 1 << 2,
  [HealthCheck.LargeInitialTestCase]: 1 << 3,
};

export type Database = { kind: "unset" } | { kind: "disabled" } | { kind: "path"; path: string };

export const Database = {
  unset: { kind: "unset" } as Database,
  disabled: { kind: "disabled" } as Database,
  fromPath: (path: string): Database => ({ kind: "path", path }),
};

export interface Settings {
  testCases: number;
  seed: number | null;
  verbosity: Verbosity;
  derandomize: boolean;
  database: Database;
  suppressHealthCheck: HealthCheck[];
  reportMultipleFailures: boolean;
}

function isInCI(): boolean {
  const ciVars: Array<[string, string | null]> = [
    ["CI", null],
    ["BITBUCKET_COMMIT", null],
    ["BUILDKITE", "true"],
    ["CIRCLECI", "true"],
    ["CIRRUS_CI", "true"],
    ["CODEBUILD_BUILD_ID", null],
    ["GITHUB_ACTIONS", "true"],
    ["GITLAB_CI", null],
    ["HEROKU_TEST_RUN_ID", null],
    ["TEAMCITY_VERSION", null],
    ["TF_BUILD", "true"],
    ["bamboo_buildKey", null],
  ];
  return ciVars.some(([key, value]) => {
    if (value === null) {
      return process.env[key] !== undefined;
    }
    return process.env[key] === value;
  });
}

export function defaultSettings(): Settings {
  const inCI = isInCI();
  return {
    testCases: 100,
    seed: null,
    verbosity: Verbosity.Normal,
    derandomize: inCI,
    database: inCI ? Database.disabled : Database.unset,
    suppressHealthCheck: [],
    reportMultipleFailures: false,
  };
}

// ---------------------------------------------------------------------------
// NativeDataSource
// ---------------------------------------------------------------------------

/**
 * {@link DataSource} backed by a native libhegel test case. All draws, spans
 * and collection operations dispatch to the engine via the {@link Libhegel}
 * C-ABI wrapper.
 */
export class NativeDataSource implements DataSource {
  private readonly lib: Libhegel;
  private readonly ctx: Ptr;
  private readonly tc: Ptr;

  constructor(lib: Libhegel, ctx: Ptr, tc: Ptr) {
    this.lib = lib;
    this.ctx = ctx;
    this.tc = tc;
  }

  generate(schema: Record<string, unknown>): unknown {
    const out = this.lib.generate(this.ctx, this.tc, encode(schema));
    return decode(out);
  }

  startSpan(label: number): void {
    this.lib.startSpan(this.ctx, this.tc, label);
  }

  stopSpan(discard: boolean): void {
    this.lib.stopSpan(this.ctx, this.tc, discard);
  }

  newCollection(minSize: number, maxSize?: number): number {
    return Number(this.lib.newCollection(this.ctx, this.tc, minSize, maxSize));
  }

  collectionMore(collectionId: number): boolean {
    return this.lib.collectionMore(this.ctx, this.tc, BigInt(collectionId));
  }

  collectionReject(collectionId: number, why?: string): void {
    this.lib.collectionReject(this.ctx, this.tc, BigInt(collectionId), why ?? null);
  }

  markComplete(status: number, origin: string | null): void {
    this.lib.markComplete(this.ctx, this.tc, status, origin);
  }
}

// ---------------------------------------------------------------------------
// Per-test-case execution
// ---------------------------------------------------------------------------

export type TestCaseResult =
  | { status: "valid" }
  | { status: "invalid" }
  | { status: "overrun" }
  | { status: "interesting"; error: unknown };

const RESULT_TO_STATUS: Record<TestCaseResult["status"], number> = {
  valid: Status.VALID,
  invalid: Status.INVALID,
  overrun: Status.OVERRUN,
  interesting: Status.INTERESTING,
};

/**
 * Extract a stable origin for a thrown error: the first stack frame outside
 * `node_modules` (the user's test code). The shrinker groups failing inputs by
 * this origin, so it must be stable across calls.
 */
function extractOrigin(error: unknown): string {
  if (!(error instanceof Error) || !error.stack) return "<unknown>";
  const lines = error.stack.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("at ") && !trimmed.includes("node_modules")) {
      return trimmed;
    }
  }
  /* v8 ignore start: all stack traces in practice have at least one non-node_modules frame */
  return "<unknown>";
  /* v8 ignore stop */
}

function classifyResult(
  e: unknown,
  isFinal: boolean,
): { result: TestCaseResult; origin: string | null } {
  if (e instanceof AssumeError) return { result: { status: "invalid" }, origin: null };
  if (e instanceof StopTestError) return { result: { status: "overrun" }, origin: null };

  if (isFinal) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`\n${msg}`);
    if (e instanceof Error && e.stack) {
      console.error(e.stack);
    }
  }
  return { result: { status: "interesting", error: e }, origin: extractOrigin(e) };
}

function finalizeTestCase(
  dataSource: DataSource,
  result: TestCaseResult,
  origin: string | null,
): void {
  dataSource.markComplete(RESULT_TO_STATUS[result.status], origin);
}

export async function runTestCaseAsync(
  dataSource: DataSource,
  testFn: (tc: TestCase) => void | Promise<void>,
  isFinal: boolean,
): Promise<TestCaseResult> {
  const tc = new TestCase(dataSource, isFinal);

  let result: TestCaseResult;
  let origin: string | null = null;

  try {
    await testFn(tc);
    result = { status: "valid" };
  } catch (e: unknown) {
    ({ result, origin } = classifyResult(e, isFinal));
  }

  finalizeTestCase(dataSource, result, origin);
  return result;
}

export function runTestCase(
  dataSource: DataSource,
  testFn: (tc: TestCase) => void,
  isFinal: boolean,
): TestCaseResult {
  const tc = new TestCase(dataSource, isFinal);

  let result: TestCaseResult;
  let origin: string | null = null;

  try {
    testFn(tc);
    result = { status: "valid" };
  } catch (e: unknown) {
    ({ result, origin } = classifyResult(e, isFinal));
  }

  finalizeTestCase(dataSource, result, origin);
  return result;
}

export interface TestLocation {
  function: string;
  file: string;
  class: string;
  beginLine: number;
}

/* v8 ignore start: only runs inside Antithesis */
function isRunningInAntithesis(): boolean {
  const dir = process.env["ANTITHESIS_OUTPUT_DIR"];
  return dir !== undefined && dir !== "";
}
function emitAntithesisAssertion(location: TestLocation, passed: boolean): void {
  const dir = process.env["ANTITHESIS_OUTPUT_DIR"];
  if (!dir) return;

  const filePath = path.join(dir, "sdk.jsonl");
  const id = `${location.class}::${location.function} passes properties`;

  const locationObj = {
    class: location.class,
    function: location.function,
    file: location.file,
    begin_line: location.beginLine,
    begin_column: 0,
  };

  const declaration = {
    antithesis_assert: {
      hit: false,
      must_hit: true,
      assert_type: "always",
      display_type: "Always",
      condition: false,
      id,
      message: id,
      location: locationObj,
    },
  };

  const evaluation = {
    antithesis_assert: {
      hit: true,
      must_hit: true,
      assert_type: "always",
      display_type: "Always",
      condition: passed,
      id,
      message: id,
      location: locationObj,
    },
  };

  fs.appendFileSync(
    filePath,
    JSON.stringify(declaration) + "\n" + JSON.stringify(evaluation) + "\n",
  );
}
/* v8 ignore stop */

function databaseKey(testFn: (tc: TestCase) => unknown): string {
  return testFn.toString();
}

function configureSettings(
  lib: Libhegel,
  ctx: Ptr,
  settings: Ptr,
  s: Settings,
  testFn: (tc: TestCase) => unknown,
): void {
  lib.setTestCases(settings, s.testCases);
  lib.setVerbosity(settings, VERBOSITY_TO_NATIVE[s.verbosity]);
  lib.setDerandomize(settings, s.derandomize);
  lib.setReportMultipleFailures(settings, s.reportMultipleFailures);
  if (s.seed !== null) {
    lib.setSeed(settings, BigInt(s.seed));
  }

  if (s.database.kind === "disabled") {
    lib.setDatabase(ctx, settings, "");
  } else if (s.database.kind === "path") {
    lib.setDatabase(ctx, settings, s.database.path);
    lib.setDatabaseKey(ctx, settings, databaseKey(testFn));
  } else {
    lib.setDatabaseKey(ctx, settings, databaseKey(testFn));
  }

  if (s.suppressHealthCheck.length > 0) {
    let mask = 0;
    for (const hc of s.suppressHealthCheck) {
      mask |= HEALTH_CHECK_TO_BIT[hc];
    }
    lib.setSuppressHealthCheck(settings, mask);
  }
}

export class Hegel {
  private testFn: (tc: TestCase) => void | Promise<void>;
  private _settings: Settings;
  private _testLocation: TestLocation | null = null;

  constructor(testFn: (tc: TestCase) => void | Promise<void>) {
    this.testFn = testFn;
    this._settings = defaultSettings();
  }

  /** Override default settings. Returns this for chaining. */
  settings(s: Partial<Settings>): this {
    Object.assign(this._settings, s);
    return this;
  }

  /** Set the test location for Antithesis integration. */
  /* v8 ignore start: only used inside Antithesis */
  testLocation(location: TestLocation): this {
    this._testLocation = location;
    return this;
  }
  /* v8 ignore stop */

  /**
   * Generator that drives the libhegel run loop, yielding a
   * {@link NativeDataSource} (plus an `isFinal` flag) for each test case the
   * driver ({@link run} or {@link runSync}) should execute the body against. The
   * driver runs the user's body and resumes the generator with the
   * {@link TestCaseResult}. This factoring lets the sync and async drivers share
   * one loop implementation.
   *
   * The engine only *explores* (generate / shrink), so every pumped case is
   * non-final. The client owns the final replays: once the loop drains and the
   * run has failed, each discovered counterexample's reproduce blob is replayed
   * (via `hegel_test_case_from_blob`) as a final case to surface the test's own
   * error for the thrown message.
   */
  private *runSteps(): Generator<{ ds: NativeDataSource; isFinal: boolean }, void, TestCaseResult> {
    const lib = getLibhegel();
    const ctx = lib.newContext();
    const settings = lib.newSettings();
    try {
      configureSettings(lib, ctx, settings, this._settings, this.testFn);
      const run = lib.runStart(ctx, settings);
      try {
        for (;;) {
          const tc = lib.nextTestCase(ctx, run);
          if (tc === null) break;
          const ds = new NativeDataSource(lib, ctx, tc);
          yield { ds, isFinal: false };
        }

        const result = lib.runResult(ctx, run);
        const status = lib.runStatus(result);

        /* v8 ignore start: only runs inside Antithesis */
        if (isRunningInAntithesis() && this._testLocation) {
          emitAntithesisAssertion(this._testLocation, status === RunStatus.PASSED);
        }
        /* v8 ignore stop */

        if (status === RunStatus.PASSED) {
          return;
        }
        if (status === RunStatus.ERROR) {
          throw new Error(`Property test failed: ${lib.runError(result)}`);
        }
        // RunStatus.FAILED: replay each distinct counterexample's blob as a
        // final, client-owned case. A genuine counterexample re-fails on replay,
        // so the body throws its own error again — captured here for the message.
        const count = lib.failureCount(result);
        const origins: string[] = [];
        let finalError: unknown = null;
        for (let i = 0; i < count; i++) {
          const failure = lib.failure(result, i);
          origins.push(lib.failureOrigin(failure));
          const replayTc = lib.testCaseFromBlob(ctx, settings, lib.reproductionBlob(failure));
          try {
            const ds = new NativeDataSource(lib, ctx, replayTc);
            const replay = yield { ds, isFinal: true };
            finalError = (replay as { error?: unknown }).error;
          } finally {
            lib.freeTestCase(replayTc);
          }
        }
        const detail = finalError instanceof Error ? finalError.message : String(finalError);
        throw new Error(`Property test failed: ${detail} [${origins.join("; ")}]`);
      } finally {
        lib.freeRun(run);
      }
    } finally {
      lib.freeSettings(settings);
      lib.freeContext(ctx);
    }
  }

  async run(): Promise<void> {
    const gen = this.runSteps();
    let next = gen.next();
    while (!next.done) {
      const { ds, isFinal } = next.value;
      const result = await runTestCaseAsync(ds, this.testFn, isFinal);
      next = gen.next(result);
    }
  }

  runSync(): void {
    const gen = this.runSteps();
    let next = gen.next();
    while (!next.done) {
      const { ds, isFinal } = next.value;
      const result = runTestCase(ds, this.testFn as (tc: TestCase) => void, isFinal);
      next = gen.next(result);
    }
  }
}

/**
 * Run a property-based test.
 *
 * If your property is async, see {@link testAsync} instead.
 *
 * @example
 * ```ts
 * import { test } from 'vitest';
 * import * as hegel from '@hegeldev/hegel';
 * import * as gs from '@hegeldev/hegel/generators';
 *
 * test('addition is commutative', () =>
 *   hegel.test((tc) => {
 *     const x = tc.draw(gs.integers());
 *     const y = tc.draw(gs.integers());
 *     expect(x + y).toBe(y + x);
 *   }),
 * );
 * ```
 */
export function test(testFn: (tc: TestCase) => void, settings?: Partial<Settings>): void {
  if (testFn.constructor.name === "AsyncFunction") {
    throw new TypeError("hegel.test received an async test body. Use hegel.testAsync instead.");
  }
  const h = new Hegel(testFn);
  if (settings) h.settings(settings);
  h.runSync();
}

/**
 * Run a property-based test with an asynchronous test body.
 *
 * Returns a `Promise<void>` that resolves when the test completes and
 * rejects if any test case fails.
 *
 * @example
 * ```ts
 * import { test } from 'vitest';
 * import * as hegel from '@hegeldev/hegel';
 * import * as gs from '@hegeldev/hegel/generators';
 *
 * test('my async test', () =>
 *   hegel.testAsync(async (tc) => {
 *     const x = tc.draw(gs.integers());
 *     const result = await someAsyncOperation(x);
 *     expect(result).toEqual(expected(x));
 *   }),
 * );
 * ```
 */
export async function testAsync(
  testFn: (tc: TestCase) => void | Promise<void>,
  settings?: Partial<Settings>,
): Promise<void> {
  const h = new Hegel(testFn);
  if (settings) h.settings(settings);
  await h.run();
}
