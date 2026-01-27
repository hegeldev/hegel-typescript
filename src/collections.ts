import { generateFromSchema, assume } from "./connection.js"
import { Generator, JsonSchema, FuncGenerator } from "./generator.js"
import { integers } from "./integers.js"
import { text } from "./strings.js"
import { LABELS } from "./labels.js"
import { group } from "./spans.js"

/**
 * Generator for arrays with builder pattern.
 */
export class ArrayGenerator<T> implements Generator<T[]> {
  private constructor(
    private readonly elements: Generator<T>,
    private readonly _minSize: number = 0,
    private readonly _maxSize?: number,
    private readonly _unique: boolean = false,
  ) {}

  static create<T>(elements: Generator<T>): ArrayGenerator<T> {
    return new ArrayGenerator(elements)
  }

  /**
   * Set the minimum array size.
   */
  minSize(value: number): ArrayGenerator<T> {
    return new ArrayGenerator(this.elements, value, this._maxSize, this._unique)
  }

  /**
   * Set the maximum array size.
   */
  maxSize(value: number): ArrayGenerator<T> {
    return new ArrayGenerator(this.elements, this._minSize, value, this._unique)
  }

  /**
   * Require all elements to be unique.
   */
  unique(): ArrayGenerator<T> {
    return new ArrayGenerator(this.elements, this._minSize, this._maxSize, true)
  }

  generate(): T[] {
    const schema = this.schema()
    if (schema) {
      // Schema composition: single socket round-trip
      return generateFromSchema<T[]>(schema)
    }

    // Compositional fallback: generate length, then each element
    return group(LABELS.LIST, () => {
      const maxSize = this._maxSize ?? 100
      const length = integers().min(this._minSize).max(maxSize).generate()

      if (this._unique) {
        // For unique arrays, track seen values
        const seen = new Set<string>()
        const result: T[] = []
        const maxAttempts = length * 10
        let attempts = 0

        while (result.length < length && attempts < maxAttempts) {
          const value = group(LABELS.LIST_ELEMENT, () => this.elements.generate())
          const key = JSON.stringify(value)
          if (!seen.has(key)) {
            seen.add(key)
            result.push(value)
          }
          attempts++
        }

        assume(result.length >= this._minSize)

        return result
      }

      const result: T[] = []
      for (let i = 0; i < length; i++) {
        result.push(group(LABELS.LIST_ELEMENT, () => this.elements.generate()))
      }
      return result
    })
  }

  schema(): JsonSchema | null {
    const elementSchema = this.elements.schema()
    if (!elementSchema) {
      return null // Fall back to compositional generation
    }

    const schema: JsonSchema = {
      type: this._unique ? "set" : "list",
      elements: elementSchema,
      min_size: this._minSize,
    }

    if (this._maxSize !== undefined) {
      schema.max_size = this._maxSize
    }

    return schema
  }

  map<U>(f: (value: T[]) => U): Generator<U> {
    return new FuncGenerator(() => f(this.generate()))
  }

  flatMap<U>(f: (value: T[]) => Generator<U>): Generator<U> {
    return new FuncGenerator(() => f(this.generate()).generate())
  }

  filter(predicate: (value: T[]) => boolean, maxAttempts = 3): Generator<T[]> {
    return new FuncGenerator(() => {
      for (let i = 0; i < maxAttempts; i++) {
        const value = this.generate()
        if (predicate(value)) return value
      }
      throw new Error(`filter: failed after ${maxAttempts} attempts`)
    })
  }
}

/**
 * Create a generator for arrays.
 *
 * @example
 * ```typescript
 * // Generate array of integers
 * const gen = arrays(integers());
 *
 * // Generate array with size bounds
 * const bounded = arrays(integers()).minSize(1).maxSize(10);
 *
 * // Generate array with unique elements
 * const uniqueGen = arrays(integers()).unique();
 * ```
 */
export function arrays<T>(elements: Generator<T>): ArrayGenerator<T> {
  return ArrayGenerator.create(elements)
}

/**
 * Generator for Sets.
 * Internally generates unique arrays and converts to Set.
 */
export class SetGenerator<T> implements Generator<Set<T>> {
  private constructor(
    private readonly elements: Generator<T>,
    private readonly _minSize: number = 0,
    private readonly _maxSize?: number,
  ) {}

  static create<T>(elements: Generator<T>): SetGenerator<T> {
    return new SetGenerator(elements)
  }

  /**
   * Set the minimum set size.
   */
  minSize(value: number): SetGenerator<T> {
    return new SetGenerator(this.elements, value, this._maxSize)
  }

  /**
   * Set the maximum set size.
   */
  maxSize(value: number): SetGenerator<T> {
    return new SetGenerator(this.elements, this._minSize, value)
  }

  generate(): Set<T> {
    // Generate as unique array, then convert to Set
    const arr = arrays(this.elements)
      .minSize(this._minSize)
      .maxSize(this._maxSize ?? 100)
      .unique()
      .generate()
    return new Set(arr)
  }

  schema(): JsonSchema | null {
    const elementSchema = this.elements.schema()
    if (!elementSchema) {
      return null
    }

    const schema: JsonSchema = {
      type: "set",
      elements: elementSchema,
      min_size: this._minSize,
    }

    if (this._maxSize !== undefined) {
      schema.max_size = this._maxSize
    }

    return schema
  }

  map<U>(f: (value: Set<T>) => U): Generator<U> {
    return new FuncGenerator(() => f(this.generate()))
  }

  flatMap<U>(f: (value: Set<T>) => Generator<U>): Generator<U> {
    return new FuncGenerator(() => f(this.generate()).generate())
  }

