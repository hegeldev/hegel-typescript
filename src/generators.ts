/**
 * Generator infrastructure for the Hegel SDK.
 *
 * Provides the {@link Generator} abstract class, {@link BasicGenerator},
 * composite generators (Mapped, FlatMapped, Filtered), collection protocol,
 * span helpers, and the initial set of generators.
 *
 * @packageDocumentation
 */

import { RequestError } from "./connection.js";
import {
  assume,
  DataExhausted,
  generateFromSchema,
  Labels,
  startSpan,
  stopSpan,
} from "./runner.js";
import type { TestCaseData } from "./runner.js";

// ---------------------------------------------------------------------------
// Generator base class
// ---------------------------------------------------------------------------

/**
 * Base class for all generators.
 *
 * Subclasses implement {@link doDraw} to produce a value. The {@link map},
 * {@link flatMap}, and {@link filter} combinators produce new generators.
 *
 * {@link BasicGenerator} is special: its {@link BasicGenerator.map} preserves
 * the schema (stays basic), enabling the server to see the original schema for
 * better shrinking.
 */
export abstract class Generator<T = unknown> {
  /** @internal */
  abstract doDraw(data: TestCaseData): Promise<T>;

  /**
   * Transform each generated value with `f`.
   *
   * On a {@link BasicGenerator} this stays basic (preserves schema).
   * On any other generator it returns a MappedGenerator.
   */
  map<U>(f: (value: T) => U): Generator<U> {
    return new MappedGenerator<T, U>(this, f);
  }

  /**
   * Dependent generation: generate a value then use it to choose a second generator.
   */
  flatMap<U>(f: (value: T) => Generator<U>): Generator<U> {
    return new FlatMappedGenerator<T, U>(this, f);
  }

  /**
   * Filter generated values. Tries up to 3 times before giving up.
   *
   * Prefer narrow schemas over filters when possible — filters slow shrinking.
   */
  filter(predicate: (value: T) => boolean): Generator<T> {
    return new FilteredGenerator<T>(this, predicate);
  }
}

// ---------------------------------------------------------------------------
// BasicGenerator
// ---------------------------------------------------------------------------

/**
 * A generator backed by a raw schema sent to the server.
 *
 * `map()` on a BasicGenerator **preserves the schema** — it composes the
 * transform client-side so the server still sees the original schema. This is
 * the key optimization: the server can shrink within the original schema space.
 */
export class BasicGenerator<T = unknown> extends Generator<T> {
  /** @internal */
  readonly _rawSchema: Record<string, unknown>;
  /** @internal */
  readonly _transform: ((raw: unknown) => T) | null;

  constructor(rawSchema: Record<string, unknown>, transform: ((raw: unknown) => T) | null = null) {
    super();
    this._rawSchema = rawSchema;
    this._transform = transform;
  }

  /** The raw schema sent to the server. */
  schema(): Record<string, unknown> {
    return this._rawSchema;
  }

  /** Generate a value: fetch from server and apply the optional transform. */
  async doDraw(data: TestCaseData): Promise<T> {
    const raw = await generateFromSchema(this._rawSchema, data);
    if (this._transform !== null) {
      return this._transform(raw);
    }
    return raw as T;
  }

  /**
   * Transform values while **preserving the schema**.
   *
   * If this generator already has a transform `t`, the new transform is
   * `f(t(raw))`. This keeps the generator basic (server sees original schema).
   */
  override map<U>(f: (value: T) => U): BasicGenerator<U> {
    const current = this._transform;
    const composed: (raw: unknown) => U =
      current !== null ? (raw) => f(current(raw)) : (raw) => f(raw as T);
    return new BasicGenerator<U>(this._rawSchema, composed);
  }
}

// ---------------------------------------------------------------------------
// MappedGenerator
// ---------------------------------------------------------------------------

/**
 * A generator that applies a transform to values from another generator.
 * Uses a MAPPED span so the server can track the transformation.
 */
export class MappedGenerator<T, U> extends Generator<U> {
  private readonly _source: Generator<T>;
  private readonly _f: (value: T) => U;

  constructor(source: Generator<T>, f: (value: T) => U) {
    super();
    this._source = source;
    this._f = f;
  }

  async doDraw(data: TestCaseData): Promise<U> {
    await startSpan(Labels.MAPPED, data);
    try {
      const value = await this._source.doDraw(data);
      return this._f(value);
    } finally {
      await stopSpan({}, data);
    }
  }
}

// ---------------------------------------------------------------------------
// FlatMappedGenerator
// ---------------------------------------------------------------------------

