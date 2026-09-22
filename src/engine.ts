/** Copied values and opaque ownership handles shared by native and Wasm adapters. */
declare const contextBrand: unique symbol;
export type ContextHandle = { readonly [contextBrand]: never };

declare const settingsBrand: unique symbol;
export type SettingsHandle = { readonly [settingsBrand]: never };

declare const runBrand: unique symbol;
export type RunHandle = { readonly [runBrand]: never };

declare const runResultBrand: unique symbol;
export type RunResultHandle = { readonly [runResultBrand]: never };

declare const failureBrand: unique symbol;
export type FailureHandle = { readonly [failureBrand]: never };

declare const testCaseBrand: unique symbol;
export type TestCaseHandle = { readonly [testCaseBrand]: never };

declare const collectionBrand: unique symbol;
export type CollectionHandle = { readonly [collectionBrand]: never };

declare const stringGeneratorBrand: unique symbol;
export type StringGeneratorHandle = { readonly [stringGeneratorBrand]: never };

declare const poolBrand: unique symbol;
export type PoolHandle = { readonly [poolBrand]: never };

declare const stateMachineBrand: unique symbol;
export type StateMachineHandle = { readonly [stateMachineBrand]: never };

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
  FAILED_NONDETERMINISTIC: 3,
} as const;

/** `hegel_verbosity_t`. */
export const NativeVerbosity = {
  NORMAL: 0,
  QUIET: 1,
  VERBOSE: 2,
  DEBUG: 3,
} as const;

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

/** RFC 4122 UUID versions supported by the public generator. */
export type UuidVersion = 1 | 2 | 3 | 4 | 5;

/** Options for `hegel_string_generator_text`. */
export interface TextGeneratorOptions {
  minSize: number;
  maxSize: bigint;
  codec: string | null;
  minCodepoint: number;
  maxCodepoint: number;
  categories: readonly string[] | null;
  excludeCategories: readonly string[] | null;
  includeCharacters: Uint8Array | null;
  excludeCharacters: Uint8Array | null;
}

/** Options for `hegel_generate_float`. */
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

/**
 * Options for `hegel_new_state_machine`. `ruleGroups` and
 * `invariantAlwaysCheck` are parallel to `ruleNames` / `invariantNames`.
 */
export interface StateMachineOptions {
  ruleNames: readonly string[];
  ruleGroups: readonly number[];
  invariantNames: readonly string[];
  invariantAlwaysCheck: readonly boolean[];
  minConcurrency: number;
  maxConcurrency: number;
  stepCount: number;
}

/**
 * `HEGEL_STATE_MACHINE_DONE` (`INT64_MIN`): the sentinel
 * `hegel_state_machine_next_group` / `hegel_state_machine_next_rule` write
 * instead of a group / rule index once the machine (or the worker's round) is
 * finished.
 */
export const STATE_MACHINE_DONE = -0x8000000000000000n;

/**
 * Decode an `int64_t` written by the state-machine calls: `null` for the
 * `HEGEL_STATE_MACHINE_DONE` sentinel, the (small, non-negative) index
 * otherwise.
 */
export function doneOrIndex(value: number | bigint): number | null {
  return BigInt(value) === STATE_MACHINE_DONE ? null : Number(value);
}

/** Engine/adapter faults must never be submitted to the shrinker. */
export class EngineError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EngineError";
  }
}

