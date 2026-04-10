/**
 * Primitive and format generators: integers, floats, booleans, text, binary,
 * just, sampledFrom, fromRegex, and format generators (emails, urls, etc.).
 *
 * @packageDocumentation
 */

import { BasicGenerator } from "./core.js";

// ---------------------------------------------------------------------------
// Built-in generators
// ---------------------------------------------------------------------------

/**
 * Generate integers.
 *
 * @param minValue - Minimum value (inclusive), or null for unbounded.
 * @param maxValue - Maximum value (inclusive), or null for unbounded.
 */
export function integers(
  minValue: number | null = null,
  maxValue: number | null = null,
): BasicGenerator<number> {
  if (minValue !== null && maxValue !== null && minValue > maxValue) {
    throw new Error(`Cannot have max_value=${maxValue} < min_value=${minValue}`);
  }
  const schema: Record<string, unknown> = { type: "integer" };
  if (minValue !== null) schema["min_value"] = minValue;
  if (maxValue !== null) schema["max_value"] = maxValue;
  return new BasicGenerator<number>(schema);
}

/**
 * Generate floating-point numbers.
 *
 * By default, allows NaN and infinity unless a range is given. When a min or
 * max is provided the defaults tighten: NaN becomes disallowed, and infinity
 * is disallowed on the bounded side.
 *
 * @param minValue - Minimum value (inclusive), or null for unbounded.
 * @param maxValue - Maximum value (inclusive), or null for unbounded.
 * @param allowNan - Whether to allow NaN. Defaults to true only when both bounds are absent.
 * @param allowInfinity - Whether to allow ±Infinity. Defaults to true when at least one bound is absent.
 * @param excludeMin - Whether to exclude the minimum value (open interval on the left).
 * @param excludeMax - Whether to exclude the maximum value (open interval on the right).
 */
export function floats(
  minValue: number | null = null,
  maxValue: number | null = null,
  allowNan: boolean | null = null,
  allowInfinity: boolean | null = null,
  excludeMin = false,
  excludeMax = false,
): BasicGenerator<number> {
  const hasMin = minValue !== null;
  const hasMax = maxValue !== null;
  const resolvedAllowNan = allowNan !== null ? allowNan : !hasMin && !hasMax;
  const resolvedAllowInfinity = allowInfinity !== null ? allowInfinity : !hasMin || !hasMax;
  if (resolvedAllowNan && (hasMin || hasMax)) {
    throw new Error("Cannot have allow_nan=true with min_value or max_value");
  }
  if (hasMin && hasMax && minValue! > maxValue!) {
    throw new Error(`There are no floats between min_value=${minValue} and max_value=${maxValue}`);
  }
  if (resolvedAllowInfinity && hasMin && hasMax) {
    throw new Error("Cannot have allow_infinity=true with both min_value and max_value");
  }
  const schema: Record<string, unknown> = { type: "float" };
  if (hasMin) schema["min_value"] = minValue;
  if (hasMax) schema["max_value"] = maxValue;
  schema["allow_nan"] = resolvedAllowNan;
  schema["allow_infinity"] = resolvedAllowInfinity;
  // exclude_min/exclude_max are only valid when the corresponding bound is set;
  // sending them without a bound causes the server to return InvalidArgument.
  schema["exclude_min"] = hasMin && excludeMin;
  schema["exclude_max"] = hasMax && excludeMax;
  schema["width"] = 64;
  return new BasicGenerator<number>(schema);
}

/**
 * Generate booleans.
 */
export function booleans(): BasicGenerator<boolean> {
  return new BasicGenerator<boolean>({ type: "boolean" });
}

/**
 * Generate text strings.
 *
 * @param minSize - Minimum number of Unicode codepoints. Defaults to 0.
 * @param maxSize - Maximum number of Unicode codepoints, or null for unbounded.
 */
export function text(minSize = 0, maxSize: number | null = null): BasicGenerator<string> {
  if (minSize < 0) {
    throw new Error(`min_size=${minSize} must be non-negative`);
  }
  if (maxSize !== null && maxSize < 0) {
    throw new Error(`max_size=${maxSize} must be non-negative`);
  }
  if (maxSize !== null && minSize > maxSize) {
    throw new Error(`Cannot have max_size=${maxSize} < min_size=${minSize}`);
  }
  const schema: Record<string, unknown> = { type: "string", min_size: minSize };
  if (maxSize !== null) schema["max_size"] = maxSize;
  return new BasicGenerator<string>(schema);
}