/**
 * A generator for dependent generation.
 * Generates a first value, uses it to choose a second generator, then generates from that.
 */
export class FlatMappedGenerator<T, U> extends Generator<U> {
  private readonly _source: Generator<T>;
  private readonly _f: (value: T) => Generator<U>;

  constructor(source: Generator<T>, f: (value: T) => Generator<U>) {
    super();
    this._source = source;
    this._f = f;
  }

  async doDraw(data: TestCaseData): Promise<U> {
    await startSpan(Labels.FLAT_MAP, data);
    try {
      const first = await this._source.doDraw(data);
      const secondGen = this._f(first);
      return await secondGen.doDraw(data);
    } finally {
      await stopSpan({}, data);
    }
  }
}

// ---------------------------------------------------------------------------
// FilteredGenerator
// ---------------------------------------------------------------------------

/** Maximum number of filter attempts before giving up. */
const FILTER_MAX_ATTEMPTS = 3;

/**
 * A generator that filters values from another generator.
 *
 * Tries up to 3 times. Each failed attempt discards the span.
 * After all attempts fail, calls `assume(false)` to mark the test case as invalid.
 */
export class FilteredGenerator<T> extends Generator<T> {
  private readonly _source: Generator<T>;
  private readonly _predicate: (value: T) => boolean;

  constructor(source: Generator<T>, predicate: (value: T) => boolean) {
    super();
    this._source = source;
    this._predicate = predicate;
  }

  async doDraw(data: TestCaseData): Promise<T> {
    for (let i = 0; i < FILTER_MAX_ATTEMPTS; i++) {
      await startSpan(Labels.FILTER, data);
      const value = await this._source.doDraw(data);
      if (this._predicate(value)) {
        await stopSpan({}, data);
        return value;
      }
      await stopSpan({ discard: true }, data);
    }
    assume(false);
    // unreachable (assume(false) always throws)
    throw new Error("unreachable");
  }
}

// ---------------------------------------------------------------------------
// Span helpers
// ---------------------------------------------------------------------------

/**
 * Run `fn` inside a span with the given label.
 *
 * Starts the span before calling `fn`, then stops it (with `discard=false`)
 * after `fn` returns. Returns the value returned by `fn`.
 *
 * @param label - Span label constant (see `Labels`).
 * @param fn - Function to run inside the span.
 */
export async function group<T>(
  label: number,
  fn: () => T | Promise<T>,
  data: TestCaseData,
): Promise<T> {
  await startSpan(label, data);
  try {
    return await fn();
  } finally {
    await stopSpan({}, data);
  }
}

/**
 * Run `fn` inside a discardable span.
 *
 * If `fn` throws, stops the span with `discard=true`. Otherwise stops with
 * `discard=false`. The exception (if any) is re-thrown.
 *
 * @param label - Span label constant (see `Labels`).
 * @param fn - Function to run inside the span.
 */
export async function discardableGroup<T>(
  label: number,
  fn: () => T | Promise<T>,
  data: TestCaseData,
): Promise<T> {
  await startSpan(label, data);
  let discard = false;
  try {
    return await fn();
  } catch (e) {
    discard = true;
    throw e;
  } finally {
    await stopSpan({ discard }, data);
  }
}

// ---------------------------------------------------------------------------
// Collection protocol
// ---------------------------------------------------------------------------

/**
 * Server-managed collection for generating variable-length sequences.
 *
 * The server decides how many elements to generate based on the configured
 * size constraints. Call {@link more} in a loop; when it returns false, the
 * collection is done. Call {@link reject} to discard the most recently
 * generated element.
 *
 * StopTest errors from any collection command propagate as {@link DataExhausted}
 * (same as in `generateFromSchema`).
 */
export class Collection {
  private _baseName: string | null;
  private _serverName: unknown = null;
  private _serverNameResolved = false;
  private _finished = false;

  /** Minimum number of elements. */
  readonly minSize: number;
  /** Maximum number of elements (null = unlimited). */
  readonly maxSize: number | null;

  constructor(name: string | null, minSize = 0, maxSize: number | null = null) {
    this._baseName = name;
    this.minSize = minSize;
    this.maxSize = maxSize;
  }

