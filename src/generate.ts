/**
 * Client-side interpreter for the generator schema IR.
 *
 * The generators in `src/generators/` describe draws as plain schema records
 * (`{ type: "integer", min_value, max_value }`, `{ type: "list", elements }`,
 * …). Up to libhegel 0.23 these were CBOR-encoded and interpreted inside the
 * engine by a single `hegel_generate` call; from 0.32 the C ABI instead
 * exposes one typed entry point per primitive draw
 * (`hegel_generate_integer`, `hegel_generate_string`, …) and leaves compound
 * structure to the caller. This module walks a schema and drives those typed
 * calls, reproducing the engine's old behavior: compound draws are wrapped in
 * the matching shrinker spans, variable-length draws use the collection
 * protocol, and `one_of` values come back as `[index, value]` pairs.
 *
 * String-shaped draws go through an immutable `hegel_string_generator_t`
 * built from the schema. Construction is comparatively expensive (regex
 * compilation, Unicode table lookups), so generators are cached per schema
 * object for the life of the process and deliberately never freed — a
 * bounded leak of one native generator per generator instance, matching the
 * cost of the JS objects themselves.
 *
 * @packageDocumentation
 */

import { Buffer } from "node:buffer";
import { Labels } from "./testCase.js";
import {
  Libhegel,
  fitsInt64,
  type NativeDate,
  type NativeTime,
  type NativeDatetime,
  type Ptr,
} from "./libhegel.js";

const UINT32_MAX = 0xffffffff;

// Bounds for the format draws whose schemas carry no explicit range, matching
// the ranges the engine used for the old CBOR schemas.
const DATE_MIN: NativeDate = { year: 1, month: 1, day: 1 };
const DATE_MAX: NativeDate = { year: 9999, month: 12, day: 31 };
const TIME_MIN: NativeTime = { hour: 0, minute: 0, second: 0, nanosecond: 0 };
const TIME_MAX: NativeTime = { hour: 23, minute: 59, second: 59, nanosecond: 999999999 };

/** Format a drawn date as ISO 8601 (`YYYY-MM-DD`). */
export function formatDate(d: NativeDate): string {
  const year = String(d.year).padStart(4, "0");
  const month = String(d.month).padStart(2, "0");
  const day = String(d.day).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Format a drawn time of day as ISO 8601 (`HH:MM:SS` or `HH:MM:SS.fffffffff`,
 * the nanoseconds omitted when zero).
 */
export function formatTime(t: NativeTime): string {
  const hour = String(t.hour).padStart(2, "0");
  const minute = String(t.minute).padStart(2, "0");
  const second = String(t.second).padStart(2, "0");
  const base = `${hour}:${minute}:${second}`;
  if (t.nanosecond === 0) {
    return base;
  }
  return `${base}.${String(t.nanosecond).padStart(9, "0")}`;
}

/** Format a drawn naive datetime as ISO 8601 (`<date>T<time>`). */
export function formatDatetime(dt: NativeDatetime): string {
  return `${formatDate(dt.date)}T${formatTime(dt.time)}`;
}

/** Format 4 network-order bytes as a dotted-quad IPv4 address. */
export function formatIpv4(bytes: Buffer): string {
  return Array.from(bytes).join(".");
}

/**
 * Format 16 network-order bytes as an RFC 5952 IPv6 address: lowercase hex
 * groups without leading zeros, the leftmost longest run of two or more zero
 * groups compressed to `::`, and the IPv4-mapped range rendered in the
 * conventional `::ffff:a.b.c.d` form.
 */
export function formatIpv6(bytes: Buffer): string {
  const groups: number[] = [];
  for (let i = 0; i < 16; i += 2) {
    groups.push((bytes[i] << 8) | bytes[i + 1]);
  }
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return `::ffff:${formatIpv4(bytes.subarray(12))}`;
  }
  // Find the leftmost longest run of >= 2 zero groups to compress.
  let bestStart = -1;
  let bestLength = 1;
  let runStart = -1;
  for (let i = 0; i <= groups.length; i++) {
    if (i < groups.length && groups[i] === 0) {
      if (runStart === -1) {
        runStart = i;
      }
      continue;
    }
    if (runStart !== -1 && i - runStart > bestLength) {
      bestStart = runStart;
      bestLength = i - runStart;
    }
    runStart = -1;
  }
  const hex = groups.map((g) => g.toString(16));
  if (bestStart === -1) {
    return hex.join(":");
  }
  const head = hex.slice(0, bestStart).join(":");
  const tail = hex.slice(bestStart + bestLength).join(":");
  return `${head}::${tail}`;
}

/**
 * A stable identity key for a raw drawn value, used to detect duplicates in
 * `unique` lists and dict keys the way the engine's value equality used to.
 * Numbers and bigints of equal value get the same key (the integer draw
 * downcasts to `number` exactly when the value is safe, so one logical value
 * can surface as either type).
 */
