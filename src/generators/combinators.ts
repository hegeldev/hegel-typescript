/**
 * Generator combinators: tuples, oneOf, optional, ipAddresses.
 *
 * @packageDocumentation
 */

import { BasicGenerator, Generator } from "./core.js";
import { generateFromSchema, Labels, startSpan, stopSpan } from "../runner.js";
import type { TestCaseData } from "../runner.js";
import { just } from "./primitives.js";

// ---------------------------------------------------------------------------
// CompositeTupleGenerator
// ---------------------------------------------------------------------------

/**
 * A tuple generator for elements that are not all basic.
 *
 * Generates each element in sequence inside a TUPLE span (label 7).
 * Used when at least one element cannot be represented as a basic schema.
 */
export class CompositeTupleGenerator<T extends unknown[]> extends Generator<T> {
  private readonly _elements: { [K in keyof T]: Generator<T[K]> };

  constructor(elements: { [K in keyof T]: Generator<T[K]> }) {
    super();
    this._elements = elements;
  }

  async doDraw(data: TestCaseData): Promise<T> {
    await startSpan(Labels.TUPLE, data);
    try {
      const result: unknown[] = [];
      for (const elem of this._elements) {
        result.push(await elem.doDraw(data));
      }
      return result as T;
    } finally {
      await stopSpan({}, data);
    }
  }
}

// ---------------------------------------------------------------------------
// tuples2, tuples3, tuples4
// ---------------------------------------------------------------------------

/**
 * Generate a 2-tuple (pair).
 *
 * If both elements are {@link BasicGenerator}s, returns a BasicGenerator with
 * a tuple schema so the server can see and shrink both components. Otherwise
 * returns a CompositeTupleGenerator that generates each element inside
 * a TUPLE span.
 *
 * @param g1 - Generator for the first element.
 * @param g2 - Generator for the second element.
 */
export function tuples2<A, B>(g1: Generator<A>, g2: Generator<B>): Generator<[A, B]> {
  if (g1 instanceof BasicGenerator && g2 instanceof BasicGenerator) {
    return _basicTuple([g1, g2]) as BasicGenerator<[A, B]>;
  }
  return new CompositeTupleGenerator<[A, B]>([g1, g2]);
}

/**
 * Generate a 3-tuple.
 *
 * If all elements are {@link BasicGenerator}s, returns a BasicGenerator with
 * a tuple schema. Otherwise returns a CompositeTupleGenerator.
 *
 * @param g1 - Generator for the first element.
 * @param g2 - Generator for the second element.
 * @param g3 - Generator for the third element.
 */
export function tuples3<A, B, C>(
  g1: Generator<A>,
  g2: Generator<B>,
  g3: Generator<C>,
): Generator<[A, B, C]> {
  if (
    g1 instanceof BasicGenerator &&
    g2 instanceof BasicGenerator &&
    g3 instanceof BasicGenerator
  ) {
    return _basicTuple([g1, g2, g3]) as BasicGenerator<[A, B, C]>;
  }
  return new CompositeTupleGenerator<[A, B, C]>([g1, g2, g3]);
}

/**
 * Generate a 4-tuple.
 *
 * If all elements are {@link BasicGenerator}s, returns a BasicGenerator with
 * a tuple schema. Otherwise returns a CompositeTupleGenerator.
 *
 * @param g1 - Generator for the first element.
 * @param g2 - Generator for the second element.
 * @param g3 - Generator for the third element.
 * @param g4 - Generator for the fourth element.
 */
