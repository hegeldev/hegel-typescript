/**
 * Numeric and boolean generators.
 *
 * @packageDocumentation
 */

import { TestCase, generateRaw } from "../testCase.js";
import { Generator, BasicGenerator } from "./core.js";

export interface IntegerOptions {
  minValue?: number;
  maxValue?: number;
}

function parseInteger(raw: unknown): number {
  // The schema interpreter hands back BigInt for values outside the safe
  // integer range, which in-range bounds guarantee cannot happen here; the
  // conversion below is for uniformity with hand-rolled DataSources.
  if (typeof raw === "bigint") return Number(raw);
  return raw as number;
}

class IntegersGenerator extends Generator<number> {
  private readonly schema: Record<string, unknown>;

  constructor(options?: IntegerOptions) {
    super();
    const min = options?.minValue ?? Number.MIN_SAFE_INTEGER;
    const max = options?.maxValue ?? Number.MAX_SAFE_INTEGER;
    if (min > max) throw new Error("Cannot have maxValue < minValue");
    if (min < Number.MIN_SAFE_INTEGER || max > Number.MAX_SAFE_INTEGER) {
      throw new Error(
        "integers() bounds must be within Number.MIN_SAFE_INTEGER..Number.MAX_SAFE_INTEGER. Use bigIntegers() for larger ranges.",
      );
    }
    // Encode bounds as BigInt so they always serialize as CBOR integers: the
    // native engine strictly rejects float-encoded integer bounds, and cbor-x
    // encodes plain JS numbers above 2**32 as CBOR floats.
    this.schema = { type: "integer", min_value: BigInt(min), max_value: BigInt(max) };
  }

  doDraw(tc: TestCase): number {
    return parseInteger(generateRaw(tc, this.schema));
  }

  override asBasic(): BasicGenerator<number> {
    return new BasicGenerator(this.schema, parseInteger);
  }
}

/**
 * Generate integers as JS numbers. Defaults to the safe integer range.
 * Throws if bounds are outside Number.MAX_SAFE_INTEGER.
 * Use bigIntegers() for arbitrary-precision integers.
 */
export function integers(options?: IntegerOptions): Generator<number> {
  return new IntegersGenerator(options);
}

export interface BigIntegerOptions {
  minValue?: bigint;
  maxValue?: bigint;
}

function parseBigInt(raw: unknown): bigint {
  if (typeof raw === "bigint") return raw;
  return BigInt(raw as number);
}

// Default bounds for an unbounded bigIntegers() side (signed 128-bit range).
const DEFAULT_BIGINT_MIN = -(2n ** 127n);
const DEFAULT_BIGINT_MAX = 2n ** 127n - 1n;

class BigIntegersGenerator extends Generator<bigint> {
  private readonly schema: Record<string, unknown>;

  constructor(options?: BigIntegerOptions) {
    super();
    const min = options?.minValue;
    const max = options?.maxValue;
    if (min !== undefined && max !== undefined && min > max) {
      throw new Error("Cannot have maxValue < minValue");
    }
    // The native engine requires explicit integer bounds. For an unbounded
    // side, default to the signed 128-bit range: the engine's draw is
    // bit-width-weighted (favoring small magnitudes), so a wide finite range
    // reproduces Hypothesis's unbounded-integer distribution closely.
    this.schema = {
      type: "integer",
      min_value: min ?? DEFAULT_BIGINT_MIN,
      max_value: max ?? DEFAULT_BIGINT_MAX,
    };
  }

  doDraw(tc: TestCase): bigint {
    return parseBigInt(generateRaw(tc, this.schema));
  }

  override asBasic(): BasicGenerator<bigint> {
    return new BasicGenerator(this.schema, parseBigInt);
  }
}

/** Generate arbitrary-precision integers as BigInt. */
export function bigIntegers(options?: BigIntegerOptions): Generator<bigint> {
  return new BigIntegersGenerator(options);
}

export interface FloatOptions {
  minValue?: number;
  maxValue?: number;
  excludeMin?: boolean;
  excludeMax?: boolean;
  allowNan?: boolean;
  allowInfinity?: boolean;
}

class FloatsGenerator extends Generator<number> {
  private readonly schema: Record<string, unknown>;

  constructor(options?: FloatOptions) {
    super();
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
    this.schema = schema;
  }

  doDraw(tc: TestCase): number {
    return generateRaw(tc, this.schema) as number;
  }

  override asBasic(): BasicGenerator<number> {
    return new BasicGenerator(this.schema);
  }
}

/**
 * Generate floating-point numbers.
 *
 * By default, NaN is allowed only when no bounds are set, and infinity
 * is allowed when at least one bound is missing.
 */
export function floats(options?: FloatOptions): Generator<number> {
  return new FloatsGenerator(options);
}

class BooleansGenerator extends Generator<boolean> {
  private readonly schema = { type: "boolean" };

  doDraw(tc: TestCase): boolean {
    return generateRaw(tc, this.schema) as boolean;
  }

  override asBasic(): BasicGenerator<boolean> {
    return new BasicGenerator(this.schema);
  }
}

/** Generate boolean values. */
export function booleans(): Generator<boolean> {
  return new BooleansGenerator();
}