  /**
   * Get (or lazily initialize) the server-side collection name.
   * Sends `new_collection` on first call.
   */
  private async _getServerName(data: TestCaseData): Promise<unknown> {
    if (!this._serverNameResolved) {
      this._serverNameResolved = true;
      const channel = data.channel;
      try {
        this._serverName = await channel
          .request({
            command: "new_collection",
            name: this._baseName,
            min_size: this.minSize,
            max_size: this.maxSize,
          })
          .get();
      } catch (e) {
        if (isStopTest(e)) {
          data.testAborted = true;
          throw new DataExhausted("Server ran out of data");
        }
        throw e;
      }
    }
    return this._serverName;
  }

  /**
   * Should we generate another element?
   *
   * Returns `true` if the server wants another element, `false` when done.
   * Once it returns `false`, subsequent calls return `false` immediately.
   *
   * @throws {DataExhausted} If the server sends StopTest.
   */
  async more(data: TestCaseData): Promise<boolean> {
    if (this._finished) return false;
    const serverName = await this._getServerName(data);
    const channel = data.channel;
    let result: unknown;
    try {
      result = await channel.request({ command: "collection_more", collection: serverName }).get();
    } catch (e) {
      if (isStopTest(e)) {
        data.testAborted = true;
        throw new DataExhausted("Server ran out of data");
      }
      throw e;
    }
    if (!result) {
      this._finished = true;
    }
    return result as boolean;
  }

  /**
   * Discard the most recently generated element.
   *
   * Tells the server not to count this element toward the collection size.
   * No-op if the collection is already finished.
   *
   * @param why - Optional reason for rejection.
   */
  async reject(data: TestCaseData, why: string | null = null): Promise<void> {
    if (this._finished) return;
    const serverName = await this._getServerName(data);
    const channel = data.channel;
    await channel
      .request({
        command: "collection_reject",
        collection: serverName,
        why,
      })
      .get();
  }
}

/** Check if a caught value is a StopTest RequestError. */
function isStopTest(e: unknown): boolean {
  return e instanceof RequestError && e.errorType === "StopTest";
}

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
 *
 * @param p - Probability of generating `true`. Defaults to 0.5.
 */
export function booleans(p = 0.5): BasicGenerator<boolean> {
  return new BasicGenerator<boolean>({ type: "boolean", p });
}

/**
 * Generate text strings.
 *
 * @param minSize - Minimum number of Unicode codepoints. Defaults to 0.
 * @param maxSize - Maximum number of Unicode codepoints, or null for unbounded.
 */
