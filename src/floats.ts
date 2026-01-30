import { generateFromSchema } from "./connection.js"
import { JsonSchema, BaseGenerator } from "./generator.js"

/**
 * Generator for floating-point values with builder pattern.
 */
export class FloatGenerator extends BaseGenerator<number> {
  private constructor(
    private readonly _min?: number,
    private readonly _max?: number,
    private readonly _excludeMin: boolean = false,
    private readonly _excludeMax: boolean = false,
    private readonly _allowNan: boolean = false,
    private readonly _allowInfinity: boolean = false,
  ) {
    super()
  }

  /**
   * Create a new FloatGenerator.
   */
  static create(): FloatGenerator {
    return new FloatGenerator()
  }

  /**
   * Set the minimum value.
   */
  min(value: number): FloatGenerator {
    return new FloatGenerator(
      value,
      this._max,
      this._excludeMin,
      this._excludeMax,
      this._allowNan,
      this._allowInfinity,
    )
  }

  /**
   * Set the maximum value.
   */
  max(value: number): FloatGenerator {
    return new FloatGenerator(
      this._min,
      value,
      this._excludeMin,
      this._excludeMax,
      this._allowNan,
      this._allowInfinity,
    )
  }

  /**
   * Exclude the minimum value from the range.
   */
  excludeMin(): FloatGenerator {
    return new FloatGenerator(
      this._min,
      this._max,
      true,
      this._excludeMax,
      this._allowNan,
      this._allowInfinity,
    )
  }

  /**
   * Exclude the maximum value from the range.
   */
  excludeMax(): FloatGenerator {
    return new FloatGenerator(
      this._min,
      this._max,
      this._excludeMin,
      true,
      this._allowNan,
      this._allowInfinity,
    )
  }

  /**
   * Allow NaN values to be generated.
   */
  allowNan(): FloatGenerator {
    return new FloatGenerator(
      this._min,
      this._max,
      this._excludeMin,
      this._excludeMax,
      true,
      this._allowInfinity,
    )
  }

  /**
   * Allow infinity values to be generated.
   */
  allowInfinity(): FloatGenerator {
    return new FloatGenerator(
      this._min,
      this._max,
      this._excludeMin,
      this._excludeMax,
      this._allowNan,
      true,
    )
  }

  generate(): number {
    return generateFromSchema<number>(this.schema())
  }

  schema(): JsonSchema {
    const schema: JsonSchema = { type: "number" }

    if (this._min !== undefined) {
      schema.minimum = this._min
      if (this._excludeMin) {
        schema.exclude_minimum = true
      }
    }

    if (this._max !== undefined) {
      schema.maximum = this._max
      if (this._excludeMax) {
        schema.exclude_maximum = true
      }
    }

    if (this._allowNan) {
      schema.allow_nan = true
    }

    if (this._allowInfinity) {
      schema.allow_infinity = true
    }

    return schema
  }
}

/**
 * Create a generator for floating-point values.
 *
 * @example
 * ```typescript
 * // Generate any float
 * const gen = floats();
 *
 * // Generate floats in a range (exclusive)
 * const bounded = floats().min(0).max(1).excludeMin().excludeMax();
 * ```
 */
export function floats(): FloatGenerator {
  return FloatGenerator.create()
}
