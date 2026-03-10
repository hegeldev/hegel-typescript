/**
 * Collection generators: lists and dicts.
 *
 * @packageDocumentation
 */

import { BasicGenerator, Collection, Generator } from "./core.js";
import { generateFromSchema, Labels, startSpan, stopSpan } from "../runner.js";
import type { TestCaseData } from "../runner.js";

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
  if (minSize < 0) {
    throw new Error(`min_size=${minSize} must be non-negative`);
  }
  if (maxSize !== null && maxSize < 0) {
    throw new Error(`max_size=${maxSize} must be non-negative`);
  }
  if (maxSize !== null && minSize > maxSize) {
    throw new Error(`Cannot have max_size=${maxSize} < min_size=${minSize}`);
  }
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
  if (minSize < 0) {
    throw new Error(`min_size=${minSize} must be non-negative`);
  }
  if (maxSize !== null && maxSize < 0) {
    throw new Error(`max_size=${maxSize} must be non-negative`);
  }
  if (maxSize !== null && minSize > maxSize) {
    throw new Error(`Cannot have max_size=${maxSize} < min_size=${minSize}`);
  }
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
