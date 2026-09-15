import {
  EngineError,
  type Engine,
  type ContextHandle,
  type SettingsHandle,
  type RunHandle,
  type RunResultHandle,
  type TestCaseHandle,
  type FailureHandle,
  type CollectionHandle,
  type StringGeneratorHandle,
  type NativeDate,
  type NativeTime,
  type NativeDatetime,
  type NativeFloatOptions,
  type TextGeneratorOptions,
  type UuidVersion,
} from "../engine.js";
import { AssumeError, StopTestError } from "../testCase.js";
import { bigIntToTwosComplementLE, twosComplementLEToBigInt } from "../bytes.js";
import { wtf8ToString } from "../wtf8.js";
import { WasmAbi, u32, u64, type Operation, type Argument } from "./abi.js";
import { WasmArena, WasmMemory } from "./arena.js";

const UINT64_MAX = 0xffffffffffffffffn;

export class WasmEngine implements Engine {
  private readonly handles = new WeakMap<object, number>();
  private readonly memory: WasmMemory;

  constructor(private readonly abi: WasmAbi) {
    this.memory = new WasmMemory(abi.memory);
  }

  private ptr(handle: object): number {
    const ptr = this.handles.get(handle);
    if (ptr === undefined) throw new EngineError("Foreign, freed or invalid Wasm handle");
    this.memory.bytes(ptr, 1);
    return ptr;
  }

  private owned<H>(ptr: number): H {
    if (ptr === 0) throw new EngineError("Wasm engine returned a null owned handle");
    this.memory.bytes(ptr, 1);
    const handle = Object.freeze({});
    this.handles.set(handle, ptr);
    return handle as H;
  }

  private check(ctx: number, op: Operation, args: Argument[], control = false): void {
    const code = this.abi.call(op, ...args);
    if (code === 0) return;
    if (control && code === -1) throw new StopTestError();
    if (control && code === -2) throw new AssumeError();
    // Copy before the arena or an owned handle can be released.
    const message =
      ctx === 0 ? "" : this.memory.cString(this.abi.call("context_last_error", ctx) >>> 0);
    throw new EngineError(`hegel_${op} failed (${code})${message ? `: ${message}` : ""}`);
  }

  private output<T>(
    ctx: number,
    op: Operation,
    args: Argument[],
    size: number,
    align: number,
    read: (arena: WasmArena, ptr: number) => T,
    control = false,
  ): T {
    return WasmArena.scoped(this.abi, (arena) => {
      const out = arena.alloc(size, align);
      this.check(ctx, op, [...args, out], control);
      return read(arena, out);
    });
  }

  private handle<H>(ctx: number, op: Operation, args: Argument[], control = false): H {
    return this.output(ctx, op, args, 4, 4, (a, p) => this.owned<H>(a.pointer(p)), control);
  }

  private free(op: Operation, handle: object): void {
    const ptr = this.ptr(handle);
    this.check(0, op, [0, ptr]);
    this.handles.delete(handle);
  }

  private string(op: Operation, args: Argument[]): string | null {
    return this.output(0, op, args, 4, 4, (a, p) => a.cString(a.pointer(p)));
  }

