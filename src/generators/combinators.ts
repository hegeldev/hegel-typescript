/**
 * Value combinators: just, sampledFrom, oneOf, optional.
 *
 * @packageDocumentation
 */

import { Labels, generateRaw } from "../testCase.js";
import { Generator, BasicGenerator, CompositeGenerator } from "./core.js";
import { integers } from "./numeric.js";

// ---------------------------------------------------------------------------
// Just
// ---------------------------------------------------------------------------

/** Generate a constant value. */
export function just<T>(value: T): Generator<T> {
  return new CompositeGenerator(() => value);
}

// ---------------------------------------------------------------------------
// SampledFrom
// ---------------------------------------------------------------------------

/** Pick uniformly from a fixed list of values. Panics if empty. */
export function sampledFrom<T>(elements: T[]): BasicGenerator<T> {
  if (elements.length === 0) {
    throw new Error("sampledFrom requires at least one element");
  }
  const copy = [...elements];
  return new BasicGenerator(
    { type: "integer", min_value: 0, max_value: copy.length - 1 },
    (raw) => copy[raw as number],
  );
}

// ---------------------------------------------------------------------------
// OneOf
// ---------------------------------------------------------------------------

/** Choose from multiple generators of the same type. */
export function oneOf<T>(...generators: Generator<T>[]): Generator<T> {
  if (generators.length === 0) {
    throw new Error("oneOf requires at least one generator");
  }

  const basics = generators.map((g) => g.asBasic());
  if (basics.every((b) => b !== null)) {
    const validBasics = basics as BasicGenerator<T>[];

    const taggedSchemas = validBasics.map((b, i) => ({
      type: "tuple",
      elements: [{ type: "constant", value: i }, b.schema],
    }));

    return new BasicGenerator({ type: "one_of", generators: taggedSchemas }, (raw) => {
      if (!Array.isArray(raw)) throw new Error(`Expected array, got ${typeof raw}`);
      const tag = raw[0] as number;
      return validBasics[tag].parseRaw(raw[1]);
    });
  }

  return new CompositeGenerator((tc) => {
    tc.startSpan(Labels.ONE_OF);
    const index = integers({ minValue: 0, maxValue: generators.length - 1 }).doDraw(tc);
    const result = generators[index].doDraw(tc);
    tc.stopSpan(false);
    return result;
  });
}

// ---------------------------------------------------------------------------
// Optional
// ---------------------------------------------------------------------------

/** Generate either a value from the inner generator, or null. */
export function optional<T>(inner: Generator<T>): Generator<T | null> {
  const innerBasic = inner.asBasic();
  if (innerBasic) {
    const nullSchema = {
      type: "tuple",
      elements: [{ type: "constant", value: 0 }, { type: "null" }],
    };
    const valueSchema = {
      type: "tuple",
      elements: [{ type: "constant", value: 1 }, innerBasic.schema],
    };

    return new BasicGenerator({ type: "one_of", generators: [nullSchema, valueSchema] }, (raw) => {
      if (!Array.isArray(raw)) throw new Error(`Expected array, got ${typeof raw}`);
      const tag = raw[0] as number;
      if (tag === 0) return null;
      return innerBasic.parseRaw(raw[1]);
    });
  }

  return new CompositeGenerator((tc) => {
    tc.startSpan(Labels.OPTIONAL);
    const isSome = generateRaw(tc, { type: "boolean" }) as boolean;
    const result = isSome ? inner.doDraw(tc) : null;
    tc.stopSpan(false);
    return result;
  });
}