/**
 * Generate binary data (byte strings).
 *
 * The server returns CBOR byte strings which are decoded directly as
 * `Uint8Array`. No transform is needed.
 *
 * @param minSize - Minimum byte length. Defaults to 0.
 * @param maxSize - Maximum byte length, or null for unbounded.
 */
export function binary(minSize = 0, maxSize: number | null = null): BasicGenerator<Uint8Array> {
  if (minSize < 0) {
    throw new Error(`min_size=${minSize} must be non-negative`);
  }
  if (maxSize !== null && maxSize < 0) {
    throw new Error(`max_size=${maxSize} must be non-negative`);
  }
  if (maxSize !== null && minSize > maxSize) {
    throw new Error(`Cannot have max_size=${maxSize} < min_size=${minSize}`);
  }
  const schema: Record<string, unknown> = { type: "binary", min_size: minSize };
  if (maxSize !== null) schema["max_size"] = maxSize;
  return new BasicGenerator<Uint8Array>(schema);
}

/**
 * Always return the same constant value, ignoring the server's suggestion.
 *
 * @param value - The constant to always return.
 */
export function just<T>(value: T): BasicGenerator<T> {
  return new BasicGenerator<T>({ type: "constant", value: null }, (_raw) => value);
}

/**
 * Pick uniformly at random from a list of values.
 *
 * The server generates an integer index; the transform maps it to the
 * corresponding element of `values`.
 *
 * @param values - The list to sample from. Must be non-empty.
 * @throws {Error} If `values` is empty.
 */
export function sampledFrom<T>(values: readonly T[]): BasicGenerator<T> {
  const elements = Array.from(values);
  if (elements.length === 0) {
    throw new Error("sampledFrom requires at least one element");
  }
  const schema: Record<string, unknown> = {
    type: "integer",
    min_value: 0,
    max_value: elements.length - 1,
  };
  return new BasicGenerator<T>(schema, (idx) => elements[idx as number]);
}

/**
 * Generate strings matching a regular expression pattern.
 *
 * @param pattern - The regex pattern to match.
 * @param fullmatch - If true (default), the entire string must match the pattern.
 *                    If false, a substring match is sufficient.
 */
export function fromRegex(pattern: string, fullmatch = true): BasicGenerator<string> {
  return new BasicGenerator<string>({ type: "regex", pattern, fullmatch });
}

/**
 * Generate email addresses.
 *
 * Each generated value is a valid email address string containing '@'.
 */
export function emails(): BasicGenerator<string> {
  return new BasicGenerator<string>({ type: "email" });
}

/**
 * Generate URLs.
 *
 * Each generated value is a valid URL string starting with "http://" or "https://".
 */
export function urls(): BasicGenerator<string> {
  return new BasicGenerator<string>({ type: "url" });
}

/**
 * Generate domain names.
 *
 * @param maxLength - Optional maximum length for generated domain names.
 */
export function domains(maxLength: number | null = null): BasicGenerator<string> {
  if (maxLength !== null && (maxLength < 4 || maxLength > 255)) {
    throw new Error(`max_length=${maxLength} must be between 4 and 255`);
  }
  const schema: Record<string, unknown> = { type: "domain" };
  if (maxLength !== null) schema["max_length"] = maxLength;
  return new BasicGenerator<string>(schema);
}

/**
 * Generate dates.
 *
 * Each generated value is an ISO 8601 date string in YYYY-MM-DD format.
 */
export function dates(): BasicGenerator<string> {
  return new BasicGenerator<string>({ type: "date" });
}

/**
 * Generate times.
 *
 * Each generated value is a time string containing ':'.
 */
export function times(): BasicGenerator<string> {
  return new BasicGenerator<string>({ type: "time" });
}

/**
 * Generate datetimes.
 *
 * Each generated value is a datetime string containing 'T'.
 */
export function datetimes(): BasicGenerator<string> {
  return new BasicGenerator<string>({ type: "datetime" });
}
