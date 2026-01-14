import { generateFromSchema } from "./connection.js";
import { Generator, JsonSchema, FuncGenerator } from "./generator.js";
import { LABELS } from "./labels.js";
import { group } from "./spans.js";

/**
 * Field definition for fixed objects.
 */
interface FieldDef {
  name: string;
  generator: Generator<unknown>;
}

/**
 * Builder for fixed object generators.
 * Allows defining objects with specific fields and their generators.
 */
export class FixedObjectBuilder<T extends Record<string, unknown>> {
  private readonly fields: FieldDef[];

  private constructor(fields: FieldDef[] = []) {
    this.fields = fields;
  }

  /**
   * Create a new FixedObjectBuilder.
   */
  static create(): FixedObjectBuilder<Record<string, never>> {
    return new FixedObjectBuilder([]);
  }

  /**
   * Add a field to the object.
   */
  field<K extends string, V>(
    name: K,
    generator: Generator<V>
  ): FixedObjectBuilder<T & Record<K, V>> {
    return new FixedObjectBuilder<T & Record<K, V>>([
      ...this.fields,
      { name, generator },
    ]);
  }

  /**
   * Build the generator.
   */
  build(): Generator<T> {
    return new FixedObjectGenerator<T>(this.fields);
  }
}

/**
 * Generator for fixed objects with predefined fields.
 */
class FixedObjectGenerator<T extends Record<string, unknown>>
  implements Generator<T>
{
  constructor(private readonly fields: FieldDef[]) {}

  generate(): T {
    const schema = this.schema();
    if (schema) {
      return generateFromSchema<T>(schema);
    }

    // Compositional fallback
    return group(LABELS.FIXED_OBJECT, () => {
      const result: Record<string, unknown> = {};
      for (const field of this.fields) {
        result[field.name] = field.generator.generate();
      }
      return result as T;
    });
  }

  schema(): JsonSchema | null {
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];

    for (const field of this.fields) {
      const fieldSchema = field.generator.schema();
      if (!fieldSchema) return null;
      properties[field.name] = fieldSchema;
      required.push(field.name);
    }

    return {
      type: "object",
      properties,
      required,
    };
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
  return FixedObjectBuilder.create();
}
