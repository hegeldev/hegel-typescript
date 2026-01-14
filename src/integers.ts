import { generateFromSchema } from "./connection.js";
import { Generator, JsonSchema } from "./generator.js";
import { FuncGenerator } from "./generator.js";

/**
 * Safe integer bounds in JavaScript.
 */
const MIN_SAFE_INTEGER = Number.MIN_SAFE_INTEGER;
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

/**
 * Generator for integer values with builder pattern.
 */
export class IntegerGenerator implements Generator<number> {
  private constructor(
    private readonly _min: number = MIN_SAFE_INTEGER,
    private readonly _max: number = MAX_SAFE_INTEGER
  ) {}

  /**
   * Create a new IntegerGenerator.
   */
  static create(): IntegerGenerator {
    return new IntegerGenerator();
  }

  /**
   * Set the minimum value (inclusive).
   */
  min(value: number): IntegerGenerator {
    return new IntegerGenerator(value, this._max);
  }

  /**
   * Set the maximum value (inclusive).
   */
  max(value: number): IntegerGenerator {
    return new IntegerGenerator(this._min, value);
  }

  generate(): number {
    return generateFromSchema<number>(this.schema());
  }

  schema(): JsonSchema {
    return {
      type: "integer",
      minimum: this._min,
      maximum: this._max,
    };
  }

  map<U>(f: (value: number) => U): Generator<U> {
    return new FuncGenerator(() => f(this.generate()));
  }

  flatMap<U>(f: (value: number) => Generator<U>): Generator<U> {
    return new FuncGenerator(() => f(this.generate()).generate());
  }

  filter(
    predicate: (value: number) => boolean,
    maxAttempts = 3
  ): Generator<number> {
    return new FuncGenerator(() => {
      for (let i = 0; i < maxAttempts; i++) {
        const value = this.generate();
        if (predicate(value)) return value;
      }
      throw new Error(
        `filter: failed after ${maxAttempts} attempts`
      );
    });
  }
}

/**
 * Create a generator for integer values.
 *
 * @example
 * ```typescript
 * // Generate any integer
 * const gen = integers();
 *
 * // Generate integers in a range
 * const bounded = integers().min(0).max(100);
 * ```
 */
export function integers(): IntegerGenerator {
  return IntegerGenerator.create();
}