  filter(predicate: (value: Set<T>) => boolean, maxAttempts = 3): Generator<Set<T>> {
    return new FuncGenerator(() => {
      for (let i = 0; i < maxAttempts; i++) {
        const value = this.generate()
        if (predicate(value)) return value
      }
      throw new Error(`filter: failed after ${maxAttempts} attempts`)
    })
  }
}

/**
 * Create a generator for Sets.
 */
export function sets<T>(elements: Generator<T>): SetGenerator<T> {
  return SetGenerator.create(elements)
}

/**
 * Generator for Maps (dictionaries) with configurable key and value types.
 */
export class MapGenerator<K, V> implements Generator<Map<K, V>> {
  private constructor(
    private readonly keys: Generator<K>,
    private readonly values: Generator<V>,
    private readonly _minSize: number = 0,
    private readonly _maxSize?: number,
  ) {}

  static create<K, V>(keys: Generator<K>, values: Generator<V>): MapGenerator<K, V> {
    return new MapGenerator(keys, values)
  }

  /**
   * Set the minimum map size.
   */
  minSize(value: number): MapGenerator<K, V> {
    return new MapGenerator(this.keys, this.values, value, this._maxSize)
  }

  /**
   * Set the maximum map size.
   */
  maxSize(value: number): MapGenerator<K, V> {
    return new MapGenerator(this.keys, this.values, this._minSize, value)
  }

  generate(): Map<K, V> {
    const schema = this.schema()
    if (schema) {
      // Schema composition: single socket round-trip
      // Wire format is [[key, value], ...]
      const pairs = generateFromSchema<[K, V][]>(schema)
      return new Map(pairs)
    }

    // Compositional fallback
    return group(LABELS.MAP, () => {
      const maxSize = this._maxSize ?? 100
      const targetSize = integers().min(this._minSize).max(maxSize).generate()
      const result = new Map<K, V>()
      const maxAttempts = targetSize * 10
      let attempts = 0

      while (result.size < targetSize && attempts < maxAttempts) {
        group(LABELS.MAP_ENTRY, () => {
          const key = this.keys.generate()
          if (!result.has(key)) {
            result.set(key, this.values.generate())
          }
        })
        attempts++
      }

      assume(result.size >= this._minSize)

      return result
    })
  }

  schema(): JsonSchema | null {
    const keySchema = this.keys.schema()
    const valueSchema = this.values.schema()
    if (!keySchema || !valueSchema) {
      return null
    }

    const schema: JsonSchema = {
      type: "dict",
      keys: keySchema,
      values: valueSchema,
      min_size: this._minSize,
    }

    if (this._maxSize !== undefined) {
      schema.max_size = this._maxSize
    }

    return schema
  }

  map<U>(f: (value: Map<K, V>) => U): Generator<U> {
    return new FuncGenerator(() => f(this.generate()))
  }

  flatMap<U>(f: (value: Map<K, V>) => Generator<U>): Generator<U> {
    return new FuncGenerator(() => f(this.generate()).generate())
  }

  filter(
    predicate: (value: Map<K, V>) => boolean,
    maxAttempts = 3,
  ): Generator<Map<K, V>> {
    return new FuncGenerator(() => {
      for (let i = 0; i < maxAttempts; i++) {
        const value = this.generate()
        if (predicate(value)) return value
      }
      throw new Error(`filter: failed after ${maxAttempts} attempts`)
    })
  }
}

/**
 * Create a generator for Maps with configurable key and value types.
 *
 * @example
 * ```typescript
 * // String keys (common case)
 * const strMap = maps(text(), integers());
 *
 * // Integer keys
 * const intMap = maps(integers(), text());
 * ```
 */
export function maps<K, V>(
  keys: Generator<K>,
  values: Generator<V>,
): MapGenerator<K, V> {
  return MapGenerator.create(keys, values)
}

/**
 * Generator for tuples (fixed-length heterogeneous arrays).
 */
class TupleGenerator<T extends unknown[]> implements Generator<T> {
  constructor(private readonly generators: Generator<unknown>[]) {}

  generate(): T {
    const schema = this.schema()
    if (schema) {
      return generateFromSchema<T>(schema)
    }

    // Compositional fallback
    return group(LABELS.TUPLE, () => {
      return this.generators.map(gen => gen.generate()) as T
    })
  }

  schema(): JsonSchema | null {
    const schemas: JsonSchema[] = []
    for (const gen of this.generators) {
      const s = gen.schema()
      if (!s) return null
      schemas.push(s)
    }

    return {
      type: "tuple",
      elements: schemas,
    }
  }

  map<U>(f: (value: T) => U): Generator<U> {
    return new FuncGenerator(() => f(this.generate()))
  }

  flatMap<U>(f: (value: T) => Generator<U>): Generator<U> {
    return new FuncGenerator(() => f(this.generate()).generate())
  }

  filter(predicate: (value: T) => boolean, maxAttempts = 3): Generator<T> {
    return new FuncGenerator(() => {
      for (let i = 0; i < maxAttempts; i++) {
        const value = this.generate()
        if (predicate(value)) return value
      }
      throw new Error(`filter: failed after ${maxAttempts} attempts`)
    })
  }
}

/**
 * Create a generator for tuples (fixed-length heterogeneous arrays).
 *
 * @example
 * ```typescript
 * const gen = tuples(integers(), text(), booleans());
 * const [num, str, bool] = gen.generate();
 * ```
 */
export function tuples<T extends unknown[]>(
  ...generators: { [K in keyof T]: Generator<T[K]> }
): Generator<T> {
  return new TupleGenerator<T>(generators)
}
