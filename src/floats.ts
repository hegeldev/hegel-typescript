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
    private readonly _allowNan: boolean = true,
    private readonly _allowInfinity: boolean = true,
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
   * Set whether NaN values can be generated.
   */
  allowNan(allow: boolean): FloatGenerator {
    return new FloatGenerator(
      this._min,
      this._max,
      this._excludeMin,
      this._excludeMax,
      allow,
      this._allowInfinity,
    )
  }

  /**
   * Set whether infinity values can be generated.
   */
  allowInfinity(allow: boolean): FloatGenerator {
    return new FloatGenerator(
      this._min,
      this._max,
      this._excludeMin,
      this._excludeMax,
      this._allowNan,
      allow,
    )
  }

  generate(): number {
    return generateFromSchema<number>(this.schema())
  }

  schema(): JsonSchema {
    const schema: JsonSchema = {
      type: "number",
      exclude_minimum: this._excludeMin,
      exclude_maximum: this._excludeMax,
      allow_nan: this._allowNan,
      allow_infinity: this._allowInfinity,
      width: 64, // JavaScript numbers are always f64
    }

    if (this._min !== undefined) {
      schema.minimum = this._min
    }

    if (this._max !== undefined) {
      schema.maximum = this._max
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
