/**
 * Collection generators: arrays/lists, sets, and maps/dicts.
 *
 * @packageDocumentation
 */

import { TestCase, Collection, Labels } from "../testCase.js";
import { Generator, BasicGenerator, CompositeGenerator } from "./core.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface CollectionOptions {
  minSize?: number;
  maxSize?: number;
}

export interface ArrayOptions extends CollectionOptions {
  unique?: boolean;
}

// ---------------------------------------------------------------------------
// Arrays (lists)
// ---------------------------------------------------------------------------

/** Generate arrays with elements from the given generator. */
export function arrays<T>(elements: Generator<T>, options?: ArrayOptions): Generator<T[]> {
  const minSize = options?.minSize ?? 0;
  const maxSize = options?.maxSize ?? null;
  const unique = options?.unique ?? false;

  if (maxSize !== null && minSize > maxSize) {
    throw new Error("Cannot have maxSize < minSize");
  }

  // Try schema-based path
  const elementBasic = elements.asBasic();
  if (elementBasic) {
    const schema: Record<string, unknown> = {
      type: "list",
      unique,
      elements: elementBasic.schema,
      min_size: minSize,
    };
    if (maxSize !== null) schema["max_size"] = maxSize;

    return new BasicGenerator(schema, (raw) => {
      if (!Array.isArray(raw)) throw new Error(`Expected array, got ${typeof raw}`);
      return raw.map((v: unknown) => elementBasic.parseRaw(v));
    });
  }

  // Fallback: collection protocol
  return new CompositeGenerator((tc: TestCase) => {
    tc.startSpan(Labels.LIST);
    const collection = new Collection(tc, minSize, maxSize ?? undefined);
    const result: T[] = [];
    while (collection.more()) {
      const element = elements.doDraw(tc);
      if (unique) {
        if (result.some((existing) => JSON.stringify(existing) === JSON.stringify(element))) {
          collection.reject("duplicate element");
          continue;
        }
      }
      result.push(element);
    }
    tc.stopSpan(false);
    return result;
  });
}

export { arrays as lists };

// ---------------------------------------------------------------------------
// Sets
// ---------------------------------------------------------------------------

/** Generate Sets with elements from the given generator. */
export function sets<T>(elements: Generator<T>, options?: CollectionOptions): Generator<Set<T>> {
  const minSize = options?.minSize ?? 0;
  const maxSize = options?.maxSize ?? null;

  if (maxSize !== null && minSize > maxSize) {
    throw new Error("Cannot have maxSize < minSize");
  }

  const elementBasic = elements.asBasic();
  if (elementBasic) {
    const schema: Record<string, unknown> = {
      type: "list",
      unique: true,
      elements: elementBasic.schema,
      min_size: minSize,
    };
    if (maxSize !== null) schema["max_size"] = maxSize;

    return new BasicGenerator(schema, (raw) => {
      if (!Array.isArray(raw)) throw new Error(`Expected array, got ${typeof raw}`);
      return new Set(raw.map((v: unknown) => elementBasic.parseRaw(v)));
    });
  }

  return new CompositeGenerator((tc: TestCase) => {
    tc.startSpan(Labels.SET);
    const collection = new Collection(tc, minSize, maxSize ?? undefined);
    const result = new Set<T>();
    while (collection.more()) {
      const element = elements.doDraw(tc);
      if (result.has(element)) {
        collection.reject("duplicate element");
        continue;
      }
      result.add(element);
    }
    tc.stopSpan(false);
    return result;
  });
}

// ---------------------------------------------------------------------------
// Maps (dicts)
// ---------------------------------------------------------------------------

/** Generate Maps with keys and values from the given generators. */
export function maps<K, V>(
  keys: Generator<K>,
  values: Generator<V>,
  options?: CollectionOptions,
): Generator<Map<K, V>> {
  const minSize = options?.minSize ?? 0;
  const maxSize = options?.maxSize ?? null;

  if (maxSize !== null && minSize > maxSize) {
    throw new Error("Cannot have maxSize < minSize");
  }

  const keyBasic = keys.asBasic();
  const valueBasic = values.asBasic();

  if (keyBasic && valueBasic) {
    const schema: Record<string, unknown> = {
      type: "dict",
      keys: keyBasic.schema,
      values: valueBasic.schema,
      min_size: minSize,
    };
    if (maxSize !== null) schema["max_size"] = maxSize;

    return new BasicGenerator(schema, (raw) => {
      if (!Array.isArray(raw)) throw new Error(`Expected array, got ${typeof raw}`);
      const map = new Map<K, V>();
      for (const entry of raw) {
        if (!Array.isArray(entry) || entry.length !== 2) {
          throw new Error("Expected [key, value] pair");
        }
        map.set(keyBasic.parseRaw(entry[0]), valueBasic.parseRaw(entry[1]));
      }
      return map;
    });
  }

  return new CompositeGenerator((tc: TestCase) => {
    tc.startSpan(Labels.MAP);
    const collection = new Collection(tc, minSize, maxSize ?? undefined);
    const result = new Map<K, V>();
    while (collection.more()) {
      tc.startSpan(Labels.MAP_ENTRY);
      const key = keys.doDraw(tc);
      const value = values.doDraw(tc);
      tc.stopSpan(false);
      if (result.has(key)) {
        collection.reject("duplicate key");
        continue;
      }
      result.set(key, value);
    }
    tc.stopSpan(false);
    return result;
  });
}

export { maps as dicts };