  version(): string {
    const value = this.string("version", [0]);
    if (value === null) throw new EngineError("Wasm version string is null");
    return value;
  }
  newContext(): ContextHandle {
    return this.owned(this.abi.call("context_new") >>> 0);
  }
  freeContext(ctx: ContextHandle): void {
    this.check(0, "context_free", [this.ptr(ctx)]);
    this.handles.delete(ctx);
  }
  lastError(ctx: ContextHandle): string {
    return this.memory.cString(this.abi.call("context_last_error", this.ptr(ctx)) >>> 0) ?? "";
  }
  newSettings(): SettingsHandle {
    return this.handle(0, "settings_new", [0]);
  }
  freeSettings(s: SettingsHandle): void {
    this.free("settings_free", s);
  }
  setTestCases(s: SettingsHandle, n: number): void {
    this.check(0, "settings_set_test_cases", [0, this.ptr(s), u64(n)]);
  }
  setVerbosity(s: SettingsHandle, v: number): void {
    this.check(0, "settings_set_verbosity", [0, this.ptr(s), u32(v)]);
  }
  setSeed(s: SettingsHandle, seed: bigint): void {
    this.check(0, "settings_set_seed", [0, this.ptr(s), u64(seed), 1]);
  }
  setDerandomize(s: SettingsHandle, on: boolean): void {
    this.check(0, "settings_set_derandomize", [0, this.ptr(s), +on]);
  }
  setDatabase(ctx: ContextHandle, s: SettingsHandle, db: string | null): void {
    if (db !== null && db !== "")
      throw new EngineError("Filesystem databases are not supported in the browser");
    WasmArena.scoped(this.abi, (a) => {
      const c = this.ptr(ctx);
      this.check(c, "settings_set_database", [c, this.ptr(s), a.utf8CString("")]);
    });
  }
  setDatabaseKey(ctx: ContextHandle, s: SettingsHandle, key: string): void {
    WasmArena.scoped(this.abi, (a) => {
      const c = this.ptr(ctx);
      this.check(c, "settings_set_database_key", [c, this.ptr(s), a.utf8CString(key)]);
    });
  }
  setSuppressHealthCheck(s: SettingsHandle, checks: number): void {
    this.check(0, "settings_set_suppress_health_check", [0, this.ptr(s), u32(checks)]);
  }
  setReportMultipleFailures(s: SettingsHandle, yes: boolean): void {
    this.check(0, "settings_set_report_multiple_failures", [0, this.ptr(s), +yes]);
  }
  runStart(ctx: ContextHandle, settings: SettingsHandle): RunHandle {
    const c = this.ptr(ctx);
    return this.handle(c, "run_start", [c, this.ptr(settings), 0, 0]);
  }
  nextTestCase(ctx: ContextHandle, run: RunHandle): TestCaseHandle | null {
    const c = this.ptr(ctx);
    return this.output(c, "next_test_case", [c, this.ptr(run)], 4, 4, (a, p) => {
      const ptr = a.pointer(p);
      return ptr === 0 ? null : this.owned<TestCaseHandle>(ptr);
    });
  }
  runResult(ctx: ContextHandle, run: RunHandle): RunResultHandle {
    const c = this.ptr(ctx);
    return this.handle(c, "run_result", [c, this.ptr(run)]);
  }
  freeRunResult(r: RunResultHandle): void {
    this.free("run_result_free", r);
  }
  freeRun(run: RunHandle): void {
    this.free("run_free", run);
  }
  testCaseFromBlob(
    ctx: ContextHandle,
    settings: SettingsHandle,
    blob: string | null,
  ): TestCaseHandle {
    return WasmArena.scoped(this.abi, (a) => {
      const c = this.ptr(ctx);
      return this.handle(c, "test_case_from_blob", [
        c,
        this.ptr(settings),
        a.utf8CString(blob),
        0,
        0,
      ]);
    });
  }
  freeTestCase(tc: TestCaseHandle): void {
    this.free("test_case_free", tc);
  }

