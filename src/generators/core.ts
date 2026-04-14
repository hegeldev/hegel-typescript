/**
 * Generator base class and core internal combinators.
 *
 * @packageDocumentation
 */

import { TestCase, Labels, generateRaw, type GeneratorLike } from "../testCase.js";

// ---------------------------------------------------------------------------
// Generator base class
// ---------------------------------------------------------------------------

/**
 * Base class for all generators. Generators produce values of type T
 * synchronously by communicating with the hegel server.
 */
export abstract class Generator<T> implements GeneratorLike<T> {
  /** @internal */
  abstract doDraw(tc: TestCase): T;

  /** @internal */
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

// ---------------------------------------------------------------------------
// BasicGenerator
// ---------------------------------------------------------------------------

/**
 * Schema-based generator that sends a schema to the server and parses the response.
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
    const raw = generateRaw(tc, this.schema);
    if (this.parse) {
      return this.parse(raw);
    }
    return raw as T;
  }

  asBasic(): BasicGenerator<T> {
    return this;
  }

  parseRaw(raw: unknown): T {
    if (this.parse) {
      return this.parse(raw);
    }
    return raw as T;
  }

  override map<U>(f: (value: T) => U): BasicGenerator<U> {
    const oldParse = this.parse;
    return new BasicGenerator(this.schema, (raw: unknown) => {
      const t = oldParse ? oldParse(raw) : (raw as T);
      return f(t);
    });
  }
}

// ---------------------------------------------------------------------------
// Internal combinators
// ---------------------------------------------------------------------------

class MappedGenerator<T, U> extends Generator<U> {
  private source: Generator<T>;
  private f: (value: T) => U;

  constructor(source: Generator<T>, f: (value: T) => U) {
    super();
    this.source = source;
    this.f = f;
  }

  doDraw(tc: TestCase): U {
    // MappedGenerator is only created for non-basic sources (BasicGenerator
    // overrides .map() to return a BasicGenerator directly). So asBasic()
    // would always return null here — we go straight to the span-based path.
    tc.startSpan(Labels.MAPPED);
    const result = this.f(this.source.doDraw(tc));
    tc.stopSpan(false);
    return result;
  }
}

class FlatMappedGenerator<T, U> extends Generator<U> {
  private source: Generator<T>;
  private f: (value: T) => Generator<U>;

  constructor(source: Generator<T>, f: (value: T) => Generator<U>) {
    super();
    this.source = source;
    this.f = f;
  }

  doDraw(tc: TestCase): U {
    tc.startSpan(Labels.FLAT_MAP);
    const intermediate = this.source.doDraw(tc);
    const nextGen = this.f(intermediate);
    const result = nextGen.doDraw(tc);
    tc.stopSpan(false);
    return result;
  }
}

class FilteredGenerator<T> extends Generator<T> {
  private source: Generator<T>;
  private predicate: (value: T) => boolean;

  constructor(source: Generator<T>, predicate: (value: T) => boolean) {
    super();
    this.source = source;
    this.predicate = predicate;
  }

  doDraw(tc: TestCase): T {
    for (let i = 0; i < 3; i++) {
      tc.startSpan(Labels.FILTER);
      const value = this.source.doDraw(tc);
      if (this.predicate(value)) {
        tc.stopSpan(false);
        return value;
      }
      tc.stopSpan(true);
    }
    tc.assume(false);
    throw new Error("unreachable");
  }
}

export class CompositeGenerator<T> extends Generator<T> {
  private fn: (tc: TestCase) => T;

  constructor(fn: (tc: TestCase) => T) {
    super();
    this.fn = fn;
  }

  doDraw(tc: TestCase): T {
    return this.fn(tc);
  }
}
