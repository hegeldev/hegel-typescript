import { generateFromSchema } from "./connection.js";
import { Generator, JsonSchema, FuncGenerator } from "./generator.js";
import { booleans } from "./primitives.js";
import { integers } from "./integers.js";
import { LABELS } from "./labels.js";
import { group } from "./spans.js";

/**
 * Check if a value is a primitive type that can be represented in JSON Schema enum.
 */
function isPrimitive(value: unknown): boolean {
  const type = typeof value;
  return (
    type === "string" ||
    type === "number" ||
    type === "boolean" ||
    value === null
  );
}

/**
 * Generator that samples uniformly from a fixed collection.
 */
class SampledFromGenerator<T> implements Generator<T> {
  constructor(private readonly elements: readonly T[]) {
    if (elements.length === 0) {
      throw new Error("sampledFrom: cannot sample from empty array");
    }
  }

  generate(): T {
    const schema = this.schema();
    if (schema) {
      return generateFromSchema<T>(schema);
    }

    // Compositional fallback for non-primitive types
    return group(LABELS.SAMPLED_FROM, () => {
      const index = integers().min(0).max(this.elements.length - 1).generate();
      return this.elements[index];
    });
  }

  schema(): JsonSchema | null {
    // Only use enum schema for primitive types
    if (this.elements.every(isPrimitive)) {
      return { enum: this.elements as unknown[] };
    }
    return null;
  }

  map<U>(f: (value: T) => U): Generator<U> {
    return new FuncGenerator(() => f(this.generate()));
  }

  flatMap<U>(f: (value: T) => Generator<U>): Generator<U> {
    return new FuncGenerator(() => f(this.generate()).generate());
  }

  filter(predicate: (value: T) => boolean, maxAttempts = 3): Generator<T> {
    return new FuncGenerator(() => {
      for (let i = 0; i < maxAttempts; i++) {
        const value = this.generate();
        if (predicate(value)) return value;
      }
      throw new Error(`filter: failed after ${maxAttempts} attempts`);
    });
  }
}

/**
 * Create a generator that samples uniformly from a fixed collection.
 *
 * @example
 * ```typescript
 * const colors = sampledFrom(["red", "green", "blue"]);
 * const color: string = colors.generate();
 * ```
 */
export function sampledFrom<T>(elements: readonly T[]): Generator<T> {
  return new SampledFromGenerator(elements);
}

/**
 * Generator that chooses from one of several generators.
 */
class OneOfGenerator<T> implements Generator<T> {
  constructor(private readonly generators: Generator<T>[]) {
    if (generators.length === 0) {
      throw new Error("oneOf: no generators provided");
    }
  }

  generate(): T {
    const schema = this.schema();
    if (schema) {
      return generateFromSchema<T>(schema);
    }

    // Compositional fallback
    return group(LABELS.ONE_OF, () => {
      const index = integers()
        .min(0)
        .max(this.generators.length - 1)
        .generate();
      return this.generators[index].generate();
    });
  }

  schema(): JsonSchema | null {
    const schemas: JsonSchema[] = [];
    for (const gen of this.generators) {
      const s = gen.schema();
      if (!s) return null;
      schemas.push(s);
    }
    return { one_of: schemas };
  }

  map<U>(f: (value: T) => U): Generator<U> {
    return new FuncGenerator(() => f(this.generate()));
  }

  flatMap<U>(f: (value: T) => Generator<U>): Generator<U> {
    return new FuncGenerator(() => f(this.generate()).generate());
  }

  filter(predicate: (value: T) => boolean, maxAttempts = 3): Generator<T> {
    return new FuncGenerator(() => {
      for (let i = 0; i < maxAttempts; i++) {
        const value = this.generate();
        if (predicate(value)) return value;
      }
      throw new Error(`filter: failed after ${maxAttempts} attempts`);
    });
  }
}

/**
 * Create a generator that chooses from one of several generators.
 *
 * @example
 * ```typescript
 * const gen = oneOf(
 *   integers().min(0).max(10),
 *   integers().min(100).max(110)
 * );
 * ```
 */
export function oneOf<T>(...generators: Generator<T>[]): Generator<T> {
  return new OneOfGenerator(generators);
}

/**
 * Generator for optional values (T | null).
 */
class OptionalGenerator<T> implements Generator<T | null> {
  constructor(private readonly inner: Generator<T>) {}

  generate(): T | null {
    const schema = this.schema();
    if (schema) {
      return generateFromSchema<T | null>(schema);
    }

    // Compositional fallback
    return group(LABELS.OPTIONAL, () => {
      const isNull = booleans().generate();
      return isNull ? null : this.inner.generate();
    });
  }

  schema(): JsonSchema | null {
    const innerSchema = this.inner.schema();
    if (!innerSchema) return null;

    return {
      one_of: [{ type: "null" }, innerSchema],
    };
  }

  map<U>(f: (value: T | null) => U): Generator<U> {
    return new FuncGenerator(() => f(this.generate()));
  }

  flatMap<U>(f: (value: T | null) => Generator<U>): Generator<U> {
    return new FuncGenerator(() => f(this.generate()).generate());
  }

  filter(
    predicate: (value: T | null) => boolean,
    maxAttempts = 3
  ): Generator<T | null> {
    return new FuncGenerator(() => {
      for (let i = 0; i < maxAttempts; i++) {
        const value = this.generate();
        if (predicate(value)) return value;
      }
      throw new Error(`filter: failed after ${maxAttempts} attempts`);
    });
  }
}

/**
 * Create a generator for optional values (T | null).
 *
 * @example
 * ```typescript
 * const gen = optional(integers());
 * const value: number | null = gen.generate();
 * ```
 */
export function optional<T>(inner: Generator<T>): Generator<T | null> {
  return new OptionalGenerator(inner);
}
