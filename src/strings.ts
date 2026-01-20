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
      min_size: this._minSize,
    };

    if (this._maxSize !== undefined) {
      schema.max_size = this._maxSize;
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
export class RegexGenerator implements Generator<string> {
  private readonly _pattern: string;
  private _fullmatch: boolean = false;

  constructor(pattern: string) {
    this._pattern = pattern;
  }

  /**
   * Require the entire string to match the pattern, not just contain a match.
   */
  fullmatch(): RegexGenerator {
    this._fullmatch = true;
    return this;
  }

  generate(): string {
    return generateFromSchema<string>(this.schema());
  }

  schema(): JsonSchema {
    const schema: JsonSchema = {
      type: "regex",
      pattern: this._pattern,
    };
    if (this._fullmatch) {
      schema.fullmatch = true;
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
 * Create a generator for strings that contain a match for the given regex pattern.
 * Use `.fullmatch()` to require the entire string to match.
 *
 * @param pattern - Regular expression pattern (JSON Schema regex syntax)
 *
 * @example
 * ```typescript
 * // Generate strings containing a match
 * const hexGen = fromRegex("[0-9a-f]+");
 *
 * // Generate strings that fully match
 * const fullHexGen = fromRegex("[0-9a-f]+").fullmatch();
 * ```
 */
export function fromRegex(pattern: string): RegexGenerator {
  return new RegexGenerator(pattern);
}