  generateBoolean(ctx: ContextHandle, tc: TestCaseHandle, p: number): boolean {
    const c = this.ptr(ctx);
    return this.output(
      c,
      "generate_boolean",
      [c, this.ptr(tc), p, 0, 0],
      1,
      1,
      (a, p) => a.boolean(p),
      true,
    );
  }
  generateInteger(ctx: ContextHandle, tc: TestCaseHandle, min: bigint, max: bigint): bigint {
    if (min < -0x8000000000000000n || max > 0x7fffffffffffffffn || min > max) {
      throw new EngineError("Invalid signed i64 bounds");
    }
    const c = this.ptr(ctx);
    return this.output(
      c,
      "generate_integer",
      [c, this.ptr(tc), min, max],
      8,
      8,
      (a, p) => a.view(p, 8).getBigInt64(0, true),
      true,
    );
  }
  generateIntegerBig(ctx: ContextHandle, tc: TestCaseHandle, min: bigint, max: bigint): bigint {
    return WasmArena.scoped(this.abi, (a) => {
      const lo = bigIntToTwosComplementLE(min),
        hi = bigIntToTwosComplementLE(max);
      const capacity = Math.max(lo.length, hi.length);
      const out = a.alloc(capacity),
        length = a.alloc(4, 4);
      const c = this.ptr(ctx);
      this.check(
        c,
        "generate_integer_big",
        [c, this.ptr(tc), a.input(lo), lo.length, a.input(hi), hi.length, out, capacity, length],
        true,
      );
      const written = a.pointer(length);
      if (written === 0 || written > capacity)
        throw new EngineError("Invalid big integer result length");
      return twosComplementLEToBigInt(a.bytes(out, written));
    });
  }
  generateFloat(ctx: ContextHandle, tc: TestCaseHandle, opts: NativeFloatOptions): number {
    const c = this.ptr(ctx);
    return this.output(
      c,
      "generate_float",
      [
        c,
        this.ptr(tc),
        u32(opts.width),
        opts.minValue,
        opts.maxValue,
        +opts.allowNan,
        +opts.allowInfinity,
        +opts.excludeMin,
        +opts.excludeMax,
        opts.smallestNonzeroMagnitude,
      ],
      8,
      8,
      (a, p) => a.view(p, 8).getFloat64(0, true),
      true,
    );
  }

  private buffer<T>(
    ctx: number,
    op: "generate_bytes" | "generate_string",
    args: Argument[],
    decode: (bytes: Uint8Array) => T,
  ): T {
    return WasmArena.scoped(this.abi, (a) => {
      const out = a.alloc(8, 4);
      this.check(ctx, op, [...args, out], true);
      let result!: T;
      let failure: unknown;
      let failed = false;
      try {
        const data = a.pointer(out),
          length = a.pointer(out + 4);
        if (data === 0) throw new EngineError("Wasm returned a null generated buffer");
        result = decode(a.bytes(data, length).slice());
      } catch (error) {
        failed = true;
        failure = error;
      } finally {
        try {
          this.check(0, `${op}_result_free`, [0, out]);
        } catch (cleanup) {
          failure = failed
            ? new EngineError("Wasm buffer copy and release failed", {
                cause: new AggregateError([failure, cleanup]),
              })
            : cleanup;
          failed = true;
        }
      }
      if (failed) throw failure;
      return result;
    });
  }
  generateBytes(
    ctx: ContextHandle,
    tc: TestCaseHandle,
    minSize: number,
    maxSize?: number,
  ): Uint8Array {
    const c = this.ptr(ctx);
    return this.buffer(
      c,
      "generate_bytes",
      [c, this.ptr(tc), u64(minSize), maxSize === undefined ? UINT64_MAX : u64(maxSize)],
      (bytes) => bytes,
    );
  }
  generateString(ctx: ContextHandle, tc: TestCaseHandle, generator: StringGeneratorHandle): string {
    const c = this.ptr(ctx);
    return this.buffer(c, "generate_string", [c, this.ptr(tc), this.ptr(generator)], wtf8ToString);
  }
  stringGeneratorText(ctx: ContextHandle, opts: TextGeneratorOptions): StringGeneratorHandle {
    return WasmArena.scoped(this.abi, (a) => {
      const c = this.ptr(ctx);
      return this.handle(c, "string_generator_text", [
        c,
        u64(opts.minSize),
        u64(opts.maxSize),
        a.utf8CString(opts.codec),
        u32(opts.minCodepoint),
        u32(opts.maxCodepoint),
        a.stringList(opts.categories),
        opts.categories?.length ?? 0,
        a.stringList(opts.excludeCategories),
        opts.excludeCategories?.length ?? 0,
        a.input(opts.includeCharacters),
        opts.includeCharacters?.length ?? 0,
        a.input(opts.excludeCharacters),
        opts.excludeCharacters?.length ?? 0,
      ]);
    });
  }
  stringGeneratorRegex(
    ctx: ContextHandle,
    pattern: string,
    fullmatch: boolean,
  ): StringGeneratorHandle {
    return WasmArena.scoped(this.abi, (a) => {
      const c = this.ptr(ctx);
      return this.handle(c, "string_generator_regex", [c, a.utf8CString(pattern), +fullmatch, 0]);
    });
  }
  stringGeneratorEmail(ctx: ContextHandle): StringGeneratorHandle {
    const c = this.ptr(ctx);
    return this.handle(c, "string_generator_email", [c]);
  }
  stringGeneratorUrl(ctx: ContextHandle): StringGeneratorHandle {
    const c = this.ptr(ctx);
    return this.handle(c, "string_generator_url", [c]);
  }
  stringGeneratorDomain(ctx: ContextHandle, maxLength: number): StringGeneratorHandle {
    const c = this.ptr(ctx);
    return this.handle(c, "string_generator_domain", [c, u64(maxLength)]);
  }
  freeStringGenerator(generator: StringGeneratorHandle): void {
    this.free("string_generator_free", generator);
  }

