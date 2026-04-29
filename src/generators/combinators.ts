/**
 * Value combinators: just, sampledFrom, oneOf, optional.
 *
 * @packageDocumentation
 */

import { TestCase, Labels, generateRaw } from "../testCase.js";
import { Generator, BasicGenerator } from "./core.js";

class JustGenerator<T> extends Generator<T> {
  constructor(private readonly value: T) {
    super();
  }

  doDraw(_tc: TestCase): T {
    return this.value;
  }

  override asBasic(): BasicGenerator<T> {
    const value = this.value;
    return new BasicGenerator({ type: "constant", value: null }, () => value);
  }
}

/** Generate a constant value. */
export function just<T>(value: T): Generator<T> {
  return new JustGenerator(value);
}

class SampledFromGenerator<T> extends Generator<T> {
  private readonly elements: T[];
  private readonly schema: Record<string, unknown>;

  constructor(elements: readonly T[]) {
    super();
    if (elements.length === 0) {
      throw new Error("sampledFrom requires at least one element");
    }
    this.elements = [...elements];
    this.schema = { type: "integer", min_value: 0, max_value: this.elements.length - 1 };
  }

  doDraw(tc: TestCase): T {
    return this.elements[generateRaw(tc, this.schema) as number];
  }

  override asBasic(): BasicGenerator<T> {
    const elements = this.elements;
    return new BasicGenerator(this.schema, (raw) => elements[raw as number]);
  }
}

/** Pick from a fixed list of values. Panics if empty. */
export function sampledFrom<T>(elements: readonly T[]): Generator<T> {
  return new SampledFromGenerator(elements);
}

class OneOfGenerator<T> extends Generator<T> {
  private readonly sources: Generator<T>[];
  private readonly basic: BasicGenerator<T> | null;

  constructor(sources: Generator<T>[]) {
    super();
    if (sources.length === 0) {
      throw new Error("oneOf requires at least one generator");
    }
    this.sources = sources;

    const basics = sources.map((g) => g.asBasic());
    if (basics.every((b) => b !== null)) {
      const validBasics = basics as BasicGenerator<T>[];
      const childSchemas = validBasics.map((b) => b.schema);
      this.basic = new BasicGenerator({ type: "one_of", generators: childSchemas }, (raw) => {
        if (!Array.isArray(raw)) throw new Error(`Expected array, got ${typeof raw}`);
        const index = raw[0] as number;
        return validBasics[index].parseRaw(raw[1]);
      });
    } else {
      this.basic = null;
    }
  }

  doDraw(tc: TestCase): T {
    if (this.basic) return this.basic.doDraw(tc);
    tc.startSpan(Labels.ONE_OF);
    const index = generateRaw(tc, {
      type: "integer",
      min_value: 0,
      max_value: this.sources.length - 1,
    }) as number;
    const result = this.sources[index].doDraw(tc);
    tc.stopSpan();
    return result;
  }

  override asBasic(): BasicGenerator<T> | null {
    return this.basic;
  }
}

/** Choose from multiple generators of the same type. */
export function oneOf<T>(...generators: Generator<T>[]): Generator<T> {
  return new OneOfGenerator(generators);
}

class OptionalGenerator<T> extends Generator<T | null> {
  private readonly inner: Generator<T>;
  private readonly basic: BasicGenerator<T | null> | null;

  constructor(inner: Generator<T>) {
    super();
    this.inner = inner;

    const innerBasic = inner.asBasic();
    if (innerBasic) {
      this.basic = new BasicGenerator(
        { type: "one_of", generators: [{ type: "null" }, innerBasic.schema] },
        (raw) => {
          if (!Array.isArray(raw)) throw new Error(`Expected array, got ${typeof raw}`);
          const index = raw[0] as number;
          if (index === 0) return null;
          return innerBasic.parseRaw(raw[1]);
        },
      );
    } else {
      this.basic = null;
    }
  }

  doDraw(tc: TestCase): T | null {
    if (this.basic) return this.basic.doDraw(tc);
    tc.startSpan(Labels.OPTIONAL);
    const isSome = generateRaw(tc, { type: "boolean" }) as boolean;
    const result = isSome ? this.inner.doDraw(tc) : null;
    tc.stopSpan();
    return result;
  }

  override asBasic(): BasicGenerator<T | null> | null {
    return this.basic;
  }
}

/** Generate either a value from the inner generator, or null. */
export function optional<T>(inner: Generator<T>): Generator<T | null> {
  return new OptionalGenerator(inner);
}
