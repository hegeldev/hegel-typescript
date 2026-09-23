import { EngineError } from "../engine.js";

// Exact raw-module signatures of the pinned release's Wasm module; audit them
// against hegel.h on every engine bump. I = i32, L = i64, D = f64. JS arity
// checks cannot verify Wasm types.
export const signatures = {
  context_new: "",
  context_free: "I",
  context_last_error: "I",
  settings_new: "II",
  settings_free: "II",
  settings_set_test_cases: "IIL",
  settings_set_verbosity: "III",
  settings_set_seed: "IILI",
  settings_set_derandomize: "III",
  settings_set_database: "III",
  settings_set_database_key: "III",
  settings_set_suppress_health_check: "III",
  settings_set_report_multiple_failures: "III",
  run_start: "IIIII",
  next_test_case: "III",
  run_result: "III",
  run_result_free: "II",
  run_free: "II",
  test_case_from_blob: "IIIIII",
  test_case_free: "II",
  generate_boolean: "IIDIII",
  generate_integer: "IILLI",
  generate_integer_big: "IIIIIIIII",
  generate_float: "IIIDDIIIIDI",
  generate_bytes: "IILLI",
  generate_bytes_result_free: "II",
  string_generator_text: "ILLIIIIIIIIIIII",
  string_generator_regex: "IIIII",
  string_generator_email: "II",
  string_generator_url: "II",
  string_generator_domain: "ILI",
  string_generator_free: "II",
  generate_string: "IIII",
  generate_string_result_free: "II",
  generate_date: "IIIII",
  generate_time: "IIIII",
  generate_datetime: "IIIII",
  generate_uuid: "IIIII",
  generate_ipv4: "III",
  generate_ipv6: "III",
  start_span: "IIL",
  stop_span: "III",
  new_collection: "IILLI",
  collection_more: "IIII",
  collection_reject: "IIII",
  collection_free: "II",
  mark_complete: "IIII",
  run_result_status: "III",
  run_result_error: "III",
  run_result_failure_count: "III",
  run_result_failure: "IIII",
  failure_free: "II",
  failure_origin: "III",
  failure_reproduction_blob: "III",
  version: "II",
} as const;

export type Operation = keyof typeof signatures;
export type Argument = number | bigint;
export type RawFunction = (...args: Argument[]) => number;

export interface Allocator {
  memory: WebAssembly.Memory;
  alloc(size: number, align: number): number;
  dealloc(ptr: number, size: number, align: number): void;
}

export function u32(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new EngineError(`Invalid wasm32 unsigned integer: ${value}`);
  }
  return value;
}

export function u64(value: number | bigint): bigint {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) {
    throw new EngineError(`Invalid u64 integer: ${value}`);
  }
  const result = BigInt(value);
  if (result < 0n || result > 0xffffffffffffffffn) {
    throw new EngineError(`Invalid u64 integer: ${value}`);
  }
  return result;
}

export class WasmAbi implements Allocator {
  readonly memory: WebAssembly.Memory;
  private readonly functions: Record<Operation, RawFunction>;
  private readonly allocate: RawFunction;
  private readonly deallocate: RawFunction;

  constructor(exports: WebAssembly.Exports) {
    if (!(exports.memory instanceof WebAssembly.Memory)) {
      throw new EngineError("Wasm export memory is missing or invalid");
    }
    this.memory = exports.memory;
    const requireFunction = (name: string, arity: number): RawFunction => {
      const value = exports[name];
      if (typeof value !== "function" || value.length !== arity) {
        throw new EngineError(`Missing or incompatible Wasm export ${name}`);
      }
      return value as RawFunction;
    };
    this.allocate = requireFunction("hegel_alloc", 2);
    this.deallocate = requireFunction("hegel_dealloc", 3);
    this.functions = Object.fromEntries(
      Object.entries(signatures).map(([name, signature]) => [
        name,
        requireFunction(`hegel_${name}`, signature.length),
      ]),
    ) as Record<Operation, RawFunction>;
  }

  private invoke(fn: RawFunction, args: Argument[]): number {
    try {
      return fn(...args);
    } catch (cause) {
      throw new EngineError("Wasm engine call trapped", { cause });
    }
  }

  call(op: Operation, ...args: Argument[]): number {
    const signature = signatures[op];
    if (args.length !== signature.length) throw new EngineError(`Invalid arity for ${op}`);
    args.forEach((value, i) => {
      const type = signature[i];
      const valid =
        type === "L"
          ? typeof value === "bigint" &&
            value >= -0x8000000000000000n &&
            value <= 0xffffffffffffffffn
          : typeof value === "number" &&
            (type === "D" ||
              (Number.isInteger(value) && value >= -0x80000000 && value <= 0xffffffff));
      if (!valid) throw new EngineError(`Invalid ${type} argument ${i} for ${op}`);
    });
    const result = this.invoke(this.functions[op], args);
    if (!Number.isInteger(result) || result < -0x80000000 || result > 0x7fffffff) {
      throw new EngineError(`Invalid i32 result from ${op}`);
    }
    return result;
  }

  alloc(size: number, align: number): number {
    const result = this.invoke(this.allocate, [size, align]);
    if (!Number.isInteger(result) || result < -0x80000000 || result > 0x7fffffff) {
      throw new EngineError("Invalid Wasm allocation pointer");
    }
    return result >>> 0;
  }

  dealloc(ptr: number, size: number, align: number): void {
    this.invoke(this.deallocate, [ptr, size, align]);
  }
}
