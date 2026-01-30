import { generateFromSchema } from "./connection.js"
import { Generator, JsonSchema, BaseGenerator } from "./generator.js"
import { LABELS } from "./labels.js"
import { group } from "./spans.js"

/**
 * Field definition for fixed objects.
 */
interface FieldDef {
  name: string
  generator: Generator<unknown>
}

/**
 * Builder for fixed object generators.
 * Allows defining objects with specific fields and their generators.
 */
export class FixedObjectBuilder<T extends Record<string, unknown>> {
  private readonly fields: FieldDef[]

  private constructor(fields: FieldDef[] = []) {
    this.fields = fields
  }

  /**
   * Create a new FixedObjectBuilder.
   */
  static create(): FixedObjectBuilder<Record<string, never>> {
    return new FixedObjectBuilder([])
  }

  /**
   * Add a field to the object.
   */
  field<K extends string, V>(
    name: K,
    generator: Generator<V>,
  ): FixedObjectBuilder<T & Record<K, V>> {
    return new FixedObjectBuilder<T & Record<K, V>>([
      ...this.fields,
      { name, generator },
    ])
  }

  /**
   * Build the generator.
   */
  build(): Generator<T> {
    return new FixedObjectGenerator<T>(this.fields)
  }
}

/**
 * Generator for fixed objects with predefined fields.
 */
class FixedObjectGenerator<T extends Record<string, unknown>> extends BaseGenerator<T> {
  constructor(private readonly fields: FieldDef[]) {
    super()
  }

  generate(): T {
    const schema = this.schema()
    if (schema) {
      const values = generateFromSchema<unknown[]>(schema)
      // Convert tuple back to object
      const result: Record<string, unknown> = {}
      for (let i = 0; i < this.fields.length; i++) {
        result[this.fields[i].name] = values[i]
      }
      return result as T
    }

    // Compositional fallback
    return group(LABELS.FIXED_OBJECT, () => {
      const result: Record<string, unknown> = {}
      for (const field of this.fields) {
        result[field.name] = field.generator.generate()
      }
      return result as T
    })
  }

  schema(): JsonSchema | null {
    const elements: JsonSchema[] = []

    for (const field of this.fields) {
      const fieldSchema = field.generator.schema()
      if (!fieldSchema) return null
      elements.push(fieldSchema)
    }

    return {
      type: "tuple",
      elements,
    }
  }
}

/**
 * Create a builder for fixed objects.
 * Use this to generate objects with specific fields.
 *
 * @example
 * ```typescript
 * const personGen = fixedObject()
 *   .field("name", text().minSize(1).maxSize(50))
 *   .field("age", integers().min(0).max(120))
 *   .field("email", emails())
 *   .build();
 *
 * const person = personGen.generate();
 * // { name: "...", age: 42, email: "..." }
 * ```
 */
export function fixedObject(): FixedObjectBuilder<Record<string, never>> {
  return FixedObjectBuilder.create()
}
