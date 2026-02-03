import { Generator, JsonSchema, SchemaGenerator } from "./generator.js"

/**
 * Generator for null values.
 */
class NullGenerator extends SchemaGenerator<null> {
  constructor() {
    super({ type: "null" })
  }
}

/**
 * Create a generator that always produces null.
 */
export function nulls(): Generator<null> {
  return new NullGenerator()
}

/**
 * Generator for boolean values.
 */
class BooleanGenerator extends SchemaGenerator<boolean> {
  constructor() {
    super({ type: "boolean" })
  }
}

/**
 * Create a generator for boolean values.
 */
export function booleans(): Generator<boolean> {
  return new BooleanGenerator()
}

/**
 * Generator for constant values.
 */
class JustGenerator<T> extends SchemaGenerator<T> {
  constructor(private readonly value: T) {
    super({ const: value })
  }

  // Override generate to return the constant value directly
  // (no need for socket communication)
  override generate(): T {
    return this.value
  }
}

/**
 * Create a generator that always produces the same value.
 */
export function just<T>(value: T): Generator<T> {
  return new JustGenerator(value)
}
