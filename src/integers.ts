import { generateFromSchema } from "./connection.js"
import { JsonSchema, BaseGenerator } from "./generator.js"

/**
 * Safe integer bounds in JavaScript.
 */
const MIN_SAFE_INTEGER = Number.MIN_SAFE_INTEGER
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER

/**
 * Generator for integer values with builder pattern.
 */
export class IntegerGenerator extends BaseGenerator<number> {
  private constructor(
    private readonly _min: number = MIN_SAFE_INTEGER,
    private readonly _max: number = MAX_SAFE_INTEGER,
  ) {
    super()
  }

  /**
   * Create a new IntegerGenerator.
   */
  static create(): IntegerGenerator {
    return new IntegerGenerator()
  }

  /**
   * Set the minimum value (inclusive).
   */
  min(value: number): IntegerGenerator {
    return new IntegerGenerator(value, this._max)
  }

  /**
   * Set the maximum value (inclusive).
   */
  max(value: number): IntegerGenerator {
    return new IntegerGenerator(this._min, value)
  }

  generate(): number {
    return generateFromSchema<number>(this.schema())
  }

  schema(): JsonSchema {
    return {
      type: "integer",
      minimum: this._min,
      maximum: this._max,
    }
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
  return IntegerGenerator.create()
}