  // These three by-value C inputs lower to pointers in the pinned raw artifact.
  // Reinspect signatures and fixed-value tests before changing its source/toolchain.
  private temporal<T>(
    ctx: ContextHandle,
    tc: TestCaseHandle,
    op: Operation,
    min: T,
    max: T,
    size: number,
    write: (view: DataView, value: T) => void,
    read: (view: DataView) => T,
  ): T {
    return WasmArena.scoped(this.abi, (a) => {
      const lo = a.alloc(size, 4),
        hi = a.alloc(size, 4),
        out = a.alloc(size, 4);
      write(a.view(lo, size), min);
      write(a.view(hi, size), max);
      const c = this.ptr(ctx);
      this.check(c, op, [c, this.ptr(tc), lo, hi, out], true);
      return read(a.view(out, size));
    });
  }
  generateDate(
    ctx: ContextHandle,
    tc: TestCaseHandle,
    min: NativeDate,
    max: NativeDate,
  ): NativeDate {
    return this.temporal(ctx, tc, "generate_date", min, max, 8, writeDate, readDate);
  }
  generateTime(
    ctx: ContextHandle,
    tc: TestCaseHandle,
    min: NativeTime,
    max: NativeTime,
  ): NativeTime {
    return this.temporal(ctx, tc, "generate_time", min, max, 8, writeTime, readTime);
  }
  generateDatetime(
    ctx: ContextHandle,
    tc: TestCaseHandle,
    min: NativeDatetime,
    max: NativeDatetime,
  ): NativeDatetime {
    return this.temporal(
      ctx,
      tc,
      "generate_datetime",
      min,
      max,
      16,
      (view, value) => {
        writeDate(view, value.date);
        writeTime(view, value.time, 8);
      },
      (view) => ({ date: readDate(view), time: readTime(view, 8) }),
    );
  }
  generateUuid(ctx: ContextHandle, tc: TestCaseHandle, version?: UuidVersion): Uint8Array {
    const c = this.ptr(ctx);
    return this.output(
      c,
      "generate_uuid",
      [c, this.ptr(tc), version === undefined ? 0 : u32(version), +(version !== undefined)],
      16,
      1,
      (a, p) => a.bytes(p, 16).slice(),
      true,
    );
  }
  generateIpv4(ctx: ContextHandle, tc: TestCaseHandle): Uint8Array {
    const c = this.ptr(ctx);
    return this.output(
      c,
      "generate_ipv4",
      [c, this.ptr(tc)],
      4,
      1,
      (a, p) => a.bytes(p, 4).slice(),
      true,
    );
  }
  generateIpv6(ctx: ContextHandle, tc: TestCaseHandle): Uint8Array {
    const c = this.ptr(ctx);
    return this.output(
      c,
      "generate_ipv6",
      [c, this.ptr(tc)],
      16,
      1,
      (a, p) => a.bytes(p, 16).slice(),
      true,
    );
  }
  startSpan(ctx: ContextHandle, tc: TestCaseHandle, label: number): void {
    const c = this.ptr(ctx);
    this.check(c, "start_span", [c, this.ptr(tc), u64(label)], true);
  }
  stopSpan(ctx: ContextHandle, tc: TestCaseHandle, discard: boolean): void {
    const c = this.ptr(ctx);
    this.check(c, "stop_span", [c, this.ptr(tc), +discard], true);
  }
  newCollection(
    ctx: ContextHandle,
    tc: TestCaseHandle,
    min: number,
    max?: number,
  ): CollectionHandle {
    const c = this.ptr(ctx);
    return this.handle(
      c,
      "new_collection",
      [c, this.ptr(tc), u64(min), max === undefined ? UINT64_MAX : u64(max)],
      true,
    );
  }
  collectionMore(ctx: ContextHandle, tc: TestCaseHandle, collection: CollectionHandle): boolean {
    const c = this.ptr(ctx);
    return this.output(
      c,
      "collection_more",
      [c, this.ptr(tc), this.ptr(collection)],
      1,
      1,
      (a, p) => a.boolean(p),
      true,
    );
  }
  collectionReject(
    ctx: ContextHandle,
    tc: TestCaseHandle,
    collection: CollectionHandle,
    why: string | null,
  ): void {
    WasmArena.scoped(this.abi, (a) => {
      const c = this.ptr(ctx);
      this.check(
        c,
        "collection_reject",
        [c, this.ptr(tc), this.ptr(collection), a.utf8CString(why)],
        true,
      );
    });
  }
  freeCollection(collection: CollectionHandle): void {
    this.free("collection_free", collection);
  }
  markComplete(
    ctx: ContextHandle,
    tc: TestCaseHandle,
    status: number,
    origin: string | null,
  ): void {
    WasmArena.scoped(this.abi, (a) => {
      const c = this.ptr(ctx);
      this.check(c, "mark_complete", [c, this.ptr(tc), u32(status), a.utf8CString(origin)]);
    });
  }
  runStatus(r: RunResultHandle): number {
    return this.output(0, "run_result_status", [0, this.ptr(r)], 4, 4, (a, p) =>
      a.view(p, 4).getInt32(0, true),
    );
  }
  runError(r: RunResultHandle): string | null {
    return this.string("run_result_error", [0, this.ptr(r)]);
  }
  failureCount(r: RunResultHandle): number {
    return this.output(0, "run_result_failure_count", [0, this.ptr(r)], 4, 4, (a, p) =>
      a.pointer(p),
    );
  }
  failure(r: RunResultHandle, index: number): FailureHandle {
    return this.handle(0, "run_result_failure", [0, this.ptr(r), u32(index)]);
  }
  freeFailure(f: FailureHandle): void {
    this.free("failure_free", f);
  }
  failureOrigin(fp: FailureHandle): string {
    const value = this.string("failure_origin", [0, this.ptr(fp)]);
    if (value === null) throw new EngineError("Wasm failure origin is null");
    return value;
  }
  reproductionBlob(fp: FailureHandle): string | null {
    return this.string("failure_reproduction_blob", [0, this.ptr(fp)]);
  }
}

