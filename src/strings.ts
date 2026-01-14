import { generateFromSchema } from "./connection.js";
import { Generator, JsonSchema, FuncGenerator } from "./generator.js";

/**
 * Generator for text strings with builder pattern.
 */
export class TextGenerator implements Generator<string> {
  private constructor(
    private readonly _minSize: number = 0,
    private readonly _maxSize?: number
  ) {}

  /**
   * Create a new TextGenerator.
   */
  static create(): TextGenerator {
    return new TextGenerator();
  }

  /**
   * Set the minimum size (in Unicode codepoints).
   */
  minSize(value: number): TextGenerator {
    return new TextGenerator(value, this._maxSize);
  }

  /**
   * Set the maximum size (in Unicode codepoints).
   */
  maxSize(value: number): TextGenerator {
    return new TextGenerator(this._minSize, value);
  }

  generate(): string {
    return generateFromSchema<string>(this.schema());
  }

  schema(): JsonSchema {
    const schema: JsonSchema = {
      type: "string",
      minLength: this._minSize,
    };

    if (this._maxSize !== undefined) {
      schema.maxLength = this._maxSize;
    }

    return schema;
  }

  map<U>(f: (value: string) => U): Generator<U> {
    return new FuncGenerator(() => f(this.generate()));
  }

  flatMap<U>(f: (value: string) => Generator<U>): Generator<U> {
    return new FuncGenerator(() => f(this.generate()).generate());
  }

  filter(
    predicate: (value: string) => boolean,
    maxAttempts = 3
  ): Generator<string> {
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
 * Create a generator for text strings.
 *
 * @example
 * ```typescript
 * // Generate any string
 * const gen = text();
 *
 * // Generate strings with size bounds
 * const bounded = text().minSize(1).maxSize(100);
 * ```
 */
export function text(): TextGenerator {
  return TextGenerator.create();
}

/**
 * Generator for strings matching a regex pattern.
 */
class RegexGenerator implements Generator<string> {
  private readonly _pattern: string;

  constructor(pattern: string) {
    // Auto-anchor the pattern
    let anchored = pattern;
    if (!pattern.startsWith("^")) {
      anchored = "^" + anchored;
    }
    if (!pattern.endsWith("$")) {
      anchored = anchored + "$";
    }
    this._pattern = anchored;
  }

  generate(): string {
    return generateFromSchema<string>(this.schema());
  }

  schema(): JsonSchema {
    return {
      type: "string",
      pattern: this._pattern,
    };
  }

  map<U>(f: (value: string) => U): Generator<U> {
    return new FuncGenerator(() => f(this.generate()));
  }

  flatMap<U>(f: (value: string) => Generator<U>): Generator<U> {
    return new FuncGenerator(() => f(this.generate()).generate());
  }

  filter(
    predicate: (value: string) => boolean,
    maxAttempts = 3
  ): Generator<string> {
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
 * Create a generator for strings matching a regex pattern.
 * The pattern is automatically anchored with ^ and $ if not present.
 *
 * @param pattern - Regular expression pattern (JSON Schema regex syntax)
 *
 * @example
 * ```typescript
 * // Generate strings matching a pattern
 * const hexGen = fromRegex("[0-9a-f]+");
 * ```
 */
export function fromRegex(pattern: string): Generator<string> {
  return new RegexGenerator(pattern);
}
