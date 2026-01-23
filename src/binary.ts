import { generateFromSchema } from "./connection.js";
import { FuncGenerator, Generator, JsonSchema } from "./generator.js";

/**
 * Options for binary generator.
 */
export interface BinaryOptions {
  /** Minimum size in bytes (default: 0) */
  minSize?: number;
  /** Maximum size in bytes (default: no limit) */
  maxSize?: number;
}

/**
 * Generator for binary data (byte sequences).
 */
class BinaryGenerator extends FuncGenerator<Uint8Array> {
  private readonly _binarySchema: JsonSchema;

  constructor(options: BinaryOptions = {}) {
    const schema: JsonSchema = { type: "binary" };
    if (options.minSize !== undefined && options.minSize > 0) {
      schema.min_size = options.minSize;
    }
    if (options.maxSize !== undefined) {
      schema.max_size = options.maxSize;
    }

    super(
      () => {
        const b64 = generateFromSchema<string>(schema);
        // Decode base64 to Uint8Array
        const binaryString = atob(b64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
      },
      schema
    );
    this._binarySchema = schema;
  }

  override schema(): JsonSchema {
    return this._binarySchema;
  }
}

/**
 * Create a generator for binary data (byte sequences).
 *
 * @param options - Size constraints
 * @returns Generator producing Uint8Array
 *
 * @example
 * ```typescript
 * // Generate any byte sequence
 * const gen = binary();
 *
 * // Generate 16-32 bytes
 * const bounded = binary({ minSize: 16, maxSize: 32 });
 * ```
 */
export function binary(options: BinaryOptions = {}): Generator<Uint8Array> {
  return new BinaryGenerator(options);
}