function integer(value: number, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new EngineError("Invalid temporal field");
  return value;
}
function writeDate(view: DataView, date: NativeDate): void {
  view.setInt32(0, integer(date.year, -0x80000000, 0x7fffffff), true);
  view.setUint8(4, integer(date.month, 1, 12));
  view.setUint8(5, integer(date.day, 1, 31));
}
function readDate(view: DataView): NativeDate {
  return {
    year: view.getInt32(0, true),
    month: integer(view.getUint8(4), 1, 12),
    day: integer(view.getUint8(5), 1, 31),
  };
}
function writeTime(view: DataView, time: NativeTime, offset = 0): void {
  view.setUint8(offset, integer(time.hour, 0, 23));
  view.setUint8(offset + 1, integer(time.minute, 0, 59));
  view.setUint8(offset + 2, integer(time.second, 0, 59));
  view.setUint32(offset + 4, integer(time.nanosecond, 0, 999999999), true);
}
function readTime(view: DataView, offset = 0): NativeTime {
  return {
    hour: integer(view.getUint8(offset), 0, 23),
    minute: integer(view.getUint8(offset + 1), 0, 59),
    second: integer(view.getUint8(offset + 2), 0, 59),
    nanosecond: integer(view.getUint32(offset + 4, true), 0, 999999999),
  };
}
