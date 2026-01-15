import { generateFromSchema, assume } from "./connection.js";
import { LABELS } from "./labels.js";
import { discardableGroup, group } from "./spans.js";

/**
 * JSON Schema type for generator schemas.
 */
export type JsonSchema = Record<string, unknown>;

/**
 * Core Generator interface.
 * All generators implement this interface.
 */
export interface Generator<T> {
  /**
   * Generate a value of type T.
   */
  generate(): T;

  /**
   * Get the JSON Schema for this generator, or null if unavailable.
   * When a schema is available, generation is more efficient (single socket round-trip).
   */
  schema(): JsonSchema | null;

  /**
   * Transform generated values with a function.
   * Note: This invalidates the schema, causing compositional generation.
   */
  map<U>(f: (value: T) => U): Generator<U>;

  /**
   * Dependent generation where the next generator depends on the generated value.
   * Note: This invalidates the schema, causing compositional generation.
   */
  flatMap<U>(f: (value: T) => Generator<U>): Generator<U>;

  /**
   * Filter generated values by a predicate.
   * Note: This invalidates the schema, causing compositional generation.
   * @param predicate - Function that returns true for valid values
   * @param maxAttempts - Maximum attempts before rejecting (default: 3)
   */
  filter(predicate: (value: T) => boolean, maxAttempts?: number): Generator<T>;
}

/**
 * Schema-based generator that uses a JSON schema for generation.
 * Provides efficient single socket round-trip generation.
 */
export class SchemaGenerator<T> implements Generator<T> {
  constructor(private readonly _schema: JsonSchema) {}

  generate(): T {
    return generateFromSchema<T>(this._schema);
  }

  schema(): JsonSchema {
    return this._schema;
  }

  map<U>(f: (value: T) => U): Generator<U> {
    return new MappedGenerator(this, f);
  }

  flatMap<U>(f: (value: T) => Generator<U>): Generator<U> {
    return new FlatMappedGenerator(this, f);
  }

  filter(predicate: (value: T) => boolean, maxAttempts = 3): Generator<T> {
    return new FilteredGenerator(this, predicate, maxAttempts);
  }
}

/**
 * Function-based generator that wraps a generation function.
 * May or may not have a schema.
 */
export class FuncGenerator<T> implements Generator<T> {
  constructor(
    private readonly genFn: () => T,
    private readonly _schema: JsonSchema | null = null
  ) {}

  generate(): T {
    return this.genFn();
  }

  schema(): JsonSchema | null {
    return this._schema;
  }

  map<U>(f: (value: T) => U): Generator<U> {
    return new MappedGenerator(this, f);
  }

  flatMap<U>(f: (value: T) => Generator<U>): Generator<U> {
    return new FlatMappedGenerator(this, f);
  }

  filter(predicate: (value: T) => boolean, maxAttempts = 3): Generator<T> {
    return new FilteredGenerator(this, predicate, maxAttempts);
  }
}

/**
 * Generator that transforms values from another generator.
 * Always has no schema (transformation invalidates it).
 */
class MappedGenerator<T, U> implements Generator<U> {
  constructor(
    private readonly source: Generator<T>,
    private readonly f: (value: T) => U
  ) {}

  generate(): U {
    return this.f(this.source.generate());
  }

  schema(): null {
    // Transformation invalidates schema
    return null;
  }

  map<V>(f: (value: U) => V): Generator<V> {
    return new MappedGenerator(this, f);
  }

  flatMap<V>(f: (value: U) => Generator<V>): Generator<V> {
    return new FlatMappedGenerator(this, f);
  }

  filter(predicate: (value: U) => boolean, maxAttempts = 3): Generator<U> {
    return new FilteredGenerator(this, predicate, maxAttempts);
  }
}

/**
 * Generator for dependent generation.
 * The next generator depends on the value from the first generator.
 * Always has no schema.
 */
class FlatMappedGenerator<T, U> implements Generator<U> {
  constructor(
    private readonly source: Generator<T>,
    private readonly f: (value: T) => Generator<U>
  ) {}

  generate(): U {
    return group(LABELS.FLAT_MAP, () => {
      const intermediate = this.source.generate();
      const nextGen = this.f(intermediate);
      return nextGen.generate();
    });
  }

  schema(): null {
    // Dependent generation can't have static schema
    return null;
  }

  map<V>(f: (value: U) => V): Generator<V> {
    return new MappedGenerator(this, f);
  }

  flatMap<V>(f: (value: U) => Generator<V>): Generator<V> {
    return new FlatMappedGenerator(this, f);
  }

  filter(predicate: (value: U) => boolean, maxAttempts = 3): Generator<U> {
    return new FilteredGenerator(this, predicate, maxAttempts);
  }
}

/**
 * Generator that filters values by a predicate.
 * Retries up to maxAttempts times before rejecting.
 * Always has no schema.
 */
class FilteredGenerator<T> implements Generator<T> {
  constructor(
    private readonly source: Generator<T>,
    private readonly predicate: (value: T) => boolean,
    private readonly maxAttempts: number
  ) {}

  generate(): T {
    for (let i = 0; i < this.maxAttempts; i++) {
      const result = discardableGroup(LABELS.FILTER, () => {
        const value = this.source.generate();
        return this.predicate(value) ? value : null;
      });

      if (result !== null) {
        return result;
      }
    }

    assume(false);
  }

  schema(): null {
    // Filter invalidates schema
    return null;
  }

  map<U>(f: (value: T) => U): Generator<U> {
    return new MappedGenerator(this, f);
  }

  flatMap<U>(f: (value: T) => Generator<U>): Generator<U> {
    return new FlatMappedGenerator(this, f);
  }

  filter(predicate: (value: T) => boolean, maxAttempts = 3): Generator<T> {
    return new FilteredGenerator(this, predicate, maxAttempts);
  }
}
