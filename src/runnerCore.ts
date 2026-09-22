/**
 * Test runner: the `hegel.test` / `hegel.testAsync` entry points, Settings, and
 * the portable test lifecycle driving the engine run loop.
 *
 * @packageDocumentation
 */

import { generateValue, StringGeneratorCache } from "./generate.js";
import {
  TestCase,
  StopTestError,
  AssumeError,
  type DataSource,
  type StateMachineSpec,
} from "./testCase.js";
import {
  EngineError,
  Status,
  RunStatus,
  NativeVerbosity,
  type Engine,
  type ContextHandle,
  type TestCaseHandle,
  type SettingsHandle,
  type CollectionHandle,
  type PoolHandle,
  type StateMachineHandle,
} from "./engine.js";
import { portableDiagnostics, type Diagnostics, type RuntimeServices } from "./runtime.js";

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

// ---------------------------------------------------------------------------
// EngineDataSource
// ---------------------------------------------------------------------------

/**
 * {@link DataSource} backed by an opaque engine test case. Schema draws are
 * interpreted by {@link generateValue}; adapters own all ABI marshalling.
 *
 * The engine's collection, pool and state-machine handles behind the
 * {@link DataSource}'s numeric ids are owned by this object — the runner calls
 * {@link dispose} once the test case is over to release them.
 */
export class EngineDataSource implements DataSource {
  private readonly lib: Engine;
  private readonly ctx: ContextHandle;
  private readonly tc: TestCaseHandle;
  private readonly collections: CollectionHandle[] = [];
  private readonly pools: PoolHandle[] = [];
  private readonly machines: StateMachineHandle[] = [];

  private fault: EngineError | undefined;
  private completed = false;
  constructor(
    lib: Engine,
    ctx: ContextHandle,
    tc: TestCaseHandle,
    private readonly cache = new StringGeneratorCache(lib),
    readonly diagnostics: Diagnostics = portableDiagnostics,
    private readonly ownsCache = true,
  ) {
    this.lib = lib;
    this.ctx = ctx;
    this.tc = tc;
  }

  generate(schema: Record<string, unknown>): unknown {
    return this.call(() => generateValue(this.lib, this.ctx, this.tc, schema, this.cache));
  }

  startSpan(label: number): void {
    this.call(() => this.lib.startSpan(this.ctx, this.tc, label));
  }

  stopSpan(discard: boolean): void {
    this.call(() => this.lib.stopSpan(this.ctx, this.tc, discard));
  }

  newCollection(minSize: number, maxSize?: number): number {
    this.collections.push(
      this.call(() => this.lib.newCollection(this.ctx, this.tc, minSize, maxSize)),
    );
    return this.collections.length - 1;
  }

  collectionMore(collectionId: number): boolean {
    return this.call(() =>
      this.lib.collectionMore(this.ctx, this.tc, this.collections[collectionId]),
    );
  }

  collectionReject(collectionId: number, why?: string): void {
    this.call(() =>
      this.lib.collectionReject(this.ctx, this.tc, this.collections[collectionId], why ?? null),
    );
  }

  markComplete(status: number, origin: string | null): void {
    if (this.completed) throw new EngineError("Test case completion was already attempted");
    this.completed = true;
    this.call(() => this.lib.markComplete(this.ctx, this.tc, status, origin));
  }

  newPool(): number {
    this.pools.push(this.call(() => this.lib.newPool(this.ctx, this.tc)));
    return this.pools.length - 1;
  }

  poolAdd(poolId: number): bigint {
    return this.call(() => this.lib.poolAdd(this.ctx, this.tc, this.pools[poolId]));
  }

  poolGenerate(poolId: number, consume: boolean): bigint {
    return this.call(() => this.lib.poolGenerate(this.ctx, this.tc, this.pools[poolId], consume));
  }

