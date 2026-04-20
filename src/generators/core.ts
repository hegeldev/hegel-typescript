/**
 * Generator base class, BasicGenerator descriptor, and internal combinators.
 *
 * @packageDocumentation
 */

import { TestCase, Labels, generateRaw, type GeneratorLike } from "../testCase.js";

/**
 * Base class for all generators. Generators produce values of type T
 * synchronously by communicating with the hegel server.
 */
export abstract class Generator<T> implements GeneratorLike<T> {
  /** @internal */
  abstract doDraw(tc: TestCase): T;

  /**
   * Return a BasicGenerator descriptor (schema + parse) if this generator can
   * be expressed as one, otherwise null. Used by parent generators that want
   * to compose a schema from their children.
   *
   * @internal
   */
  asBasic(): BasicGenerator<T> | null {
    return null;
  }

  /**
   * Transform generated values using a function.
   * When the source has a schema, the schema is preserved.
   */
  map<U>(f: (value: T) => U): Generator<U> {
    return new MappedGenerator(this, f);
  }

  /**
   * Generate a value, then use it to choose another generator.
   */
  flatMap<U>(f: (value: T) => Generator<U>): Generator<U> {
    return new FlatMappedGenerator(this, f);
  }

  /**
   * Only keep values that satisfy the predicate.
   * Retries up to 3 times, then rejects the test case.
   */
  filter(predicate: (value: T) => boolean): Generator<T> {
    return new FilteredGenerator(this, predicate);
  }
}

/**
 * Schema-based generator descriptor. Holds a schema and an optional parse
 * callback that transforms the raw server response into a value of type T.
 *
 * Other generators produce a BasicGenerator from `asBasic()` when they can be
 * expressed as a single schema, letting parent generators (oneOf, arrays, ...)
 * compose a unified schema rather than falling back to span-based draws.
 */
export class BasicGenerator<T> extends Generator<T> {
  readonly schema: Record<string, unknown>;
  private readonly parse: ((raw: unknown) => T) | null;

  constructor(schema: Record<string, unknown>, parse?: (raw: unknown) => T) {
    super();
    this.schema = schema;
    this.parse = parse ?? null;
  }

  doDraw(tc: TestCase): T {
    return this.parseRaw(generateRaw(tc, this.schema));
  }

  override asBasic(): BasicGenerator<T> {
    return this;
  }

  parseRaw(raw: unknown): T {
    return this.parse ? this.parse(raw) : (raw as T);
  }
}

class MappedGenerator<T, U> extends Generator<U> {
  constructor(
    private readonly source: Generator<T>,
    private readonly f: (value: T) => U,
  ) {
    super();
  }

  doDraw(tc: TestCase): U {
    const sourceBasic = this.source.asBasic();
    if (sourceBasic) {
      return this.f(sourceBasic.doDraw(tc));
    }
    tc.startSpan(Labels.MAPPED);
    const result = this.f(this.source.doDraw(tc));
    tc.stopSpan();
    return result;
  }

  override asBasic(): BasicGenerator<U> | null {
    const sourceBasic = this.source.asBasic();
    if (!sourceBasic) return null;
    const f = this.f;
    return new BasicGenerator(sourceBasic.schema, (raw) => f(sourceBasic.parseRaw(raw)));
  }
}

class FilteredGenerator<T> extends Generator<T> {
  constructor(
    private readonly source: Generator<T>,
    private readonly predicate: (value: T) => boolean,
  ) {
    super();
  }

  doDraw(tc: TestCase): T {
    for (let i = 0; i < 3; i++) {
      tc.startSpan(Labels.FILTER);
      const value = this.source.doDraw(tc);
      if (this.predicate(value)) {
        tc.stopSpan();
        return value;
      }
      tc.stopSpan(true);
    }
    tc.assume(false);
    throw new Error("unreachable");
  }
}

class FlatMappedGenerator<T, U> extends Generator<U> {
  constructor(
    private readonly source: Generator<T>,
    private readonly f: (value: T) => Generator<U>,
  ) {
    super();
  }

  doDraw(tc: TestCase): U {
    tc.startSpan(Labels.FLAT_MAP);
    const intermediate = this.source.doDraw(tc);
    const nextGen = this.f(intermediate);
    const result = nextGen.doDraw(tc);
    tc.stopSpan();
    return result;
  }
}