export function valueKey(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return `i:${value.toString()}`;
  }
  if (typeof value === "string") {
    return `s:${JSON.stringify(value)}`;
  }
  if (typeof value === "boolean") {
    return `b:${value}`;
  }
  if (value instanceof Uint8Array) {
    return `x:${Buffer.from(value).toString("hex")}`;
  }
  // The only remaining raw value shape is an array (tuple / list / dict
  // entries / one_of pairs).
  return `a:${(value as unknown[]).map(valueKey).join(",")}`;
}

/** Downcast a drawn integer to `number` when exact, like the old CBOR decode. */
function toJsInteger(value: bigint): number | bigint {
  if (value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(value);
  }
  return value;
}

/** Read a required integer bound, accepting the schema's number or bigint. */
function requireIntegerBound(schema: Record<string, unknown>, field: string): bigint {
  const value = schema[field];
  if (value === undefined) {
    throw new Error(`integer schema requires ${field}`);
  }
  return typeof value === "bigint" ? value : BigInt(value as number);
}

function drawInteger(
  lib: Libhegel,
  ctx: Ptr,
  tc: Ptr,
  schema: Record<string, unknown>,
): number | bigint {
  const min = requireIntegerBound(schema, "min_value");
  const max = requireIntegerBound(schema, "max_value");
  const value = fitsInt64(min, max)
    ? lib.generateInteger(ctx, tc, min, max)
    : lib.generateIntegerBig(ctx, tc, min, max);
  return toJsInteger(value);
}

function drawFloat(lib: Libhegel, ctx: Ptr, tc: Ptr, schema: Record<string, unknown>): number {
  return lib.generateFloat(ctx, tc, {
    // The float generator always emits width 64; smallest_nonzero_magnitude
    // is the ABI's "no restriction" sentinel for that width.
    width: schema["width"] as number,
    minValue: (schema["min_value"] as number | undefined) ?? -Infinity,
    maxValue: (schema["max_value"] as number | undefined) ?? Infinity,
    allowNan: schema["allow_nan"] as boolean,
    allowInfinity: schema["allow_infinity"] as boolean,
    excludeMin: (schema["exclude_min"] as boolean | undefined) ?? false,
    excludeMax: (schema["exclude_max"] as boolean | undefined) ?? false,
    smallestNonzeroMagnitude: Number.MIN_VALUE,
  });
}

// Native string generators cached per schema object (see the module docs for
// why they are never freed). Each generator instance holds one stable schema
// object, so object identity is the right cache key.
const stringGenerators = new WeakMap<Record<string, unknown>, Ptr>();

function stringGeneratorFor(lib: Libhegel, ctx: Ptr, schema: Record<string, unknown>): Ptr {
  let generator = stringGenerators.get(schema);
  if (generator === undefined) {
    generator = buildStringGenerator(lib, ctx, schema);
    stringGenerators.set(schema, generator);
  }
  return generator;
}

function utf8OrNull(value: string | undefined): Buffer | null {
  return value === undefined ? null : Buffer.from(value, "utf8");
}

function buildStringGenerator(lib: Libhegel, ctx: Ptr, schema: Record<string, unknown>): Ptr {
  switch (schema["type"]) {
    case "string": {
      const maxSize = schema["max_size"] as number | undefined;
      return lib.stringGeneratorText(ctx, {
        minSize: schema["min_size"] as number,
        maxSize: maxSize === undefined ? 0xffffffffffffffffn : BigInt(maxSize),
        codec: (schema["codec"] as string | undefined) ?? null,
        minCodepoint: (schema["min_codepoint"] as number | undefined) ?? 0,
        maxCodepoint: (schema["max_codepoint"] as number | undefined) ?? UINT32_MAX,
        categories: (schema["categories"] as string[] | undefined) ?? null,
        excludeCategories: (schema["exclude_categories"] as string[] | undefined) ?? null,
        includeCharacters: utf8OrNull(schema["include_characters"] as string | undefined),
        excludeCharacters: utf8OrNull(schema["exclude_characters"] as string | undefined),
      });
    }
    case "regex":
      return lib.stringGeneratorRegex(
        ctx,
        schema["pattern"] as string,
        schema["fullmatch"] as boolean,
      );
    case "email":
      return lib.stringGeneratorEmail(ctx);
    case "url":
      return lib.stringGeneratorUrl(ctx);
    // The dispatch in generateValue only routes one other type here.
    default:
      return lib.stringGeneratorDomain(ctx, (schema["max_length"] as number | undefined) ?? 255);
  }
}

