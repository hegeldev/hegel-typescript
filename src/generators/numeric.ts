/**
 * Numeric and boolean generators.
 *
 * @packageDocumentation
 */

import { BasicGenerator } from "./core.js";

// ---------------------------------------------------------------------------
// Integers
// ---------------------------------------------------------------------------

export interface IntegerOptions {
  minValue?: number;
  maxValue?: number;
}

/**
 * Generate integers as JS numbers. Defaults to the safe integer range.
 * Throws if bounds are outside Number.MAX_SAFE_INTEGER.
 * Use bigIntegers() for arbitrary-precision integers.
 */
export function integers(options?: IntegerOptions): BasicGenerator<number> {
  const min = options?.minValue ?? Number.MIN_SAFE_INTEGER;
  const max = options?.maxValue ?? Number.MAX_SAFE_INTEGER;
  if (min > max) throw new Error("Cannot have maxValue < minValue");
  if (min < Number.MIN_SAFE_INTEGER || max > Number.MAX_SAFE_INTEGER) {
    throw new Error(
      "integers() bounds must be within Number.MIN_SAFE_INTEGER..Number.MAX_SAFE_INTEGER. Use bigIntegers() for larger ranges.",
    );
  }
  return new BasicGenerator({ type: "integer", min_value: min, max_value: max }, (raw) => {
    // cbor-x may decode values near the safe integer boundary as BigInt
    if (typeof raw === "bigint") return Number(raw);
    return raw as number;
  });
}

export interface BigIntegerOptions {
  minValue?: bigint;
  maxValue?: bigint;
}

/** Generate arbitrary-precision integers as BigInt. */
export function bigIntegers(options?: BigIntegerOptions): BasicGenerator<bigint> {
  const min = options?.minValue;
  const max = options?.maxValue;
  if (min !== undefined && max !== undefined && min > max) {
    throw new Error("Cannot have maxValue < minValue");
  }
  const schema: Record<string, unknown> = { type: "integer" };
  if (min !== undefined) schema["min_value"] = min;
  if (max !== undefined) schema["max_value"] = max;
  return new BasicGenerator(schema, (raw) => {
    if (typeof raw === "bigint") return raw;
    return BigInt(raw as number);
  });
}

// ---------------------------------------------------------------------------
// Floats
// ---------------------------------------------------------------------------

export interface FloatOptions {
  minValue?: number;
  maxValue?: number;
  excludeMin?: boolean;
  excludeMax?: boolean;
  allowNan?: boolean;
  allowInfinity?: boolean;
}

/**
 * Generate floating-point numbers.
 *
 * By default, NaN is allowed only when no bounds are set, and infinity
 * is allowed when at least one bound is missing.
 */
export function floats(options?: FloatOptions): BasicGenerator<number> {
  const hasMin = options?.minValue !== undefined;
  const hasMax = options?.maxValue !== undefined;
  // NaN only when completely unbounded; infinity when at least one side is open
  const allowNan = options?.allowNan ?? (!hasMin && !hasMax);
  const allowInfinity = options?.allowInfinity ?? (!hasMin || !hasMax);

  const schema: Record<string, unknown> = {
    type: "float",
    width: 64,
    allow_nan: allowNan,
    allow_infinity: allowInfinity,
  };

  if (hasMin) {
    schema["min_value"] = options!.minValue;
    schema["exclude_min"] = options?.excludeMin ?? false;
  }
  if (hasMax) {
    schema["max_value"] = options!.maxValue;
    schema["exclude_max"] = options?.excludeMax ?? false;
  }

  return new BasicGenerator(schema);
}

// ---------------------------------------------------------------------------
// Booleans
// ---------------------------------------------------------------------------

/** Generate boolean values. */
export function booleans(): BasicGenerator<boolean> {
  return new BasicGenerator({ type: "boolean" });
}
