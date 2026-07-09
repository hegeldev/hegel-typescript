/**
 * Collection generators: arrays, sets, and maps.
 *
 * @packageDocumentation
 */

import { TestCase, Collection, Labels } from "../testCase.js";
import { Generator, BasicGenerator } from "./core.js";
import { valuesEqual } from "./equality.js";

export interface CollectionOptions {
  minSize?: number;
  maxSize?: number;
}

export interface ArrayOptions extends CollectionOptions {
  /**
   * Require all elements of the generated array to be distinct.
   *
   * Elements are compared by structural value equality ({@link valuesEqual}):
   * nested arrays and objects are compared by contents, `NaN` equals `NaN`,
   * `0` equals `-0`, and functions compare by reference.
   */
  unique?: boolean;
}

// ---------------------------------------------------------------------------
// Arrays
// ---------------------------------------------------------------------------

class ArraysGenerator<T> extends Generator<T[]> {
  private readonly elements: Generator<T>;
  private readonly minSize: number;
  private readonly maxSize: number | null;
  private readonly unique: boolean;
  private readonly basic: BasicGenerator<T[]> | null;

  constructor(elements: Generator<T>, options?: ArrayOptions) {
    super();
    const minSize = options?.minSize ?? 0;
    const maxSize = options?.maxSize ?? null;
    const unique = options?.unique ?? false;

    if (maxSize !== null && minSize > maxSize) {
      throw new Error("Cannot have maxSize < minSize");
    }

    this.elements = elements;
    this.minSize = minSize;
    this.maxSize = maxSize;
    this.unique = unique;

    // The engine enforces `unique` on raw (pre-parse) values, so the schema
    // path is only sound when parsing preserves distinctness; for e.g. mapped
    // elements, fall back to deduplicating final values client-side.
    const elementBasic = elements.asBasic();
    if (elementBasic && (!unique || elementBasic.injectiveParse)) {
      const schema: Record<string, unknown> = {
        type: "list",
        unique,
        elements: elementBasic.schema,
        min_size: minSize,
      };
      if (maxSize !== null) schema["max_size"] = maxSize;

      this.basic = new BasicGenerator(
        schema,
        (raw) => {
          if (!Array.isArray(raw)) throw new Error(`Expected array, got ${typeof raw}`);
          return raw.map((v: unknown) => elementBasic.parseRaw(v));
        },
        elementBasic.injectiveParse,
      );
    } else {
      this.basic = null;
    }
  }

  doDraw(tc: TestCase): T[] {
    if (this.basic) return this.basic.doDraw(tc);
    tc.startSpan(Labels.LIST);
    const collection = new Collection(tc, this.minSize, this.maxSize ?? undefined);
    const result: T[] = [];
    while (collection.more()) {
      const element = this.elements.doDraw(tc);
      if (this.unique) {
        if (result.some((existing) => valuesEqual(existing, element))) {
          collection.reject("duplicate element");
          continue;
        }
      }
      result.push(element);
    }
    tc.stopSpan();
    return result;
  }

  override asBasic(): BasicGenerator<T[]> | null {
    return this.basic;
  }
}

/** Generate arrays with elements from the given generator. */
export function arrays<T>(elements: Generator<T>, options?: ArrayOptions): Generator<T[]> {
  return new ArraysGenerator(elements, options);
}

class SetsGenerator<T> extends Generator<Set<T>> {
  private readonly elements: Generator<T>;
  private readonly minSize: number;
  private readonly maxSize: number | null;
  private readonly basic: BasicGenerator<Set<T>> | null;

  constructor(elements: Generator<T>, options?: CollectionOptions) {
    super();
    const minSize = options?.minSize ?? 0;
    const maxSize = options?.maxSize ?? null;

    if (maxSize !== null && minSize > maxSize) {
      throw new Error("Cannot have maxSize < minSize");
    }

    this.elements = elements;
    this.minSize = minSize;
    this.maxSize = maxSize;

    // The engine enforces uniqueness and min_size on raw (pre-parse) values,
    // so the schema path is only sound when parsing preserves distinctness;
    // for e.g. mapped elements, fall back to deduplicating final values
    // client-side.
    const elementBasic = elements.asBasic();
    if (elementBasic && elementBasic.injectiveParse) {
      const schema: Record<string, unknown> = {
        type: "list",
        unique: true,
        elements: elementBasic.schema,
        min_size: minSize,
      };
      if (maxSize !== null) schema["max_size"] = maxSize;

      this.basic = new BasicGenerator(schema, (raw) => {
        if (!Array.isArray(raw)) throw new Error(`Expected array, got ${typeof raw}`);
        return new Set(raw.map((v: unknown) => elementBasic.parseRaw(v)));
      });
    } else {
      this.basic = null;
    }
  }