function drawList(lib: Libhegel, ctx: Ptr, tc: Ptr, schema: Record<string, unknown>): unknown[] {
  const elementSchema = schema["elements"] as Record<string, unknown>;
  const unique = schema["unique"] as boolean;
  lib.startSpan(ctx, tc, Labels.LIST);
  const collection = lib.newCollection(
    ctx,
    tc,
    schema["min_size"] as number,
    schema["max_size"] as number | undefined,
  );
  const values: unknown[] = [];
  const seen = new Set<string>();
  try {
    while (lib.collectionMore(ctx, tc, collection)) {
      lib.startSpan(ctx, tc, Labels.LIST_ELEMENT);
      const value = generateValue(lib, ctx, tc, elementSchema);
      lib.stopSpan(ctx, tc, false);
      if (unique) {
        const key = valueKey(value);
        if (seen.has(key)) {
          lib.collectionReject(ctx, tc, collection, "duplicate element");
          continue;
        }
        seen.add(key);
      }
      values.push(value);
    }
  } finally {
    lib.freeCollection(collection);
  }
  lib.stopSpan(ctx, tc, false);
  return values;
}

function drawDict(lib: Libhegel, ctx: Ptr, tc: Ptr, schema: Record<string, unknown>): unknown[] {
  const keySchema = schema["keys"] as Record<string, unknown>;
  const valueSchema = schema["values"] as Record<string, unknown>;
  lib.startSpan(ctx, tc, Labels.MAP);
  const collection = lib.newCollection(
    ctx,
    tc,
    schema["min_size"] as number,
    schema["max_size"] as number | undefined,
  );
  const entries: unknown[] = [];
  const seen = new Set<string>();
  try {
    while (lib.collectionMore(ctx, tc, collection)) {
      lib.startSpan(ctx, tc, Labels.MAP_ENTRY);
      const key = generateValue(lib, ctx, tc, keySchema);
      const value = generateValue(lib, ctx, tc, valueSchema);
      lib.stopSpan(ctx, tc, false);
      const identity = valueKey(key);
      if (seen.has(identity)) {
        lib.collectionReject(ctx, tc, collection, "duplicate key");
        continue;
      }
      seen.add(identity);
      entries.push([key, value]);
    }
  } finally {
    lib.freeCollection(collection);
  }
  lib.stopSpan(ctx, tc, false);
  return entries;
}

/**
 * Draw a raw value for the given generator schema by dispatching to the typed
 * `hegel_generate_*` calls. Throws {@link StopTestError} / {@link AssumeError}
 * / {@link LibhegelError} as the underlying draws do.
 */
export function generateValue(
  lib: Libhegel,
  ctx: Ptr,
  tc: Ptr,
  schema: Record<string, unknown>,
): unknown {
  const type = schema["type"] as string;
  switch (type) {
    case "boolean":
      return lib.generateBoolean(ctx, tc, 0.5);
    case "integer":
      return drawInteger(lib, ctx, tc, schema);
    case "float":
      return drawFloat(lib, ctx, tc, schema);
    case "binary":
      return lib.generateBytes(
        ctx,
        tc,
        schema["min_size"] as number,
        schema["max_size"] as number | undefined,
      );
    case "string":
    case "regex":
    case "email":
    case "url":
    case "domain":
      return lib.generateString(ctx, tc, stringGeneratorFor(lib, ctx, schema));
    case "ip_address":
      return schema["version"] === 4
        ? formatIpv4(lib.generateIpv4(ctx, tc))
        : formatIpv6(lib.generateIpv6(ctx, tc));
    case "date":
      return formatDate(lib.generateDate(ctx, tc, DATE_MIN, DATE_MAX));
    case "time":
      return formatTime(lib.generateTime(ctx, tc, TIME_MIN, TIME_MAX));
    case "datetime":
      return formatDatetime(
        lib.generateDatetime(
          ctx,
          tc,
          { date: DATE_MIN, time: TIME_MIN },
          { date: DATE_MAX, time: TIME_MAX },
        ),
      );
    case "constant":
      return schema["value"];
    case "one_of": {
      const options = schema["generators"] as Record<string, unknown>[];
      lib.startSpan(ctx, tc, Labels.ONE_OF);
      const index = Number(lib.generateInteger(ctx, tc, 0n, BigInt(options.length - 1)));
      const value = generateValue(lib, ctx, tc, options[index]);
      lib.stopSpan(ctx, tc, false);
      return [index, value];
    }
    case "tuple": {
      const elements = schema["elements"] as Record<string, unknown>[];
      lib.startSpan(ctx, tc, Labels.TUPLE);
      const values = elements.map((element) => generateValue(lib, ctx, tc, element));
      lib.stopSpan(ctx, tc, false);
      return values;
    }
    case "list":
      return drawList(lib, ctx, tc, schema);
    case "dict":
      return drawDict(lib, ctx, tc, schema);
    default:
      throw new Error(`Unsupported generator schema type: ${String(type)}`);
  }
}