  newStateMachine(spec: StateMachineSpec): number {
    this.machines.push(
      this.call(() =>
        this.lib.newStateMachine(this.ctx, this.tc, {
          ruleNames: spec.ruleNames,
          // One concurrency group, so rules never need to be kept apart.
          ruleGroups: spec.ruleNames.map(() => 0),
          invariantNames: spec.invariantNames,
          invariantAlwaysCheck: spec.invariantAlwaysCheck,
          minConcurrency: 1,
          maxConcurrency: 1,
          stepCount: spec.stepCount,
        }),
      ),
    );
    return this.machines.length - 1;
  }

  stateMachineNextRound(machineId: number): boolean {
    // With a single group the id it reports carries no information; only
    // whether the machine has another round to run matters.
    return this.call(
      () => this.lib.stateMachineNextGroup(this.ctx, this.tc, this.machines[machineId]) !== null,
    );
  }

  stateMachineNextRule(machineId: number): number | null {
    return this.call(() =>
      this.lib.stateMachineNextRule(this.ctx, this.tc, this.machines[machineId], 0),
    );
  }

  stateMachineRuleRejected(machineId: number): void {
    this.call(() =>
      this.lib.stateMachineRuleRejected(this.ctx, this.tc, this.machines[machineId], 0),
    );
  }

  stateMachineShouldCheckInvariant(machineId: number, invariantIndex: number): boolean {
    return this.call(() =>
      this.lib.stateMachineShouldCheckInvariant(
        this.ctx,
        this.tc,
        this.machines[machineId],
        invariantIndex,
      ),
    );
  }

  assertHealthy(): void {
    if (this.fault !== undefined) throw this.fault;
  }

  private call<T>(operation: () => T): T {
    try {
      return operation();
    } catch (error) {
      if (error instanceof AssumeError || error instanceof StopTestError) throw error;
      const fault =
        error instanceof EngineError ? error : new EngineError(String(error), { cause: error });
      this.fault ??= fault;
      throw fault;
    }
  }

  /** Release every owned handle even when a destructor fails. */
  dispose(): void {
    const errors: unknown[] = [];
    const release = <H>(handles: H[], free: (handle: H) => void): void => {
      for (const handle of handles.splice(0)) {
        try {
          free(handle);
        } catch (error) {
          errors.push(error);
        }
      }
    };
    release(this.collections, (collection) => this.lib.freeCollection(collection));
    release(this.pools, (pool) => this.lib.freePool(pool));
    release(this.machines, (machine) => this.lib.freeStateMachine(machine));
    try {
      if (this.ownsCache) this.cache.dispose();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "Test case cleanup failed");
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
    if (
      (trimmed.startsWith("at ") || /@.+:\d+(?::\d+)?$/.test(trimmed)) &&
      !trimmed.includes("node_modules")
    ) {
      return trimmed;
    }
  }
  return "<unknown>";
}