  doDraw(tc: TestCase): Set<T> {
    if (this.basic) return this.basic.doDraw(tc);
    tc.startSpan(Labels.SET);
    const collection = new Collection(tc, this.minSize, this.maxSize ?? undefined);
    const result = new Set<T>();
    while (collection.more()) {
      const element = this.elements.doDraw(tc);
      if ([...result].some((existing) => valuesEqual(existing, element))) {
        collection.reject("duplicate element");
        continue;
      }
      result.add(element);
    }
    tc.stopSpan();
    return result;
  }

  override asBasic(): BasicGenerator<Set<T>> | null {
    return this.basic;
  }
}

/**
 * Generate Sets with elements from the given generator.
 *
 * Elements are deduplicated by structural value equality ({@link valuesEqual}),
 * not merely by reference: the generated Set never contains two structurally
 * equal elements (e.g. two `{ v: 0 }` objects), and `minSize`/`maxSize` count
 * structurally distinct elements.
 */
export function sets<T>(elements: Generator<T>, options?: CollectionOptions): Generator<Set<T>> {
  return new SetsGenerator(elements, options);
}

class MapsGenerator<K, V> extends Generator<Map<K, V>> {
  private readonly keys: Generator<K>;
  private readonly values: Generator<V>;
  private readonly minSize: number;
  private readonly maxSize: number | null;
  private readonly basic: BasicGenerator<Map<K, V>> | null;

  constructor(keys: Generator<K>, values: Generator<V>, options?: CollectionOptions) {
    super();
    const minSize = options?.minSize ?? 0;
    const maxSize = options?.maxSize ?? null;

    if (maxSize !== null && minSize > maxSize) {
      throw new Error("Cannot have maxSize < minSize");
    }

    this.keys = keys;
    this.values = values;
    this.minSize = minSize;
    this.maxSize = maxSize;

    // The engine enforces key uniqueness and min_size on raw (pre-parse)
    // keys, so the schema path is only sound when key parsing preserves
    // distinctness; for e.g. mapped keys, fall back to deduplicating final
    // keys client-side. (Values need no deduplication, so a mapped value
    // generator keeps the schema path.)
    const keyBasic = keys.asBasic();
    const valueBasic = values.asBasic();

    if (keyBasic && valueBasic && keyBasic.injectiveParse) {
      const schema: Record<string, unknown> = {
        type: "dict",
        keys: keyBasic.schema,
        values: valueBasic.schema,
        min_size: minSize,
      };
      if (maxSize !== null) schema["max_size"] = maxSize;

      this.basic = new BasicGenerator(
        schema,
        (raw) => {
          if (!Array.isArray(raw)) throw new Error(`Expected array, got ${typeof raw}`);
          const map = new Map<K, V>();
          for (const entry of raw) {
            if (!Array.isArray(entry) || entry.length !== 2) {
              throw new Error("Expected [key, value] pair");
            }
            map.set(keyBasic.parseRaw(entry[0]), valueBasic.parseRaw(entry[1]));
          }
          return map;
        },
        // Keys parse injectively (guarded above); distinct raw dicts can
        // still collapse if value parsing does.
        valueBasic.injectiveParse,
      );
    } else {
      this.basic = null;
    }
  }

  doDraw(tc: TestCase): Map<K, V> {
    if (this.basic) return this.basic.doDraw(tc);
    tc.startSpan(Labels.MAP);
    const collection = new Collection(tc, this.minSize, this.maxSize ?? undefined);
    const result = new Map<K, V>();
    while (collection.more()) {
      tc.startSpan(Labels.MAP_ENTRY);
      const key = this.keys.doDraw(tc);
      const value = this.values.doDraw(tc);
      tc.stopSpan();
      if ([...result.keys()].some((existing) => valuesEqual(existing, key))) {
        collection.reject("duplicate key");
        continue;
      }
      result.set(key, value);
    }
    tc.stopSpan();
    return result;
  }

  override asBasic(): BasicGenerator<Map<K, V>> | null {
    return this.basic;
  }
}

/**
 * Generate Maps with keys and values from the given generators.
 *
 * Keys are deduplicated by structural value equality ({@link valuesEqual}),
 * not merely by reference: the generated Map never contains two structurally
 * equal keys, and `minSize`/`maxSize` count structurally distinct keys.
 */
export function maps<K, V>(
  keys: Generator<K>,
  values: Generator<V>,
  options?: CollectionOptions,
): Generator<Map<K, V>> {
  return new MapsGenerator(keys, values, options);
}