export function text(minSize = 0, maxSize: number | null = null): BasicGenerator<string> {
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
  return new BasicGenerator<T>({ const: null }, (_raw) => value);
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

// ---------------------------------------------------------------------------
// CompositeTupleGenerator
// ---------------------------------------------------------------------------

/**
 * A tuple generator for elements that are not all basic.
 *
 * Generates each element in sequence inside a TUPLE span (label 7).
 * Used when at least one element cannot be represented as a basic schema.
 */
export class CompositeTupleGenerator<T extends unknown[]> extends Generator<T> {
  private readonly _elements: { [K in keyof T]: Generator<T[K]> };

  constructor(elements: { [K in keyof T]: Generator<T[K]> }) {
    super();
    this._elements = elements;
  }

  async doDraw(data: TestCaseData): Promise<T> {
    await startSpan(Labels.TUPLE, data);
    try {
      const result: unknown[] = [];
      for (const elem of this._elements) {
        result.push(await elem.doDraw(data));
      }
      return result as T;
    } finally {
      await stopSpan({}, data);
    }
  }
}

// ---------------------------------------------------------------------------
// tuples2, tuples3, tuples4
// ---------------------------------------------------------------------------

/**
 * Generate a 2-tuple (pair).
 *
 * If both elements are {@link BasicGenerator}s, returns a BasicGenerator with
 * a tuple schema so the server can see and shrink both components. Otherwise
 * returns a CompositeTupleGenerator that generates each element inside
 * a TUPLE span.
 *
 * @param g1 - Generator for the first element.
 * @param g2 - Generator for the second element.
 */
export function tuples2<A, B>(g1: Generator<A>, g2: Generator<B>): Generator<[A, B]> {
  if (g1 instanceof BasicGenerator && g2 instanceof BasicGenerator) {
    return _basicTuple([g1, g2]) as BasicGenerator<[A, B]>;
  }
  return new CompositeTupleGenerator<[A, B]>([g1, g2]);
}

/**
 * Generate a 3-tuple.
 *
 * If all elements are {@link BasicGenerator}s, returns a BasicGenerator with
 * a tuple schema. Otherwise returns a CompositeTupleGenerator.
 *
 * @param g1 - Generator for the first element.
 * @param g2 - Generator for the second element.
 * @param g3 - Generator for the third element.
 */
export function tuples3<A, B, C>(
  g1: Generator<A>,
  g2: Generator<B>,
  g3: Generator<C>,
): Generator<[A, B, C]> {
  if (
    g1 instanceof BasicGenerator &&
    g2 instanceof BasicGenerator &&
    g3 instanceof BasicGenerator
  ) {
    return _basicTuple([g1, g2, g3]) as BasicGenerator<[A, B, C]>;
  }
  return new CompositeTupleGenerator<[A, B, C]>([g1, g2, g3]);
}

/**
 * Generate a 4-tuple.
 *
 * If all elements are {@link BasicGenerator}s, returns a BasicGenerator with
 * a tuple schema. Otherwise returns a CompositeTupleGenerator.
 *
 * @param g1 - Generator for the first element.
 * @param g2 - Generator for the second element.
 * @param g3 - Generator for the third element.
 * @param g4 - Generator for the fourth element.
 */
export function tuples4<A, B, C, D>(
  g1: Generator<A>,
  g2: Generator<B>,
  g3: Generator<C>,
  g4: Generator<D>,
): Generator<[A, B, C, D]> {
  if (
    g1 instanceof BasicGenerator &&
    g2 instanceof BasicGenerator &&
    g3 instanceof BasicGenerator &&
    g4 instanceof BasicGenerator
  ) {
    return _basicTuple([g1, g2, g3, g4]) as BasicGenerator<[A, B, C, D]>;
  }
  return new CompositeTupleGenerator<[A, B, C, D]>([g1, g2, g3, g4]);
}

// ---------------------------------------------------------------------------
// CompositeListGenerator
// ---------------------------------------------------------------------------

/**
 * A list generator for elements that are not basic (e.g., filtered or mapped
 * through a non-basic path). Uses the collection protocol in a LIST span.
 *
 * @typeParam T - The element type.
 */
export class CompositeListGenerator<T = unknown> extends Generator<T[]> {
  private readonly _elements: Generator<T>;
  private readonly _minSize: number;
  private readonly _maxSize: number | null;

  constructor(elements: Generator<T>, minSize = 0, maxSize: number | null = null) {
    super();
    this._elements = elements;
    this._minSize = minSize;
    this._maxSize = maxSize;
  }

  async doDraw(data: TestCaseData): Promise<T[]> {
    // Create a fresh Collection for each doDraw() call so that _finished
    // state from prior calls does not carry over.
    const collection = new Collection("composite_list", this._minSize, this._maxSize);
    await startSpan(Labels.LIST, data);
    try {
      const result: T[] = [];
      while (await collection.more(data)) {
        result.push(await this._elements.doDraw(data));
      }
      return result;
    } finally {
      await stopSpan({}, data);
    }
  }
}

// ---------------------------------------------------------------------------
// lists()
// ---------------------------------------------------------------------------

/**
 * Generate lists of elements.
 *
 * When `elements` is a {@link BasicGenerator}, the list schema is sent to the
 * server directly (optimal shrinking). If the element generator has a transform,
 * a list-level transform is composed that applies it to each item. When elements
 * is a composite generator (e.g., filtered or mapped), the collection protocol
 * is used in a LIST span via CompositeListGenerator.
 *
 * @param elements - Generator for list elements.
 * @param minSize - Minimum list length. Defaults to 0.
 * @param maxSize - Maximum list length, or null for unbounded.
 */
export function lists<T>(
  elements: Generator<T>,
  minSize = 0,
  maxSize: number | null = null,
): Generator<T[]> {
  if (elements instanceof BasicGenerator) {
    const rawSchema: Record<string, unknown> = {
      type: "list",
      elements: elements._rawSchema,
      min_size: minSize,
    };
    if (maxSize !== null) {
      rawSchema["max_size"] = maxSize;
    }
    const elemTransform = elements._transform as ((raw: unknown) => T) | null;
    if (elemTransform !== null) {
      const listTransform = (rawList: unknown): T[] =>
        (rawList as unknown[]).map((item) => elemTransform(item));
      return new BasicGenerator<T[]>(rawSchema, listTransform);
    }
    return new BasicGenerator<T[]>(rawSchema);
  }
  return new CompositeListGenerator<T>(elements, minSize, maxSize);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a BasicGenerator for a tuple from an array of BasicGenerators.
 *
 * Combines their raw schemas into `{"type":"tuple","elements":[...]}`.
 * If any element has a transform, builds a combined transform that applies
 * each element's transform to the corresponding position.
 *
 * @internal
 */
function _basicTuple(elements: BasicGenerator<unknown>[]): BasicGenerator<unknown[]> {
  const rawSchemas = elements.map((e) => e._rawSchema);
  const transforms = elements.map((e) => e._transform as ((raw: unknown) => unknown) | null);
  const combinedSchema: Record<string, unknown> = { type: "tuple", elements: rawSchemas };

  if (transforms.every((t) => t === null)) {
    return new BasicGenerator<unknown[]>(combinedSchema);
  }

  const applyTransforms = (rawTuple: unknown): unknown[] => {
    const arr = rawTuple as unknown[];
    return arr.map((raw, i) => {
      const t = transforms[i];
      return t !== null ? t(raw) : raw;
    });
  };
  return new BasicGenerator<unknown[]>(combinedSchema, applyTransforms);
}

// ---------------------------------------------------------------------------
// CompositeOneOfGenerator
// ---------------------------------------------------------------------------

/**
 * A one_of generator for generators that cannot be represented as a single schema
 * (i.e., when at least one branch is not a {@link BasicGenerator}).
 *
 * Generates an integer index then delegates to the selected generator. Wrapped
 * in a ONE_OF span (label `Labels.ONE_OF`) so the server tracks the choice.
 */
export class CompositeOneOfGenerator<T = unknown> extends Generator<T> {
  /** @internal */
  readonly _generators: Generator<T>[];

  constructor(generators: Generator<T>[]) {
    super();
    this._generators = generators;
  }

  async doDraw(data: TestCaseData): Promise<T> {
    await startSpan(Labels.ONE_OF, data);
    try {
      const index = (await generateFromSchema(
        {
          type: "integer",
          min_value: 0,
          max_value: this._generators.length - 1,
        },
        data,
      )) as number;
      return await this._generators[index].doDraw(data);
    } finally {
      await stopSpan({}, data);
    }
  }
}

// ---------------------------------------------------------------------------
// oneOf
// ---------------------------------------------------------------------------

/**
 * Choose uniformly between two or more generators.
 *
 * There are three implementation paths depending on the inputs:
 *
 * - **Path 1** — all branches are {@link BasicGenerator} with no transform:
 *   returns a `BasicGenerator` with `{"one_of": [...schemas]}`.
 * - **Path 2** — all branches are {@link BasicGenerator} but some have transforms:
 *   returns a `BasicGenerator` using tagged-tuple schemas so each branch can
 *   carry its own transform.
 * - **Path 3** — any branch is not a `BasicGenerator`:
 *   returns a CompositeOneOfGenerator that generates an index then
 *   delegates to the selected generator inside a ONE_OF span.
 *
 * @param generators - Two or more generators to choose between.
 * @throws {Error} If fewer than 2 generators are provided.
 */
export function oneOf<T>(...generators: Generator<T>[]): Generator<T> {
  if (generators.length < 2) {
    throw new Error("oneOf requires at least 2 generators");
  }

  // Check if all generators are BasicGenerator instances
  const allBasic = generators.every((g) => g instanceof BasicGenerator);
  if (!allBasic) {
    // Path 3: composite
    return new CompositeOneOfGenerator(generators);
  }

  const basicGenerators = generators as BasicGenerator<T>[];
  const allIdentity = basicGenerators.every((g) => g._transform === null);

  if (allIdentity) {
    // Path 1: all basic, no transforms — flat one_of schema
    const schemas = basicGenerators.map((g) => g._rawSchema);
    return new BasicGenerator<T>({ one_of: schemas });
  }

  // Path 2: all basic, some have transforms — use tagged tuples
  const taggedSchemas = basicGenerators.map((g, i) => ({
    type: "tuple",
    elements: [{ const: i }, g._rawSchema],
  }));
  const transforms = basicGenerators.map((g) => g._transform as ((raw: unknown) => T) | null);

  const applyTaggedTransform = (tagged: unknown): T => {
    const [tag, value] = tagged as [number, unknown];
    const transform = transforms[tag];
    if (transform !== null) {
      return transform(value);
    }
    return value as T;
  };

  return new BasicGenerator<T>({ one_of: taggedSchemas }, applyTaggedTransform);
}

// ---------------------------------------------------------------------------
// optional
// ---------------------------------------------------------------------------

/**
 * Optionally generate a value — returns `null` or a value from `element`.
 *
 * Equivalent to `oneOf(just(null), element)`.
 *
 * @param element - Generator for the non-null case.
 */
export function optional<T>(element: Generator<T>): Generator<T | null> {
  return oneOf(just<T | null>(null), element);
}

// ---------------------------------------------------------------------------
// ipAddresses
// ---------------------------------------------------------------------------

/**
 * Generate IP addresses.
 *
 * @param version - IP version: `4` for IPv4, `6` for IPv6, or `null` (default)
 *   to generate both versions mixed.
 */
export function ipAddresses(version: 4 | 6 | null = null): Generator<string> {
  if (version === 4) {
    return new BasicGenerator<string>({ type: "ipv4" });
  }
  if (version === 6) {
    return new BasicGenerator<string>({ type: "ipv6" });
  }
  // version === null: both v4 and v6
  return oneOf(ipAddresses(4), ipAddresses(6));
}

// ---------------------------------------------------------------------------
// CompositeDictGenerator
// ---------------------------------------------------------------------------

/**
 * A dict generator for keys or values that are not basic (have no server schema).
 *
 * Uses the MAP span (label 5) for the whole dict and MAP_ENTRY spans (label 6)
 * for each key-value pair. The server decides the size via generateFromSchema.
 */
export class CompositeDictGenerator<K, V> extends Generator<Map<K, V>> {
  /** @internal */
  readonly _keys: Generator<K>;
  /** @internal */
  readonly _values: Generator<V>;
  /** @internal */
  readonly _minSize: number;
  /** @internal */
  readonly _maxSize: number | null;

  constructor(keys: Generator<K>, values: Generator<V>, minSize: number, maxSize: number | null) {
    super();
    this._keys = keys;
    this._values = values;
    this._minSize = minSize;
    this._maxSize = maxSize;
  }

  async doDraw(data: TestCaseData): Promise<Map<K, V>> {
    await startSpan(Labels.MAP, data);
    try {
      const maxSz = this._maxSize !== null ? this._maxSize : this._minSize + 10;
      const size = (await generateFromSchema(
        {
          type: "integer",
          min_value: this._minSize,
          max_value: maxSz,
        },
        data,
      )) as number;
      const result = new Map<K, V>();
      for (let i = 0; i < size; i++) {
        await startSpan(Labels.MAP_ENTRY, data);
        const key = await this._keys.doDraw(data);
        const value = await this._values.doDraw(data);
        result.set(key, value);
        await stopSpan({}, data);
      }
      return result;
    } finally {
      await stopSpan({}, data);
    }
  }
}

// ---------------------------------------------------------------------------
// dicts()
// ---------------------------------------------------------------------------

/**
 * Generate dictionaries with keys and values from the given generators.
 *
 * When both `keys` and `values` are {@link BasicGenerator}s, the server handles
 * the full dict generation (basic path) and the result is a plain
 * `Record<string, unknown>`. Otherwise a CompositeDictGenerator is used
 * (non-basic path) which returns a `Map<K, V>`.
 *
 * @param keys - Generator for dictionary keys.
 * @param values - Generator for dictionary values.
 * @param minSize - Minimum number of entries. Defaults to 0.
 * @param maxSize - Maximum number of entries, or null for unbounded.
 */
export function dicts<K, V>(
  keys: Generator<K>,
  values: Generator<V>,
  minSize = 0,
  maxSize: number | null = null,
): Generator<Record<string, unknown>> | Generator<Map<K, V>> {
  if (keys instanceof BasicGenerator && values instanceof BasicGenerator) {
    const rawSchema: Record<string, unknown> = {
      type: "dict",
      keys: keys._rawSchema,
      values: values._rawSchema,
      min_size: minSize,
    };
    if (maxSize !== null) rawSchema["max_size"] = maxSize;

    const keyTransform = keys._transform as ((raw: unknown) => unknown) | null;
    const valueTransform = values._transform as ((raw: unknown) => unknown) | null;

    if (keyTransform === null && valueTransform === null) {
      return new BasicGenerator<Record<string, unknown>>(rawSchema, (items) => {
        return Object.fromEntries(items as Array<[unknown, unknown]>);
      });
    } else {
      return new BasicGenerator<Record<string, unknown>>(rawSchema, (items) => {
        const result: Record<string, unknown> = {};
        for (const [k, v] of items as Array<[unknown, unknown]>) {
          const key = keyTransform !== null ? String(keyTransform(k)) : String(k);
          const value = valueTransform !== null ? valueTransform(v) : v;
          result[key] = value;
        }
        return result;
      });
    }
  } else {
    return new CompositeDictGenerator<K, V>(keys, values, minSize, maxSize);
  }
}