function classifyResult(
  e: unknown,
  isFinal: boolean,
  diagnostics: Diagnostics,
): { result: TestCaseResult; origin: string | null } {
  if (e instanceof AssumeError) return { result: { status: "invalid" }, origin: null };
  if (e instanceof StopTestError) return { result: { status: "overrun" }, origin: null };

  if (e instanceof EngineError) throw e;
  if (isFinal) diagnostics.reportFinalError(e);
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
    dataSource.assertHealthy?.();
    result = { status: "valid" };
  } catch (e: unknown) {
    try {
      dataSource.assertHealthy?.();
      ({ result, origin } = classifyResult(
        e,
        isFinal,
        dataSource.diagnostics ?? portableDiagnostics,
      ));
    } catch (fault) {
      // Abort the active case, but never mark it interesting or retry completion.
      try {
        dataSource.markComplete(Status.INVALID, null);
      } catch (completionError) {
        throw new AggregateError(
          [fault, completionError],
          "Engine failure during case completion",
          { cause: completionError },
        );
      }
      throw fault;
    }
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
    dataSource.assertHealthy?.();
    result = { status: "valid" };
  } catch (e: unknown) {
    try {
      dataSource.assertHealthy?.();
      ({ result, origin } = classifyResult(
        e,
        isFinal,
        dataSource.diagnostics ?? portableDiagnostics,
      ));
    } catch (fault) {
      // Abort the active case, but never mark it interesting or retry completion.
      try {
        dataSource.markComplete(Status.INVALID, null);
      } catch (completionError) {
        throw new AggregateError(
          [fault, completionError],
          "Engine failure during case completion",
          { cause: completionError },
        );
      }
      throw fault;
    }
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

function databaseKey(testFn: (tc: TestCase) => unknown): string {
  return testFn.toString();
}

function configureSettings(
  lib: Engine,
  ctx: ContextHandle,
  settings: SettingsHandle,
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

/** Preserve the pending failure while attempting every destructor in ownership order. */
function finishCleanup(errors: unknown[], ...operations: (() => void)[]): void {
  for (const operation of operations) {
    try {
      operation();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Hegel run cleanup failed");
}

export class Hegel {
  private testFn: (tc: TestCase) => void | Promise<void>;
  private _settings: Settings;
  private _testLocation: TestLocation | null = null;

  constructor(
    testFn: (tc: TestCase) => void | Promise<void>,
    private readonly runtime: RuntimeServices,
  ) {
    this.testFn = testFn;
    this._settings = runtime.defaultSettings();
  }

  /** Override default settings. Returns this for chaining. */
  settings(s: Partial<Settings>): this {
    Object.assign(this._settings, s);
    return this;
  }

  /** Set the test location for Antithesis integration. */
  testLocation(location: TestLocation): this {
    this._testLocation = location;
    return this;
  }

  /**
   * Generator that drives the libhegel run loop, yielding a
   * {@link EngineDataSource} (plus an `isFinal` flag) for each test case the
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
  private *runSteps(): Generator<{ ds: EngineDataSource; isFinal: boolean }, void, TestCaseResult> {
    this.runtime.validateSettings(this._settings);
    const lib = this.runtime.getEngine();
    const ctx = lib.newContext();
    const contextErrors: unknown[] = [];
    try {
      const settings = lib.newSettings(ctx);
      const cache = new StringGeneratorCache(lib);
      const settingsErrors: unknown[] = [];
      try {
        configureSettings(lib, ctx, settings, this._settings, this.testFn);
        const run = lib.runStart(ctx, settings);
        const runErrors: unknown[] = [];
        try {
          for (;;) {
            const tc = lib.nextTestCase(ctx, run);
            if (tc === null) break;
            const ds = new EngineDataSource(lib, ctx, tc, cache, this.runtime, false);
            try {
              yield { ds, isFinal: false };
            } finally {
              finishCleanup(
                [],
                () => ds.dispose(),
                () => lib.freeTestCase(tc),
              );
            }
          }

          const result = lib.runResult(ctx, run);
          const resultErrors: unknown[] = [];
          try {
            const status = lib.runStatus(result);

            if (this._testLocation) {
              this.runtime.emitAntithesisAssertion(this._testLocation, status === RunStatus.PASSED);
            }

            if (status === RunStatus.PASSED) {
              return;
            }
            if (status === RunStatus.ERROR) {
              throw new EngineError(String(lib.runError(result)));
            }
            if (status === RunStatus.FAILED_NONDETERMINISTIC) {
              throw new Error(
                "Hegel reported a nondeterministic failure; deterministic replay is unavailable.",
              );
            }
            if (status !== RunStatus.FAILED) {
              throw new EngineError(`Unknown Hegel run status: ${status}`);
            }
            // RunStatus.FAILED: replay each distinct counterexample's blob as a
            // final, client-owned case. A genuine counterexample re-fails on replay,
            // so the body throws its own error again — captured here for the message.
            const count = lib.failureCount(result);
            const origins: string[] = [];
            let finalError: unknown = null;
            for (let i = 0; i < count; i++) {
              const failure = lib.failure(result, i);
              let blob: string | null = null;
              const failureErrors: unknown[] = [];
              try {
                origins.push(lib.failureOrigin(failure));
                blob = lib.reproductionBlob(failure);
              } catch (error) {
                failureErrors.push(error);
              } finally {
                finishCleanup(failureErrors, () => lib.freeFailure(failure));
              }
              if (blob === null)
                throw new EngineError(
                  "Hegel failure has no reproduction blob; deterministic replay is unavailable",
                );
              const replayTc = lib.testCaseFromBlob(ctx, settings, blob);
              const ds = new EngineDataSource(lib, ctx, replayTc, cache, this.runtime, false);
              const replayErrors: unknown[] = [];
              try {
                const replay = yield { ds, isFinal: true };
                if (replay.status !== "interesting") {
                  throw new Error(
                    `Hegel failure did not reproduce during final replay (status: ${replay.status})`,
                  );
                }
                finalError = replay.error;
              } catch (error) {
                replayErrors.push(error);
              } finally {
                finishCleanup(
                  replayErrors,
                  () => ds.dispose(),
                  () => lib.freeTestCase(replayTc),
                );
              }
            }
            const detail = finalError instanceof Error ? finalError.message : String(finalError);
            throw new Error(`${detail} [${origins.join("; ")}]`);
          } catch (error) {
            resultErrors.push(error);
          } finally {
            finishCleanup(resultErrors, () => lib.freeRunResult(result));
          }
        } catch (error) {
          runErrors.push(error);
        } finally {
          finishCleanup(runErrors, () => lib.freeRun(run));
        }
      } catch (error) {
        settingsErrors.push(error);
      } finally {
        finishCleanup(
          settingsErrors,
          () => cache.dispose(),
          () => lib.freeSettings(settings),
        );
      }
    } catch (error) {
      contextErrors.push(error);
    } finally {
      finishCleanup(contextErrors, () => lib.freeContext(ctx));
    }
  }

  async run(): Promise<void> {
    const gen = this.runSteps();
    const errors: unknown[] = [];
    try {
      let next = gen.next();
      while (!next.done) {
        const { ds, isFinal } = next.value;
        const result = await runTestCaseAsync(ds, this.testFn, isFinal);
        next = gen.next(result);
      }
    } catch (error) {
      errors.push(error);
    } finally {
      finishCleanup(errors, () => {
        gen.return();
      });
    }
  }

  runSync(): void {
    const gen = this.runSteps();
    const errors: unknown[] = [];
    try {
      let next = gen.next();
      while (!next.done) {
        const { ds, isFinal } = next.value;
        const result = runTestCase(ds, this.testFn as (tc: TestCase) => void, isFinal);
        next = gen.next(result);
      }
    } catch (error) {
      errors.push(error);
    } finally {
      finishCleanup(errors, () => {
        gen.return();
      });
    }
  }
}

/** Compose the same synchronous and asynchronous drivers with a runtime. */
export interface Runner {
  test(testFn: (tc: TestCase) => void, settings?: Partial<Settings>): void;
  testAsync(
    testFn: (tc: TestCase) => void | Promise<void>,
    settings?: Partial<Settings>,
  ): Promise<void>;
  Hegel: new (testFn: (tc: TestCase) => void | Promise<void>) => Hegel;
}

export function createRunner(runtime: RuntimeServices): Runner {
  class RuntimeHegel extends Hegel {
    constructor(testFn: (tc: TestCase) => void | Promise<void>) {
      super(testFn, runtime);
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
  function test(testFn: (tc: TestCase) => void, settings?: Partial<Settings>): void {
    if (testFn.constructor.name === "AsyncFunction") {
      throw new TypeError("hegel.test received an async test body. Use hegel.testAsync instead.");
    }
    const h = new RuntimeHegel(testFn);
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
  async function testAsync(
    testFn: (tc: TestCase) => void | Promise<void>,
    settings?: Partial<Settings>,
  ): Promise<void> {
    const h = new RuntimeHegel(testFn);
    if (settings) h.settings(settings);
    await h.run();
  }

  return { test, testAsync, Hegel: RuntimeHegel };
}