export interface Engine {
  version(): string;
  newContext(): ContextHandle;
  freeContext(ctx: ContextHandle): void;
  lastError(ctx: ContextHandle): string;
  /**
   * Create a settings handle initialized from the engine's default profile.
   * Fallible: the engine reports an unknown `HEGEL_DEFAULT_PROFILE` or a
   * malformed `hegel.toml` through `ctx`.
   */
  newSettings(ctx: ContextHandle): SettingsHandle;
  freeSettings(s: SettingsHandle): void;
  setTestCases(s: SettingsHandle, n: number): void;
  setVerbosity(s: SettingsHandle, v: number): void;
  setSeed(s: SettingsHandle, seed: bigint): void;
  setDerandomize(s: SettingsHandle, on: boolean): void;
  setDatabase(ctx: ContextHandle, s: SettingsHandle, db: string | null): void;
  setDatabaseKey(ctx: ContextHandle, s: SettingsHandle, key: string): void;
  setSuppressHealthCheck(s: SettingsHandle, checks: number): void;
  setReportMultipleFailures(s: SettingsHandle, yes: boolean): void;
  runStart(ctx: ContextHandle, settings: SettingsHandle): RunHandle;
  nextTestCase(ctx: ContextHandle, run: RunHandle): TestCaseHandle | null;
  runResult(ctx: ContextHandle, run: RunHandle): RunResultHandle;
  freeRunResult(r: RunResultHandle): void;
  freeRun(run: RunHandle): void;
  testCaseFromBlob(
    ctx: ContextHandle,
    settings: SettingsHandle,
    blob: string | null,
  ): TestCaseHandle;
  freeTestCase(tc: TestCaseHandle): void;
  generateBoolean(ctx: ContextHandle, tc: TestCaseHandle, p: number): boolean;
  generateInteger(ctx: ContextHandle, tc: TestCaseHandle, min: bigint, max: bigint): bigint;
  generateIntegerBig(ctx: ContextHandle, tc: TestCaseHandle, min: bigint, max: bigint): bigint;
  generateFloat(ctx: ContextHandle, tc: TestCaseHandle, opts: NativeFloatOptions): number;
  generateBytes(
    ctx: ContextHandle,
    tc: TestCaseHandle,
    minSize: number,
    maxSize?: number,
  ): Uint8Array;
  stringGeneratorText(ctx: ContextHandle, opts: TextGeneratorOptions): StringGeneratorHandle;
  stringGeneratorRegex(
    ctx: ContextHandle,
    pattern: string,
    fullmatch: boolean,
  ): StringGeneratorHandle;
  stringGeneratorEmail(ctx: ContextHandle): StringGeneratorHandle;
  stringGeneratorUrl(ctx: ContextHandle): StringGeneratorHandle;
  stringGeneratorDomain(ctx: ContextHandle, maxLength: number): StringGeneratorHandle;
  generateString(ctx: ContextHandle, tc: TestCaseHandle, generator: StringGeneratorHandle): string;
  generateDate(
    ctx: ContextHandle,
    tc: TestCaseHandle,
    min: NativeDate,
    max: NativeDate,
  ): NativeDate;
  generateTime(
    ctx: ContextHandle,
    tc: TestCaseHandle,
    min: NativeTime,
    max: NativeTime,
  ): NativeTime;
  generateDatetime(
    ctx: ContextHandle,
    tc: TestCaseHandle,
    min: NativeDatetime,
    max: NativeDatetime,
  ): NativeDatetime;
  generateUuid(ctx: ContextHandle, tc: TestCaseHandle, version?: UuidVersion): Uint8Array;
  generateIpv4(ctx: ContextHandle, tc: TestCaseHandle): Uint8Array;
  generateIpv6(ctx: ContextHandle, tc: TestCaseHandle): Uint8Array;
  startSpan(ctx: ContextHandle, tc: TestCaseHandle, label: number): void;
  stopSpan(ctx: ContextHandle, tc: TestCaseHandle, discard: boolean): void;
  newCollection(
    ctx: ContextHandle,
    tc: TestCaseHandle,
    min: number,
    max?: number,
  ): CollectionHandle;
  collectionMore(ctx: ContextHandle, tc: TestCaseHandle, collection: CollectionHandle): boolean;
  collectionReject(
    ctx: ContextHandle,
    tc: TestCaseHandle,
    collection: CollectionHandle,
    why: string | null,
  ): void;
  freeCollection(collection: CollectionHandle): void;
  markComplete(ctx: ContextHandle, tc: TestCaseHandle, status: number, origin: string | null): void;
  /** Open a variable pool for stateful testing; released with {@link freePool}. */
  newPool(ctx: ContextHandle, tc: TestCaseHandle): PoolHandle;
  /** Register a new variable in `pool`, returning its engine-assigned id. */
  poolAdd(ctx: ContextHandle, tc: TestCaseHandle, pool: PoolHandle): bigint;
  /**
   * Draw the id of a variable in `pool`, removing it when `consume` is set.
   * Throws `AssumeError` when the pool is empty.
   */
  poolGenerate(ctx: ContextHandle, tc: TestCaseHandle, pool: PoolHandle, consume: boolean): bigint;
  freePool(pool: PoolHandle): void;
  /**
   * Register a state machine on `tc`; released with {@link freeStateMachine}.
   * The engine's drawn concurrency level is discarded: this client fixes the
   * bounds at 1.
   */
  newStateMachine(
    ctx: ContextHandle,
    tc: TestCaseHandle,
    opts: StateMachineOptions,
  ): StateMachineHandle;
  /**
   * Start the machine's next round, returning the round's group id, or `null`
   * once the machine is finished.
   */
  stateMachineNextGroup(
    ctx: ContextHandle,
    tc: TestCaseHandle,
    machine: StateMachineHandle,
  ): number | null;
  /**
   * Draw the next rule index for `workerIndex` this round, or `null` at the
   * round's join point.
   */
  stateMachineNextRule(
    ctx: ContextHandle,
    tc: TestCaseHandle,
    machine: StateMachineHandle,
    workerIndex: number,
  ): number | null;
  /** Report the rule last handed to `workerIndex` as rejected (assumption failed). */
  stateMachineRuleRejected(
    ctx: ContextHandle,
    tc: TestCaseHandle,
    machine: StateMachineHandle,
    workerIndex: number,
  ): void;
  /** Whether invariant `invariantIndex` should run at the current join point. */
  stateMachineShouldCheckInvariant(
    ctx: ContextHandle,
    tc: TestCaseHandle,
    machine: StateMachineHandle,
    invariantIndex: number,
  ): boolean;
  freeStateMachine(machine: StateMachineHandle): void;
  runStatus(r: RunResultHandle): number;
  runError(r: RunResultHandle): string | null;
  failureCount(r: RunResultHandle): number;
  failure(r: RunResultHandle, index: number): FailureHandle;
  freeFailure(f: FailureHandle): void;
  failureOrigin(fp: FailureHandle): string;
  reproductionBlob(fp: FailureHandle): string | null;
  freeStringGenerator(generator: StringGeneratorHandle): void;
}