export function tuples4<A, B, C, D>(
  g1: Generator<A>,
  g2: Generator<B>,
  g3: Generator<C>,
  g4: Generator<D>,
): Generator<[A, B, C, D]> {
  if (
    g1 instanceof BasicGenerator &&
    g2 instanceof BasicGenerator &&
    g3 instanceof BasicGenerator &&
    g4 instanceof BasicGenerator
  ) {
    return _basicTuple([g1, g2, g3, g4]) as BasicGenerator<[A, B, C, D]>;
  }
  return new CompositeTupleGenerator<[A, B, C, D]>([g1, g2, g3, g4]);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a BasicGenerator for a tuple from an array of BasicGenerators.
 *
 * Combines their raw schemas into `{"type":"tuple","elements":[...]}`.
 * If any element has a transform, builds a combined transform that applies
 * each element's transform to the corresponding position.
 *
 * @internal
 */
function _basicTuple(elements: BasicGenerator<unknown>[]): BasicGenerator<unknown[]> {
  const rawSchemas = elements.map((e) => e._rawSchema);
  const transforms = elements.map((e) => e._transform as ((raw: unknown) => unknown) | null);
  const combinedSchema: Record<string, unknown> = { type: "tuple", elements: rawSchemas };

  if (transforms.every((t) => t === null)) {
    return new BasicGenerator<unknown[]>(combinedSchema);
  }

  const applyTransforms = (rawTuple: unknown): unknown[] => {
    const arr = rawTuple as unknown[];
    return arr.map((raw, i) => {
      const t = transforms[i];
      return t !== null ? t(raw) : raw;
    });
  };
  return new BasicGenerator<unknown[]>(combinedSchema, applyTransforms);
}

// ---------------------------------------------------------------------------
// CompositeOneOfGenerator
// ---------------------------------------------------------------------------

/**
 * A one_of generator for generators that cannot be represented as a single schema
 * (i.e., when at least one branch is not a {@link BasicGenerator}).
 *
 * Generates an integer index then delegates to the selected generator. Wrapped
 * in a ONE_OF span (label `Labels.ONE_OF`) so the server tracks the choice.
 */
export class CompositeOneOfGenerator<T = unknown> extends Generator<T> {
  /** @internal */
  readonly _generators: Generator<T>[];

  constructor(generators: Generator<T>[]) {
    super();
    this._generators = generators;
  }

  async doDraw(data: TestCaseData): Promise<T> {
    await startSpan(Labels.ONE_OF, data);
    try {
      const index = (await generateFromSchema(
        {
          type: "integer",
          min_value: 0,
          max_value: this._generators.length - 1,
        },
        data,
      )) as number;
      return await this._generators[index].doDraw(data);
    } finally {
      await stopSpan({}, data);
    }
  }
}

// ---------------------------------------------------------------------------
// oneOf
// ---------------------------------------------------------------------------

/**
 * Choose uniformly between two or more generators.
 *
 * There are three implementation paths depending on the inputs:
 *
 * - **Path 1** — all branches are {@link BasicGenerator} with no transform:
 *   returns a `BasicGenerator` with `{"one_of": [...schemas]}`.
 * - **Path 2** — all branches are {@link BasicGenerator} but some have transforms:
 *   returns a `BasicGenerator` using tagged-tuple schemas so each branch can
 *   carry its own transform.
 * - **Path 3** — any branch is not a `BasicGenerator`:
 *   returns a CompositeOneOfGenerator that generates an index then
 *   delegates to the selected generator inside a ONE_OF span.
 *
 * @param generators - Two or more generators to choose between.
 * @throws {Error} If fewer than 2 generators are provided.
 */
export function oneOf<T>(...generators: Generator<T>[]): Generator<T> {
  if (generators.length < 2) {
    throw new Error("oneOf requires at least 2 generators");
  }

  // Check if all generators are BasicGenerator instances
  const allBasic = generators.every((g) => g instanceof BasicGenerator);
  if (!allBasic) {
    // Path 3: composite
    return new CompositeOneOfGenerator(generators);
  }

  const basicGenerators = generators as BasicGenerator<T>[];
  const allIdentity = basicGenerators.every((g) => g._transform === null);

  if (allIdentity) {
    // Path 1: all basic, no transforms — flat one_of schema
    const schemas = basicGenerators.map((g) => g._rawSchema);
    return new BasicGenerator<T>({ one_of: schemas });
  }

  // Path 2: all basic, some have transforms — use tagged tuples
  const taggedSchemas = basicGenerators.map((g, i) => ({
    type: "tuple",
    elements: [{ const: i }, g._rawSchema],
  }));
  const transforms = basicGenerators.map((g) => g._transform as ((raw: unknown) => T) | null);

  const applyTaggedTransform = (tagged: unknown): T => {
    const [tag, value] = tagged as [number, unknown];
    const transform = transforms[tag];
    if (transform !== null) {
      return transform(value);
    }
    return value as T;
  };

  return new BasicGenerator<T>({ one_of: taggedSchemas }, applyTaggedTransform);
}

// ---------------------------------------------------------------------------
// optional
// ---------------------------------------------------------------------------

/**
 * Optionally generate a value — returns `null` or a value from `element`.
 *
 * Equivalent to `oneOf(just(null), element)`.
 *
 * @param element - Generator for the non-null case.
 */
export function optional<T>(element: Generator<T>): Generator<T | null> {
  return oneOf(just<T | null>(null), element);
}

// ---------------------------------------------------------------------------
// ipAddresses
// ---------------------------------------------------------------------------

/**
 * Generate IP addresses.
 *
 * @param version - IP version: `4` for IPv4, `6` for IPv6, or `null` (default)
 *   to generate both versions mixed.
 */
export function ipAddresses(version: 4 | 6 | null = null): Generator<string> {
  if (version === 4) {
    return new BasicGenerator<string>({ type: "ipv4" });
  }
  if (version === 6) {
    return new BasicGenerator<string>({ type: "ipv6" });
  }
  // version === null: both v4 and v6
  return oneOf(ipAddresses(4), ipAddresses(6));
}
