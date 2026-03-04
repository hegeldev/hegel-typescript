/**
 * Core generator infrastructure: abstract class, BasicGenerator,
 * composite generators (Mapped, FlatMapped, Filtered), Collection protocol,
 * and span helpers.
 *
 * @packageDocumentation
 */

import { RequestError } from "../connection.js";
import {
  assume,
  DataExhausted,
  generateFromSchema,
  Labels,
  startSpan,
  stopSpan,
} from "../runner.js";
import type { TestCaseData } from "../runner.js";

// ---------------------------------------------------------------------------
// Generator base class
// ---------------------------------------------------------------------------

/**
 * Base class for all generators.
 *
 * Subclasses implement `doDraw` to produce a value. The {@link map},
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

  /** @internal */
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
 * size constraints. Call `more()` in a loop; when it returns false, the
 * collection is done. Call `reject()` to discard the most recently
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

  /** @internal */
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

  /** @internal */
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
